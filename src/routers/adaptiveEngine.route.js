'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/adaptiveEngineController');

router.post('/:userId/:sessionId/process',           ctrl.processSignals);
router.post('/:userId/:sessionId/force-mode',        ctrl.forceMode);
router.get ('/:userId/:sessionId/next-atom',         ctrl.getNextAtom);
router.get ('/:userId/:sessionId/animation-profile', ctrl.getAnimationProfile);

module.exports = router;
