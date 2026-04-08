const express = require('express');
const router = express.Router();
const {
  getMatchedAds,
  startImpression,
  tickImpression,
  completeImpression,
  getPreferences,
  updatePreferences,
  getPricingConfig,
  updatePricingConfig,
  approveAd
} = require('../controllers/adController');
const { authenticateUser } = require('../middlewares');
const { authenticateAdmin } = require('../middlewares');

// Student/Teacher: Ad matching + preferences
router.get('/match', authenticateUser, getMatchedAds);
router.get('/preferences', authenticateUser, getPreferences);
router.put('/preferences', authenticateUser, updatePreferences);

// Impression tracking (student)
router.post('/impression/start', authenticateUser, startImpression);
router.post('/impression/tick', authenticateUser, tickImpression);
router.post('/impression/complete', authenticateUser, completeImpression);

// Admin routes
router.get('/admin/pricing-config', authenticateAdmin, getPricingConfig);
router.patch('/admin/pricing-config', authenticateAdmin, updatePricingConfig);
router.post('/admin/:adId/approve', authenticateAdmin, approveAd);

module.exports = router;
