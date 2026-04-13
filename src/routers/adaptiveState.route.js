'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/userStateController');

// User state + signals
router.get ('/:userId/:sessionId',         ctrl.getState);
router.post('/:userId/:sessionId/signals', ctrl.postSignals);
router.post('/:userId/:sessionId/reward',  ctrl.postReward);
router.get ('/:userId/:sessionId/summary', ctrl.getSessionSummary);
router.get ('/:userId/:sessionId/hint',    ctrl.getProgressionHint);

module.exports = router;
