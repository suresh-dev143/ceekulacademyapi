'use strict';

const Wallet = require('../models/walletModel');
const { getWallet, getTransactions } = require('../services/walletService');
const { getUserSettlements } = require('../services/settlementService');
const AdImpression = require('../models/adImpressionModel');

/**
 * GET /api/wallet
 * Get current user's wallet
 */
async function getMyWallet(req, res, next) {
  try {
    const userId = req.user._id;
    const wallet = await getWallet(userId);

    if (!wallet) {
      // Auto-create wallet
      const role = req.user.role || 'student';
      const newWallet = await Wallet.create({ userId, userRole: role });
      return res.json({ status: true, data: newWallet });
    }

    res.json({ status: true, data: wallet });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wallet/transactions
 */
async function getMyTransactions(req, res, next) {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const result = await getTransactions(req.user._id, {
      page: parseInt(page),
      limit: parseInt(limit),
      type
    });

    res.json({ status: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wallet/earnings
 * Earnings breakdown (teacher/student)
 */
async function getEarningsBreakdown(req, res, next) {
  try {
    const userId = req.user._id;
    const { period = '30d' } = req.query;

    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const role = req.user.role;
    const matchField = role === 'teacher' ? 'teacherId' : 'studentId';
    const shareField = role === 'teacher' ? 'teacherShare' : 'studentShare';

    const [daily, total] = await Promise.all([
      AdImpression.aggregate([
        {
          $match: {
            [matchField]: new (require('mongoose').Types.ObjectId)(userId),
            startTime: { $gte: since },
            status: 'completed',
            isFraudulent: false
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
            earnings: { $sum: `$${shareField}` },
            impressions: { $sum: 1 },
            secondsWatched: { $sum: '$secondsWatched' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      AdImpression.aggregate([
        {
          $match: {
            [matchField]: new (require('mongoose').Types.ObjectId)(userId),
            status: 'completed',
            isFraudulent: false
          }
        },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: `$${shareField}` },
            totalImpressions: { $sum: 1 }
          }
        }
      ])
    ]);

    const wallet = await getWallet(userId);

    res.json({
      status: true,
      data: {
        wallet: {
          availableBalance: wallet?.balance || 0,
          pendingBalance: wallet?.pendingBalance || 0,
          totalEarned: wallet?.totalEarned || 0
        },
        period,
        daily,
        lifetime: total[0] || { totalEarnings: 0, totalImpressions: 0 }
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wallet/settlements
 */
async function getMySettlements(req, res, next) {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await getUserSettlements(req.user._id, {
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({ status: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wallet/bank-account
 * Link bank account for payouts
 */
async function linkBankAccount(req, res, next) {
  try {
    const userId = req.user._id;
    const { accountNumber, ifscCode, accountHolderName, upiId } = req.body;

    // Create Razorpay contact + fund account
    const { contactId, fundAccountId } = await createRazorpayContact({
      userId: userId.toString(),
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      accountNumber,
      ifscCode,
      accountHolderName,
      upiId
    });

    await Wallet.findOneAndUpdate(
      { userId },
      {
        $set: {
          razorpayContactId: contactId,
          razorpayFundAccountId: fundAccountId,
          bankAccountVerified: true
        }
      },
      { upsert: true }
    );

    res.json({ status: true, message: 'Bank account linked successfully' });
  } catch (err) {
    next(err);
  }
}

async function createRazorpayContact({ userId, name, email, phone, accountNumber, ifscCode, accountHolderName, upiId }) {
  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  const contact = await razorpay.contacts.create({
    name,
    email,
    contact: phone,
    type: 'employee',
    reference_id: userId
  });

  let fundAccount;
  if (upiId) {
    fundAccount = await razorpay.fundAccount.create({
      contact_id: contact.id,
      account_type: 'vpa',
      vpa: { address: upiId }
    });
  } else {
    fundAccount = await razorpay.fundAccount.create({
      contact_id: contact.id,
      account_type: 'bank_account',
      bank_account: {
        name: accountHolderName,
        ifsc: ifscCode,
        account_number: accountNumber
      }
    });
  }

  return { contactId: contact.id, fundAccountId: fundAccount.id };
}

module.exports = {
  getMyWallet,
  getMyTransactions,
  getEarningsBreakdown,
  getMySettlements,
  linkBankAccount
};
