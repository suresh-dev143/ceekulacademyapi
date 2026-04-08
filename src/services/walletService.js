'use strict';

/**
 * Wallet Service — Neuron accounting
 * 1 Neuron = 1 INR
 *
 * All operations use atomic MongoDB operations to prevent race conditions.
 * Double-entry: every debit has a matching credit.
 */

const mongoose = require('mongoose');
const Wallet = require('../models/walletModel');
const Transaction = require('../models/transactionModel');

/**
 * Credit a user's wallet atomically
 */
async function credit(userId, amount, type, metadata = {}, session = null) {
  if (amount <= 0) throw new Error('Credit amount must be positive');

  const opts = session ? { session } : {};

  const wallet = await Wallet.findOneAndUpdate(
    { userId, isActive: true, isFrozen: false },
    {
      $inc: {
        pendingBalance: amount,
        totalEarned: amount
      },
      $inc: { version: 1 }
    },
    { new: true, upsert: false, ...opts }
  );

  if (!wallet) throw new Error('Wallet not found or frozen');

  const txn = await Transaction.create([{
    transactionId: Transaction.generateId(),
    type,
    toUserId: userId,
    toWalletId: wallet._id,
    amount,
    toBalanceBefore: wallet.pendingBalance - amount,
    toBalanceAfter: wallet.pendingBalance,
    status: 'completed',
    description: metadata.description || `Credit: ${type}`,
    metadata,
    ...metadata
  }], opts);

  return { wallet, transaction: txn[0] };
}

/**
 * Debit a user's wallet atomically
 */
async function debit(userId, amount, type, metadata = {}, session = null) {
  if (amount <= 0) throw new Error('Debit amount must be positive');

  const opts = session ? { session } : {};

  const wallet = await Wallet.findOneAndUpdate(
    { userId, isActive: true, isFrozen: false, balance: { $gte: amount } },
    {
      $inc: {
        balance: -amount,
        totalSpent: amount
      },
      $inc: { version: 1 }
    },
    { new: true, upsert: false, ...opts }
  );

  if (!wallet) throw new Error('Insufficient balance or wallet frozen');

  const txn = await Transaction.create([{
    transactionId: Transaction.generateId(),
    type,
    fromUserId: userId,
    fromWalletId: wallet._id,
    amount,
    fromBalanceBefore: wallet.balance + amount,
    fromBalanceAfter: wallet.balance,
    status: 'completed',
    description: metadata.description || `Debit: ${type}`,
    metadata,
    ...metadata
  }], opts);

  return { wallet, transaction: txn[0] };
}

/**
 * Lock advertiser budget for a campaign
 */
async function lockBudget(advertiserId, amount, adId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await Wallet.findOneAndUpdate(
      {
        userId: advertiserId,
        balance: { $gte: amount },
        isActive: true,
        isFrozen: false
      },
      {
        $inc: { balance: -amount, lockedBalance: amount },
        $inc: { version: 1 }
      },
      { new: true, session }
    );

    if (!wallet) throw new Error('Insufficient balance to lock budget');

    await Transaction.create([{
      transactionId: Transaction.generateId(),
      type: 'budget_lock',
      fromUserId: advertiserId,
      fromWalletId: wallet._id,
      amount,
      adId,
      description: `Budget locked for ad campaign ${adId}`,
      status: 'completed'
    }], { session });

    await session.commitTransaction();
    return wallet;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Distribute ad revenue per second atomically
 * Returns true on success
 */
async function distributeAdRevenue({
  advertiserId,
  teacherId,
  studentIds,
  adId,
  lectureId,
  adImpressionId,
  totalRevenue,
  teacherShare,
  studentShare,
  platformShare
}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const platformUserId = await getPlatformUserId();

    // 1. Deduct from advertiser's locked balance
    const advertiserWallet = await Wallet.findOneAndUpdate(
      {
        userId: advertiserId,
        lockedBalance: { $gte: totalRevenue },
        isActive: true
      },
      { $inc: { lockedBalance: -totalRevenue, totalSpent: totalRevenue } },
      { new: true, session }
    );
    if (!advertiserWallet) throw new Error('Advertiser insufficient locked budget');

    // 2. Credit teacher
    await Wallet.findOneAndUpdate(
      { userId: teacherId },
      { $inc: { pendingBalance: teacherShare, totalEarned: teacherShare } },
      { new: true, upsert: true, session }
    );

    // 3. Credit students equally
    const perStudentShare = studentShare / studentIds.length;
    for (const studentId of studentIds) {
      await Wallet.findOneAndUpdate(
        { userId: studentId },
        { $inc: { pendingBalance: perStudentShare, totalEarned: perStudentShare } },
        { new: true, upsert: true, session }
      );
    }

    // 4. Credit platform
    await Wallet.findOneAndUpdate(
      { userId: platformUserId },
      { $inc: { balance: platformShare, totalEarned: platformShare } },
      { new: true, upsert: true, session }
    );

    // 5. Record transactions
    const baseMetadata = { adId, lectureId, adImpressionId };

    await Transaction.insertMany([
      {
        transactionId: Transaction.generateId(),
        type: 'budget_deduct',
        fromUserId: advertiserId,
        amount: totalRevenue,
        ...baseMetadata,
        description: 'Ad revenue deducted from locked budget',
        status: 'completed'
      },
      {
        transactionId: Transaction.generateId(),
        type: 'teacher_credit',
        toUserId: teacherId,
        amount: teacherShare,
        ...baseMetadata,
        description: `Teacher share: ${teacherShare} Neurons (33%)`,
        status: 'completed'
      },
      {
        transactionId: Transaction.generateId(),
        type: 'platform_fee',
        toUserId: platformUserId,
        amount: platformShare,
        ...baseMetadata,
        description: `Platform fee: ${platformShare} Neurons (1%)`,
        status: 'completed'
      }
    ], { session });

    await session.commitTransaction();
    return true;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Move pending balance to available balance on settlement
 */
async function settlePendingBalance(userId, amount, settlementId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await Wallet.findOneAndUpdate(
      { userId, pendingBalance: { $gte: amount } },
      {
        $inc: { pendingBalance: -amount, balance: amount },
        $set: { lastSettledAt: new Date() }
      },
      { new: true, session }
    );
    if (!wallet) throw new Error('Insufficient pending balance for settlement');

    await Transaction.create([{
      transactionId: Transaction.generateId(),
      type: 'settlement_payout',
      toUserId: userId,
      toWalletId: wallet._id,
      amount,
      settlementId,
      description: 'Monthly settlement — pending to available',
      status: 'completed'
    }], { session });

    await session.commitTransaction();
    return wallet;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Get wallet with balance info
 */
async function getWallet(userId) {
  return Wallet.findOne({ userId }).lean();
}

/**
 * Get transaction history
 */
async function getTransactions(userId, { page = 1, limit = 20, type } = {}) {
  const filter = {
    $or: [{ fromUserId: userId }, { toUserId: userId }],
    status: { $ne: 'reversed' }
  };
  if (type) filter.type = type;

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter)
  ]);

  return { transactions, total, page, limit };
}

// Cache platform user ID
let _platformUserId = null;
async function getPlatformUserId() {
  if (_platformUserId) return _platformUserId;
  const { User } = require('../models/authModels');
  const platform = await User.findOne({ role: 'platform' }).select('_id').lean();
  _platformUserId = platform?._id || null;
  return _platformUserId;
}

module.exports = {
  credit,
  debit,
  lockBudget,
  distributeAdRevenue,
  settlePendingBalance,
  getWallet,
  getTransactions
};
