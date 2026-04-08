const express = require('express');
const router = express.Router();
const {
  triggerSettlement,
  listSettlements,
  getMySettlements,
  retrySettlement,
  handleRazorpayWebhook
} = require('../controllers/settlementController');
const { authenticateUser } = require('../middlewares');
const { authenticateAdmin } = require('../middlewares');

// Webhook (no auth — verified by signature)
router.post('/webhook/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

// User routes
router.get('/me', authenticateUser, getMySettlements);

// Admin routes
router.post('/admin/run', authenticateAdmin, triggerSettlement);
router.get('/admin/list', authenticateAdmin, listSettlements);
router.post('/admin/:settlementId/retry', authenticateAdmin, retrySettlement);

module.exports = router;
