'use strict';

const { Router }  = require('express');
const ctrl        = require('../controllers/contentController');
const { authenticateTeacher } = require('../middlewares');
const { authenticateUser } = require('../middlewares');

const router = Router();

router.use(authenticateUser);

// ── Read ──────────────────────────────────────────────────────────────────────
router.get( '/:lectureId/active',                          ctrl.getActive);
router.get( '/:lectureId/history',                         ctrl.getHistory);

// Adaptive render — returns the right cognitive layer + media for the requester
// ?level=beginner|intermediate|advanced|expert  (auto-detected from twin if omitted)
// ?depth=simplified|visual|mathematical|research (explicit override)
router.get( '/:lectureId/render',                          ctrl.renderContent);

router.get( '/:lectureId/segment/:order/depth/:depth',     ctrl.getSegmentDepth);

// ── Write (teacher-only for structural changes) ───────────────────────────────
router.post('/:lectureId/init',                            ctrl.initVersion);
router.post('/:lectureId/optimise',                        ctrl.optimise);
router.post('/:lectureId/research',                        ctrl.integrateResearch);
router.post('/:lectureId/outcome',                         ctrl.recordOutcome);

// AI multimedia enrichment — generates images/interactive/animation for one segment
router.post('/:lectureId/enrich/:order',                   ctrl.enrichMedia);

// AI quality gate — grammar + clarity check and auto-fix for all segments
router.post('/:lectureId/quality-check',                   ctrl.qualityCheck);

module.exports = router;
