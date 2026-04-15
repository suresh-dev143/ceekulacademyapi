'use strict';

const path = require('path');
const Advertisement = require('../models/advertisementModel');
const Wallet = require('../models/walletModel');
const AdImpression = require('../models/adImpressionModel');
const { lockBudget } = require('../services/walletService');
const { invalidateAdCache } = require('../services/adMatchingService');
const { getAdFraudReport } = require('../services/fraudDetectionService');
const fileUploader = require('../middlewares/fileUploader');

/**
 * POST /api/advertiser/ads/upload-media
 * Upload image or video file to local storage, returns accessible URL
 */
const uploadAdMediaMiddleware = fileUploader(
  [{ name: 'media', maxCount: 1 }],
  'ads'
);

async function uploadAdMedia(req, res, next) {
  uploadAdMediaMiddleware(req, res, async (err) => {
    if (err) return next(err);

    const file = req.files?.media?.[0];
    if (!file) {
      return res.status(400).json({ status: false, message: 'No media file provided' });
    }

    const isVideo = file.mimetype.startsWith('video/');
    const isImage = file.mimetype.startsWith('image/');

    if (!isVideo && !isImage) {
      return res.status(400).json({ status: false, message: 'File must be an image or video' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const relativePath = file.path.replace(/\\/g, '/').replace(/^public\//, '');
    const mediaUrl = `${baseUrl}/public/${relativePath}`;

    res.json({
      status: true,
      data: {
        mediaUrl,
        adType: isVideo ? 'video' : 'image',
        filename: file.filename,
        size: file.size
      }
    });
  });
}

/**
 * POST /api/advertiser/ads
 * Upload a new advertisement
 */
async function createAd(req, res, next) {
  try {
    const advertiserId = req.user._id;
    const {
      title, description, mediaUrl, thumbnailUrl, adType, clickThroughUrl,
      duration, category, targetAudience, targetAgeMin, targetAgeMax,
      ratePerSecondPerStudent, totalBudget, expiryDate, startDate
    } = req.body;

    // Validate expiry
    if (new Date(expiryDate) <= new Date()) {
      return res.status(400).json({ status: false, message: 'Expiry date must be in the future' });
    }

    if (!['image', 'video'].includes(adType)) {
      return res.status(400).json({ status: false, message: 'adType must be image or video' });
    }

    // Budget is locked at approval time, not at creation
    const ad = await Advertisement.create({
      advertiserId,
      title, description, mediaUrl, thumbnailUrl, adType,
      clickThroughUrl: clickThroughUrl || undefined,
      duration, category, targetAudience, targetAgeMin, targetAgeMax,
      ratePerSecondPerStudent, totalBudget,
      expiryDate: new Date(expiryDate),
      startDate: startDate ? new Date(startDate) : new Date(),
      status: 'pending_review'
    });

    res.status(201).json({
      status: true,
      message: 'Ad created and submitted for review',
      data: ad
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/advertiser/ads
 * List advertiser's ads with analytics
 */
async function getMyAds(req, res, next) {
  try {
    const advertiserId = req.user._id;
    const { page = 1, limit = 20, status } = req.query;

    const filter = { advertiserId };
    if (status) filter.status = status;

    const [ads, total] = await Promise.all([
      Advertisement.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      Advertisement.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: { ads, total, page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/advertiser/ads/:adId/analytics
 * Detailed analytics for a single ad
 */
async function getAdAnalytics(req, res, next) {
  try {
    const { adId } = req.params;
    const advertiserId = req.user._id;

    const ad = await Advertisement.findOne({ _id: adId, advertiserId }).lean();
    if (!ad) return res.status(404).json({ status: false, message: 'Ad not found' });

    const [
      impressionStats,
      dailyStats,
      fraudReport
    ] = await Promise.all([
      AdImpression.aggregate([
        { $match: { adId: ad._id, isFraudulent: false } },
        {
          $group: {
            _id: null,
            totalImpressions: { $sum: 1 },
            totalSecondsPlayed: { $sum: '$secondsWatched' },
            totalRevenue: { $sum: '$totalRevenue' },
            avgCompletionRate: { $avg: '$completionRate' },
            uniqueStudents: { $addToSet: '$studentId' }
          }
        }
      ]),
      AdImpression.aggregate([
        {
          $match: {
            adId: ad._id,
            isFraudulent: false,
            startTime: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
            impressions: { $sum: 1 },
            spend: { $sum: '$totalRevenue' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      getAdFraudReport(adId)
    ]);

    const stats = impressionStats[0] || {};

    res.json({
      status: true,
      data: {
        ad,
        analytics: {
          totalImpressions: stats.totalImpressions || 0,
          totalSecondsPlayed: stats.totalSecondsPlayed || 0,
          totalSpent: ad.totalSpent || 0,
          remainingBudget: ad.remainingBudget || 0,
          avgCompletionRate: stats.avgCompletionRate || 0,
          uniqueStudents: stats.uniqueStudents?.length || 0,
          dailyBreakdown: dailyStats,
          fraud: fraudReport
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/advertiser/ads/:adId
 * Update ad settings (pause/resume, budget top-up)
 */
async function updateAd(req, res, next) {
  try {
    const { adId } = req.params;
    const advertiserId = req.user._id;
    const { status, additionalBudget } = req.body;

    const ad = await Advertisement.findOne({ _id: adId, advertiserId });
    if (!ad) return res.status(404).json({ status: false, message: 'Ad not found' });

    if (status && ['paused', 'active'].includes(status)) {
      ad.status = status;
      ad.isActive = status === 'active';
    }

    if (additionalBudget > 0) {
      const wallet = await Wallet.findOne({ userId: advertiserId, balance: { $gte: additionalBudget } });
      if (!wallet) return res.status(400).json({ status: false, message: 'Insufficient balance' });

      await lockBudget(advertiserId, additionalBudget, adId);
      ad.totalBudget += additionalBudget;
      ad.remainingBudget += additionalBudget;
      if (ad.status === 'exhausted') {
        ad.status = 'active';
        ad.isActive = true;
      }
    }

    await ad.save();
    await invalidateAdCache();

    res.json({ status: true, message: 'Ad updated', data: ad });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/advertiser/dashboard
 * Advertiser dashboard summary
 */
async function getDashboard(req, res, next) {
  try {
    const advertiserId = req.user._id;

    const [wallet, adStats, recentImpressions] = await Promise.all([
      Wallet.findOne({ userId: advertiserId }).lean(),
      Advertisement.aggregate([
        { $match: { advertiserId: new (require('mongoose').Types.ObjectId)(advertiserId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalBudget: { $sum: '$totalBudget' },
            totalSpent: { $sum: '$totalSpent' }
          }
        }
      ]),
      AdImpression.find({})
        .populate('adId', 'title')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    ]);

    res.json({
      status: true,
      data: {
        wallet: {
          balance: wallet?.balance || 0,
          lockedBalance: wallet?.lockedBalance || 0,
          totalSpent: wallet?.totalSpent || 0
        },
        adStats,
        recentImpressions
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/advertiser/wallet/deposit
 * Top up advertiser wallet
 */
async function depositToWallet(req, res, next) {
  try {
    const advertiserId = req.user._id;
    const { amount, razorpayPaymentId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ status: false, message: 'Invalid amount' });
    }

    // Verify Razorpay payment
    const verified = await verifyRazorpayPayment(razorpayPaymentId, amount);
    if (!verified) {
      return res.status(400).json({ status: false, message: 'Payment verification failed' });
    }

    // Add to wallet
    await Wallet.findOneAndUpdate(
      { userId: advertiserId },
      { $inc: { balance: amount } },
      { upsert: true, new: true }
    );

    res.json({ status: true, message: `${amount} Neurons added to wallet` });
  } catch (err) {
    next(err);
  }
}

async function verifyRazorpayPayment(paymentId, amount) {
  if (!paymentId) return false;
  // In production: verify with Razorpay API
  return true;
}

module.exports = {
  uploadAdMedia,
  createAd,
  getMyAds,
  getAdAnalytics,
  updateAd,
  getDashboard,
  depositToWallet
};
