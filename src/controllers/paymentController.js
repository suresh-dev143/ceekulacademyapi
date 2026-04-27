const PaymentService = require('../services/paymentService');

const ok  = (res, data, status = 200) => res.status(status).json({ status: true, ...data });
const err = (res, message, status = 500) => res.status(status).json({ status: false, message });

const handleErr = (res, e) => {
  console.error('[PaymentController]', e.message);
  return err(res, e.message, e.status ?? 500);
};

/**
 * POST /api/payment/initiate
 * Creates a signed payment session and returns the Cramib redirect URL.
 *
 * Body: { currency, entityType, entityName, amountINR, notes }
 */
exports.initiatePayment = async (req, res) => {
  try {
    const { currency, entityType, entityName, amountINR, notes } = req.body;

    if (!entityType || !entityName || !amountINR) {
      return err(res, 'entityType, entityName, and amountINR are required', 400);
    }
    if (amountINR < 1) {
      return err(res, 'Minimum contribution is ₹1', 400);
    }

    const result = await PaymentService.initiatePayment(req.user._id, {
      currency, entityType, entityName, amountINR: Number(amountINR), notes,
    });

    ok(res, result, 201);
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/payment/verify
 * Verifies the Razorpay payment returned from Cramib and credits neurons.
 *
 * Body: { sessionId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { sessionId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

    if (!sessionId || !razorpayPaymentId || !razorpayOrderId) {
      return err(res, 'sessionId, razorpayPaymentId, and razorpayOrderId are required', 400);
    }

    const result = await PaymentService.verifyPayment(req.user._id, {
      sessionId, razorpayPaymentId, razorpayOrderId, razorpaySignature,
    });

    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/payment/session/:sessionId
 * Returns the current status of a payment session.
 */
exports.getSession = async (req, res) => {
  try {
    const record = await PaymentService.getSession(req.user._id, req.params.sessionId);
    ok(res, { session: record });
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/payment/cramib-session/:sessionId
 * Server-to-server endpoint called by Cramib before creating the Razorpay order.
 * Auth: X-Cramib-Secret header must match CRAMIB_WEBHOOK_SECRET env var.
 * Returns authoritative amountINR, currency, entityName, entityType.
 * Rejects if the session is not pending or has expired.
 */
exports.getCramibSession = async (req, res) => {
  try {
    const record = await PaymentService.getCramibSession(req.params.sessionId);
    ok(res, { session: record });
  } catch (e) { handleErr(res, e); }
};
