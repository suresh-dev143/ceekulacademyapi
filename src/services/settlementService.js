'use strict';

/**
 * Monthly Settlement Service
 *
 * Flow:
 * 1. Calculate each user's earnings for the month
 * 2. Create Settlement records
 * 3. Trigger Razorpay payouts
 * 4. Update wallet balances
 * 5. Record reconciliation
 */

const mongoose = require('mongoose');
const Settlement = require('../models/settlementModel');
const Wallet = require('../models/walletModel');
const AdImpression = require('../models/adImpressionModel');
const Razorpay = require('razorpay');
const { settlePendingBalance } = require('./walletService');
const { publishEvent, EVENT_TYPES } = require('./eventService');

/**
 * Run monthly settlement for all users
 * Called by cron: 1st of each month at midnight
 */
async function runMonthlySettlement() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Period: previous month
  const periodStart = new Date(year, now.getMonth() - 1, 1);
  const periodEnd = new Date(year, now.getMonth(), 0, 23, 59, 59);

  console.log(`[Settlement] Running for ${month - 1}/${year}`);

  // 1. Calculate teacher earnings
  const teacherEarnings = await calculateEarnings('teacher', periodStart, periodEnd);
  // 2. Calculate student earnings
  const studentEarnings = await calculateEarnings('student', periodStart, periodEnd);

  const settlements = [];

  // 3. Create settlement records
  for (const earning of [...teacherEarnings, ...studentEarnings]) {
    if (earning.amount < 1) continue; // Skip below 1 Neuron

    try {
      const settlement = await Settlement.findOneAndUpdate(
        { userId: earning.userId, year, month: month - 1 },
        {
          $setOnInsert: {
            userId: earning.userId,
            userRole: earning.role,
            month: month - 1,
            year,
            periodStart,
            periodEnd,
            grossAmount: earning.amount,
            platformFee: earning.amount * 0.01,
            netAmount: earning.amount * 0.99,
            amountInINR: earning.amount * 0.99,
            totalImpressions: earning.impressions,
            totalSecondsWatched: earning.secondsWatched,
            status: 'pending'
          }
        },
        { upsert: true, new: true }
      );
      settlements.push(settlement);
    } catch (err) {
      console.error(`[Settlement] Error creating settlement for ${earning.userId}:`, err.message);
    }
  }

  // 4. Process payouts
  for (const settlement of settlements) {
    await processSettlementPayout(settlement);
  }

  await publishEvent(EVENT_TYPES.SETTLEMENT_TRIGGERED, {
    month: month - 1,
    year,
    totalSettlements: settlements.length,
    timestamp: new Date().toISOString()
  });

  return { processed: settlements.length, month: month - 1, year };
}

/**
 * Calculate earnings for a role in a period
 */
async function calculateEarnings(role, periodStart, periodEnd) {
  const field = role === 'teacher' ? 'teacherShare' : 'studentShare';

  const results = await AdImpression.aggregate([
    {
      $match: {
        startTime: { $gte: periodStart, $lte: periodEnd },
        status: 'completed',
        isFraudulent: false
      }
    },
    {
      $group: {
        _id: role === 'teacher' ? '$teacherId' : '$studentId',
        amount: { $sum: `$${field}` },
        impressions: { $sum: 1 },
        secondsWatched: { $sum: '$secondsWatched' }
      }
    },
    { $match: { amount: { $gt: 0 } } }
  ]);

  return results.map(r => ({
    userId: r._id,
    role,
    amount: r.amount,
    impressions: r.impressions,
    secondsWatched: r.secondsWatched
  }));
}

/**
 * Process payout for a single settlement via Razorpay
 */
async function processSettlementPayout(settlement) {
  try {
    settlement.status = 'processing';
    await settlement.save();

    const wallet = await Wallet.findOne({ userId: settlement.userId });
    if (!wallet || wallet.isFrozen) {
      settlement.status = 'on_hold';
      settlement.failureReason = 'Wallet frozen or missing';
      await settlement.save();
      return;
    }

    if (!wallet.razorpayFundAccountId) {
      settlement.status = 'on_hold';
      settlement.failureReason = 'No bank account linked';
      await settlement.save();
      return;
    }

    // Trigger Razorpay payout
    const payoutResult = await triggerRazorpayPayout({
      fundAccountId: wallet.razorpayFundAccountId,
      amount: Math.floor(settlement.netAmount * 100), // Paise
      currency: 'INR',
      settlementId: settlement._id.toString(),
      narration: `Neuron settlement ${settlement.month}/${settlement.year}`
    });

    // Move pending balance to available
    await settlePendingBalance(settlement.userId, settlement.netAmount, settlement._id);

    settlement.razorpayPayoutId = payoutResult.id;
    settlement.status = 'paid';
    settlement.paidAt = new Date();
    settlement.isReconciled = true;
    await settlement.save();

    console.log(`[Settlement] Payout done for user ${settlement.userId}: ${settlement.netAmount} Neurons`);
  } catch (err) {
    settlement.retryCount += 1;
    settlement.failureReason = err.message;
    settlement.status = settlement.retryCount >= 3 ? 'failed' : 'pending';
    await settlement.save();
    console.error(`[Settlement] Payout failed for ${settlement.userId}:`, err.message);
  }
}

/**
 * Razorpay payout integration
 */
async function triggerRazorpayPayout({ fundAccountId, amount, currency, settlementId, narration }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.warn('[Settlement] Razorpay credentials missing. Payout skipped.');
    throw Object.assign(new Error('Payout gateway not available (Razorpay keys missing)'), { status: 503 });
  }

  const razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });

  const payout = await razorpay.payouts.create({
    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
    fund_account_id: fundAccountId,
    amount,
    currency,
    mode: 'NEFT',
    purpose: 'payout',
    queue_if_low_balance: true,
    reference_id: settlementId,
    narration,
    notes: { settlement_id: settlementId }
  });

  return payout;
}

/**
 * Get settlement history for a user
 */
async function getUserSettlements(userId, { page = 1, limit = 12 } = {}) {
  const [settlements, total] = await Promise.all([
    Settlement.find({ userId })
      .sort({ year: -1, month: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Settlement.countDocuments({ userId })
  ]);

  return { settlements, total };
}

module.exports = {
  runMonthlySettlement,
  processSettlementPayout,
  getUserSettlements
};
