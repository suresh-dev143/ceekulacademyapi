'use strict';

const { runMonthlySettlement, getUserSettlements } = require('../services/settlementService');
const Settlement = require('../models/settlementModel');

/**
 * POST /api/admin/settlements/run
 * Manually trigger monthly settlement (admin only)
 */
async function triggerSettlement(req, res, next) {
  try {
    const result = await runMonthlySettlement();
    res.json({
      status: true,
      message: `Settlement completed for ${result.month}/${result.year}`,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/settlements
 * List all settlements with filters (admin)
 */
async function listSettlements(req, res, next) {
  try {
    const { page = 1, limit = 50, status, month, year, userRole } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (month) filter.month = parseInt(month);
    if (year) filter.year = parseInt(year);
    if (userRole) filter.userRole = userRole;

    const [settlements, total] = await Promise.all([
      Settlement.find(filter)
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      Settlement.countDocuments(filter)
    ]);

    res.json({ status: true, data: { settlements, total } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/settlements/me
 * User's own settlement history
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
 * POST /api/admin/settlements/:settlementId/retry
 * Retry a failed settlement
 */
async function retrySettlement(req, res, next) {
  try {
    const settlement = await Settlement.findById(req.params.settlementId);
    if (!settlement) return res.status(404).json({ status: false, message: 'Settlement not found' });
    if (!['failed', 'on_hold'].includes(settlement.status)) {
      return res.status(400).json({ status: false, message: 'Only failed/on_hold settlements can be retried' });
    }

    settlement.status = 'pending';
    settlement.failureReason = undefined;
    await settlement.save();

    const { processSettlementPayout } = require('../services/settlementService');
    await processSettlementPayout(settlement);

    res.json({ status: true, message: 'Settlement retry triggered', data: settlement });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payments/razorpay/webhook
 * Razorpay webhook for payout status updates
 */
async function handleRazorpayWebhook(req, res, next) {
  try {
    const crypto = require('crypto');
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSig) {
      return res.status(400).json({ status: false, message: 'Invalid webhook signature' });
    }

    const { event, payload } = req.body;

    if (event === 'payout.processed') {
      const payoutId = payload.payout.entity.id;
      await Settlement.findOneAndUpdate(
        { razorpayPayoutId: payoutId },
        { $set: { status: 'paid', paidAt: new Date() } }
      );
    } else if (event === 'payout.failed') {
      const payoutId = payload.payout.entity.id;
      const reason = payload.payout.entity.failure_reason;
      await Settlement.findOneAndUpdate(
        { razorpayPayoutId: payoutId },
        { $set: { status: 'failed', failureReason: reason } }
      );
    } else if (event === 'payout.reversed') {
      const payoutId = payload.payout.entity.id;
      await Settlement.findOneAndUpdate(
        { razorpayPayoutId: payoutId },
        { $set: { status: 'failed', failureReason: 'Payout reversed by Razorpay' } }
      );
    }

    res.json({ status: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  triggerSettlement,
  listSettlements,
  getMySettlements,
  retrySettlement,
  handleRazorpayWebhook
};
