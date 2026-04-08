const express = require('express');
const router = express.Router();
const {
  createAd,
  getMyAds,
  getAdAnalytics,
  updateAd,
  getDashboard,
  depositToWallet
} = require('../controllers/advertiserController');
const { authenticateUser } = require('../middlewares');

// All routes require authentication
router.use(authenticateUser);

// Advertiser dashboard
router.get('/dashboard', getDashboard);

// Ad management
router.post('/ads', createAd);
router.get('/ads', getMyAds);
router.get('/ads/:adId/analytics', getAdAnalytics);
router.patch('/ads/:adId', updateAd);

// Wallet
router.post('/wallet/deposit', depositToWallet);

module.exports = router;
