const router = require('express').Router();
const ctrl   = require('../controllers/paymentController');
const { authenticateUser } = require('../middlewares');

const verifyCramibSecret = (req, res, next) => {
  const secret = process.env.CRAMIB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ status: false, message: 'Cramib integration not configured on this server' });
  }
  if (req.headers['x-cramib-secret'] !== secret) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }
  next();
};

/** POST /api/payment/initiate  — create session + get Cramib redirect URL */
router.post('/initiate', authenticateUser, ctrl.initiatePayment);

/** POST /api/payment/verify    — verify Razorpay signature + credit neurons */
router.post('/verify',   authenticateUser, ctrl.verifyPayment);

/** GET  /api/payment/session/:sessionId — poll session status (user-auth) */
router.get('/session/:sessionId', authenticateUser, ctrl.getSession);

/** GET  /api/payment/cramib-session/:sessionId — server-to-server lookup by Cramib */
router.get('/cramib-session/:sessionId', verifyCramibSecret, ctrl.getCramibSession);

module.exports = router;
