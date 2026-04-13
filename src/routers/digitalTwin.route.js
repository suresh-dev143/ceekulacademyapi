'use strict';

const { Router }  = require('express');
const ctrl        = require('../controllers/digitalTwinController');
const { authenticateUser } = require('../middlewares');

const router = Router();

router.use(authenticateUser);

router.get('/me',                   ctrl.getMyTwin);
router.get('/me/recommendations',   ctrl.getRecommendations);
router.post('/me/refresh-summary',  ctrl.refreshSummary);
router.post('/me/quiz-result',      ctrl.recordQuizResult);
router.post('/me/session-watch',    ctrl.recordSessionWatch);
router.post('/me/skill',            ctrl.updateSkill);

module.exports = router;
