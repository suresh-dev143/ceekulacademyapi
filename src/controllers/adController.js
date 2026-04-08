'use strict';

const { matchAdsForStudent } = require('../services/adMatchingService');
const { recordAdSecond, completeAdImpression } = require('../services/accountingService');
const { analyzeImpression } = require('../services/fraudDetectionService');
const { calculateEffectiveRate, getConfig, updateConfig } = require('../services/pricingService');
const Advertisement = require('../models/advertisementModel');
const Preferences = require('../models/preferencesModel');

/**
 * GET /api/ads/match
 * Get personalized ads for a student's lecture ad slot
 */
async function getMatchedAds(req, res, next) {
  try {
    const studentId = req.user._id;
    const { lectureId } = req.query;

    if (!lectureId) {
      return res.status(400).json({ status: false, message: 'lectureId is required' });
    }

    const result = await matchAdsForStudent(studentId, lectureId);

    res.json({
      status: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ads/impression/start
 * Student starts watching an ad
 */
async function startImpression(req, res, next) {
  try {
    const studentId = req.user._id;
    const {
      adId, lectureId, sessionId,
      deviceFingerprint
    } = req.body;

    const ipAddress = req.ip;

    // Fraud check
    const fraudResult = await analyzeImpression({
      studentId,
      adId,
      lectureId,
      deviceFingerprint,
      ipAddress,
      sessionId
    });

    if (fraudResult.isFraudulent) {
      return res.status(403).json({
        status: false,
        message: 'Impression blocked due to suspicious activity'
      });
    }

    res.json({
      status: true,
      data: {
        sessionId,
        fraudScore: fraudResult.score,
        isSuspicious: fraudResult.isSuspicious,
        message: 'Impression session started'
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ads/impression/tick
 * Called every second during ad playback
 * Body: { sessionId, adId, lectureId, activeStudentIds }
 */
async function tickImpression(req, res, next) {
  try {
    const studentId = req.user._id;
    const {
      sessionId, adId, lectureId,
      activeStudentIds = [], isLive = false
    } = req.body;

    const revenue = await recordAdSecond({
      sessionId,
      adId,
      lectureId,
      studentId,
      teacherId: req.body.teacherId,
      isLive,
      activeStudentIds: activeStudentIds.length > 0
        ? activeStudentIds
        : [studentId.toString()]
    });

    if (!revenue) {
      return res.json({ status: true, data: { ended: true, reason: 'Budget exhausted' } });
    }

    res.json({
      status: true,
      data: {
        ended: false,
        revenue: {
          effectiveRate: revenue.effectiveRate,
          studentShare: revenue.studentShare / (activeStudentIds.length || 1),
          totalRevenue: revenue.totalRevenue
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/ads/impression/complete
 * Ad playback completed
 */
async function completeImpression(req, res, next) {
  try {
    const { sessionId, watchedSeconds } = req.body;

    const impression = await completeAdImpression(sessionId, watchedSeconds);
    if (!impression) {
      return res.status(404).json({ status: false, message: 'Session not found' });
    }

    res.json({
      status: true,
      data: {
        totalRevenue: impression.totalRevenue,
        studentShare: impression.studentShare,
        completionRate: impression.completionRate,
        message: 'Ad completed — earnings credited to pending balance'
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ads/preferences
 * Get user's ad preferences
 */
async function getPreferences(req, res, next) {
  try {
    const userId = req.user._id;
    const prefs = await Preferences.findOne({ userId }).lean();
    res.json({ status: true, data: prefs || {} });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/ads/preferences
 * Update user's ad preferences
 */
async function updatePreferences(req, res, next) {
  try {
    const userId = req.user._id;
    const role = req.user.role;
    const {
      preferredCategories, blockedCategories,
      minimumAdRate, allowStudentAdControl,
      allowedContentRatings, preferredLanguages,
      notifyOnEarnings, notifyOnSettlement
    } = req.body;

    const update = {};
    if (preferredCategories !== undefined) update.preferredCategories = preferredCategories;
    if (blockedCategories !== undefined) update.blockedCategories = blockedCategories;
    if (minimumAdRate !== undefined) update.minimumAdRate = minimumAdRate;
    if (allowStudentAdControl !== undefined) update.allowStudentAdControl = allowStudentAdControl;
    if (allowedContentRatings !== undefined) update.allowedContentRatings = allowedContentRatings;
    if (preferredLanguages !== undefined) update.preferredLanguages = preferredLanguages;
    if (notifyOnEarnings !== undefined) update.notifyOnEarnings = notifyOnEarnings;
    if (notifyOnSettlement !== undefined) update.notifyOnSettlement = notifyOnSettlement;

    const prefs = await Preferences.findOneAndUpdate(
      { userId },
      { $set: { ...update, userId, userRole: role } },
      { upsert: true, new: true }
    );

    res.json({ status: true, message: 'Preferences updated', data: prefs });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/ads/pricing-config
 * Get current pricing config (admin only)
 */
async function getPricingConfig(req, res, next) {
  try {
    res.json({ status: true, data: getConfig() });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/ads/pricing-config
 * Update pricing config (admin only)
 */
async function updatePricingConfig(req, res, next) {
  try {
    const { liveMultiplier, recordedMultiplier, peakHoursBonus, weekendBonus } = req.body;
    updateConfig({ liveMultiplier, recordedMultiplier, peakHoursBonus, weekendBonus });
    res.json({ status: true, message: 'Pricing config updated', data: getConfig() });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/ads/:adId/approve
 */
async function approveAd(req, res, next) {
  try {
    const { adId } = req.params;
    const ad = await Advertisement.findById(adId);
    if (!ad) return res.status(404).json({ status: false, message: 'Ad not found' });

    ad.status = 'active';
    ad.isActive = true;
    await ad.save();

    // Lock advertiser budget
    const { lockBudget } = require('../services/walletService');
    await lockBudget(ad.advertiserId, ad.totalBudget, adId).catch(() => {
      ad.status = 'pending_review';
      ad.isActive = false;
      ad.save();
      throw new Error('Failed to lock advertiser budget');
    });

    require('../services/adMatchingService').invalidateAdCache();

    res.json({ status: true, message: 'Ad approved and activated', data: ad });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMatchedAds,
  startImpression,
  tickImpression,
  completeImpression,
  getPreferences,
  updatePreferences,
  getPricingConfig,
  updatePricingConfig,
  approveAd
};
