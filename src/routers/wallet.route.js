const express = require('express');
const router = express.Router();
const {
  getMyWallet,
  getMyTransactions,
  getEarningsBreakdown,
  getMySettlements,
  linkBankAccount
} = require('../controllers/walletController');
const { authenticateUser } = require('../middlewares');

router.use(authenticateUser);

router.get('/', getMyWallet);
router.get('/transactions', getMyTransactions);
router.get('/earnings', getEarningsBreakdown);
router.get('/settlements', getMySettlements);
router.post('/bank-account', linkBankAccount);

module.exports = router;
