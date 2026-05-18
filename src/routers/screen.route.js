'use strict';

/**
 * Screen REST Router
 *
 * GET  /api/screen/state/:deviceId       — current screen state for this user/device
 * POST /api/screen/init                  — initialise a screen session (REST fallback)
 * POST /api/screen/instruction           — submit an instruction (REST fallback)
 * GET  /api/screen/history/:deviceId     — layout CID history for this user/device
 */

const express     = require('express');
const router      = express.Router();
const screenSvc   = require('../services/screenEvolutionService');
const ScreenState = require('../models/screenStateModel');
const UceVersionRegistry = require('../models/uceVersionRegistryModel');
const { authenticateUser } = require('../middlewares');
const canvasCtrl    = require('../controllers/screenCanvasController');
const graphCtrl     = require('../controllers/screenGraphController');
const timelineCtrl  = require('../controllers/screenTimelineController');
const resonanceCtrl = require('../controllers/screenResonanceController');
const horizonCtrl   = require('../controllers/screenHorizonController');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── GET /api/screen/state/:deviceId ───────────────────────────────────────────
router.get('/state/:deviceId', authenticateUser, h(async (req, res) => {
  const state = await screenSvc.getState(req.user._id, req.params.deviceId);
  if (!state) {
    return res.status(404).json({ status: false, message: 'No active screen state for this device' });
  }
  res.json({ status: true, data: state });
}));

// ── POST /api/screen/init ─────────────────────────────────────────────────────
router.post('/init', authenticateUser, h(async (req, res) => {
  const { deviceId, deviceType, viewportWidth, context } = req.body;
  if (!deviceId) {
    return res.status(400).json({ status: false, message: 'deviceId is required' });
  }
  const result = await screenSvc.initScreen({
    userId:       req.user._id,
    deviceId,
    deviceType:   deviceType   || 'mobile',
    viewportWidth: viewportWidth || 640,
    context:      context      || 'home',
  });
  res.status(result.fromCache ? 200 : 201).json({ status: true, data: result });
}));

// ── POST /api/screen/instruction ──────────────────────────────────────────────
router.post('/instruction', authenticateUser, h(async (req, res) => {
  const { deviceId, instruction, viewportWidth } = req.body;
  if (!deviceId || !instruction?.type) {
    return res.status(400).json({ status: false, message: 'deviceId and instruction.type are required' });
  }
  const result = await screenSvc.processInstruction({
    userId:       req.user._id,
    deviceId,
    instruction,
    viewportWidth: viewportWidth || 640,
  });
  res.json({ status: true, data: result });
}));

// ── GET /api/screen/prefetch/:deviceId ───────────────────────────────────────
// Returns the pre-committed CIDs for probable next layouts.
// Flutter calls this on init to warm the animation cache before the user acts.

router.get('/prefetch/:deviceId', authenticateUser, h(async (req, res) => {
  const state = await ScreenState.findOne(
    { userId: req.user._id, deviceId: req.params.deviceId },
    { prefetchCids: 1 }
  ).lean();

  if (!state) {
    return res.status(404).json({ status: false, message: 'No screen state found for this device' });
  }

  res.json({ status: true, data: state.prefetchCids || [] });
}));

// ── GET /api/screen/history/:deviceId ─────────────────────────────────────────
// Returns the version chain of screen-layout CIDs for this user/device,
// most recent first. Piggybacks on the UCE version registry.
router.get('/history/:deviceId', authenticateUser, h(async (req, res) => {
  const state = await ScreenState.findOne({
    userId:   req.user._id,
    deviceId: req.params.deviceId,
  }, { currentCid: 1 }).lean();

  if (!state?.currentCid) {
    return res.status(404).json({ status: false, message: 'No screen state found for this device' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  // Resolve the logicalId for the current CID in one query, then fetch the
  // entire version chain with a second query — replacing the old N-serial-query walk.
  const tip = await UceVersionRegistry.findOne(
    { cid: state.currentCid },
    { logicalId: 1, version: 1 }
  ).lean();

  if (!tip) {
    return res.status(404).json({ status: false, message: 'Version registry entry not found for current CID' });
  }

  const chain = await UceVersionRegistry
    .find(
      { logicalId: tip.logicalId, version: { $lte: tip.version } },
      { cid: 1, version: 1, parentCid: 1, committedAt: 1, diff: 1 }
    )
    .sort({ version: -1 })
    .limit(limit)
    .lean();

  res.json({ status: true, data: chain });
}));

// ── GET /api/screen/canvas-content?context=X&deviceId=Y&limit=N ──────────────
// Powers the Flutter SemanticCanvas — returns Recent Activity + Connected
// Content sections. Always 200, even when data is sparse.
router.get('/canvas-content', authenticateUser, h(async (req, res) => {
  await canvasCtrl.canvasContent(req, res);
}));

// ── GET /api/screen/graph?context=X&deviceId=Y ───────────────────────────────
// Powers the Angular reference-graph panel — returns the immediate graph
// neighbourhood (outbound + inbound edges) of the current layout CID.
router.get('/graph', authenticateUser, h(async (req, res) => {
  await graphCtrl.graphData(req, res);
}));

// GET /api/screen/timeline?from=ISO&to=ISO&limit=N
// Agent's personal temporal trail through the knowledge space.
router.get('/timeline', authenticateUser, h(async (req, res) => {
  await timelineCtrl.timeline(req, res);
}));

// GET /api/screen/resonance?contexts=a,b,c
// Anonymized collective density — where minds are converging right now.
router.get('/resonance', authenticateUser, h(async (req, res) => {
  await resonanceCtrl.resonance(req, res);
}));

// GET /api/screen/horizon?context=X&depth=3&deviceId=Y
// Probability tree of anticipatory states — the cone of probable becoming.
router.get('/horizon', authenticateUser, h(async (req, res) => {
  await horizonCtrl.horizon(req, res);
}));

module.exports = router;
