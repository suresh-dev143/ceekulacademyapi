const crypto   = require('crypto');
const Razorpay = require('razorpay');
const mongoose = require('mongoose');

const PaymentSession = require('../models/paymentSessionModel');
const NeuronService  = require('./neuronService');

const SESSION_TTL_MIN = 30;

function getRazorpayClient() {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.warn('Razorpay credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) not configured. Payment features will be disabled.');
    return null;
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

class PaymentService {

  // ─────────────────────────────────────────────────────────────────────────────
  // INITIATE
  // Creates a Razorpay order and a local payment session.
  // Returns the order details so the frontend can open checkout inline.
  // ─────────────────────────────────────────────────────────────────────────────

  static async initiatePayment(userId, { currency = 'INR', entityType, entityName, amountINR, notes }) {
    const sessionId = PaymentSession.generateSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000);

    // NOTE: Razorpay order creation is moved to the Crasmib platform.
    // We only create a local session here to track the request.
    await PaymentSession.create({
      sessionId,
      userId,
      amountINR,
      currency,
      entityType,
      entityName,
      notes,
      status: 'pending',
      expiresAt,
    });

    return {
      sessionId,
      amountINR,
      currency,
      entityName,
      entityType,
      // The frontend will now redirect the user to Crasmib to complete the payment
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VERIFY
  // Called after Razorpay checkout handler fires.
  // Verifies HMAC signature, enforces idempotency, then credits neurons.
  // ─────────────────────────────────────────────────────────────────────────────

  static async verifyPayment(userId, { sessionId, razorpayPaymentId, razorpayOrderId, razorpaySignature }) {
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

    const record = await PaymentSession.findOne({ sessionId });
    if (!record) throw Object.assign(new Error('Payment session not found'), { status: 404 });
    if (record.userId.toString() !== userId.toString()) {
      throw Object.assign(new Error('Session does not belong to this user'), { status: 403 });
    }

    // Idempotency — safe to call twice (e.g. user refreshes the page)
    if (record.status === 'completed') {
      return { neuronsIssued: record.neuronsIssued, alreadyProcessed: true };
    }

    if (record.status !== 'pending') {
      throw Object.assign(new Error(`Payment session is ${record.status}`), { status: 409 });
    }

    if (record.expiresAt < new Date()) {
      record.status = 'expired';
      await record.save();
      throw Object.assign(new Error('Payment session has expired'), { status: 410 });
    }

    // Verify Razorpay HMAC-SHA256 signature
    if (rzpSecret) {
      const expected = crypto
        .createHmac('sha256', rzpSecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');
      if (expected !== razorpaySignature) {
        throw Object.assign(new Error('Invalid payment signature'), { status: 400 });
      }
    }

    // Atomically credit neurons + finalize session
    const sess = await mongoose.startSession();
    sess.startTransaction();
    try {
      const { neuronsIssued, account, contribution } = await NeuronService.autoConfirmPaymentContribution(
        {
          userId:            record.userId,
          amountINR:         record.amountINR,
          entityType:        record.entityType,
          entityName:        record.entityName,
          notes:             record.notes,
          razorpayPaymentId,
          sessionId,
        },
        sess
      );

      record.status            = 'completed';
      record.razorpayOrderId   = razorpayOrderId;
      record.razorpayPaymentId = razorpayPaymentId;
      record.neuronsIssued     = neuronsIssued;
      record.neuronTxId        = contribution.neuronTransactionId;
      record.contributionId    = contribution._id;
      record.completedAt       = new Date();
      await record.save({ session: sess });

      await sess.commitTransaction();
      return { neuronsIssued, account, alreadyProcessed: false };
    } catch (err) {
      await sess.abortTransaction();
      record.status        = 'failed';
      record.failureReason = err.message;
      await record.save();
      throw err;
    } finally {
      sess.endSession();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET SESSION (status display / return-page polling)
  // ─────────────────────────────────────────────────────────────────────────────

  static async getSession(userId, sessionId) {
    const record = await PaymentSession.findOne({ sessionId });
    if (!record) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (record.userId.toString() !== userId.toString()) {
      throw Object.assign(new Error('Unauthorized'), { status: 403 });
    }
    return record;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GET CRAMIB SESSION (server-to-server — called by Cramib before order creation)
  // Returns only the fields Cramib needs; refuses non-pending or expired sessions.
  // ─────────────────────────────────────────────────────────────────────────────

  static async getCramibSession(sessionId) {
    const record = await PaymentSession.findOne({ sessionId });
    if (!record) throw Object.assign(new Error('Session not found'), { status: 404 });

    if (record.status !== 'pending') {
      throw Object.assign(new Error(`Session is already ${record.status}`), { status: 409 });
    }
    if (record.expiresAt < new Date()) {
      record.status = 'expired';
      await record.save();
      throw Object.assign(new Error('Session has expired'), { status: 410 });
    }

    return {
      sessionId:  record.sessionId,
      amountINR:  record.amountINR,
      currency:   record.currency,
      entityName: record.entityName,
      entityType: record.entityType,
    };
  }
}

module.exports = PaymentService;
