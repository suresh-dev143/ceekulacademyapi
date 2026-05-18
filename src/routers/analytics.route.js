'use strict';

/**
 * Analytics + Subscription Router — Phase 7 Advanced Intelligence
 *
 * Graph Analytics (all admin unless noted):
 *   GET  /api/analytics/graph/programs          — top programs by enrolment
 *   GET  /api/analytics/graph/content/reused    — most reused CIDs
 *   GET  /api/analytics/graph/instructors        — instructor reach ranking
 *   GET  /api/analytics/graph/velocity           — content commit velocity per day
 *   GET  /api/analytics/graph/categories         — category distribution
 *   GET  /api/analytics/graph/drift/:logicalId   — semantic drift across version chain
 *   GET  /api/analytics/graph/vitality           — pedagogy vitality for a set of CIDs
 *
 * Citizen Audit (admin):
 *   GET  /api/analytics/audit/:citizenId        — structured audit export
 *
 * Semantic Subscriptions (authenticated citizen):
 *   POST   /api/analytics/subscriptions          — create watch subscription
 *   GET    /api/analytics/subscriptions          — list my subscriptions
 *   DELETE /api/analytics/subscriptions/:id      — cancel subscription
 */

const express        = require('express');
const router         = express.Router();
const analytics      = require('../services/graphAnalyticsService');
const subSvc         = require('../services/subscriptionService');
const pedagogySvc    = require('../services/pedagogySignalService');
const { authenticateUser }  = require('../middlewares');
const { authenticateAdmin } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── Graph Analytics ───────────────────────────────────────────────────────────

router.get('/graph/programs', authenticateAdmin, h(async (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit) || 20, 100);
  const category = req.query.category || null;
  const data = await analytics.getTopPrograms({ limit, category });
  res.json({ status: true, data });
}));

router.get('/graph/content/reused', authenticateAdmin, h(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const data = await analytics.getMostReusedContent({ limit });
  res.json({ status: true, data });
}));

router.get('/graph/instructors', authenticateAdmin, h(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const data = await analytics.getInstructorReach({ limit });
  res.json({ status: true, data });
}));

router.get('/graph/velocity', authenticateAdmin, h(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);
  const data = await analytics.getContentVelocity({ days });
  res.json({ status: true, data });
}));

router.get('/graph/categories', authenticateAdmin, h(async (req, res) => {
  const data = await analytics.getCategoryDistribution();
  res.json({ status: true, data });
}));

router.get('/graph/drift/:logicalId', authenticateAdmin, h(async (req, res) => {
  const data = await analytics.getSemanticDrift(req.params.logicalId);
  res.json({ status: true, data });
}));

// GET /api/analytics/graph/vitality?cids=ck_abc,ck_xyz
// Delegates to pedagogySignalService.computeVitality (already built in Phase 0)
router.get('/graph/vitality', authenticateAdmin, h(async (req, res) => {
  const cids = String(req.query.cids || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (!cids.length) {
    return res.status(400).json({ status: false, message: 'cids query param required (comma-separated)' });
  }

  const data = await pedagogySvc.computeVitality(cids);
  res.json({ status: true, data });
}));

// GET /api/analytics/graph/isolated — dead-end content nodes in the pedagogy graph
router.get('/graph/isolated', authenticateAdmin, h(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const data = await pedagogySvc.findIsolatedContent(limit);
  res.json({ status: true, data });
}));

// ── Citizen Audit Export ──────────────────────────────────────────────────────

router.get('/audit/:citizenId', authenticateAdmin, h(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 90, 365);
  const data = await analytics.exportCitizenAudit(req.params.citizenId, { days });
  res.json({ status: true, data });
}));

// ── Semantic Subscriptions ────────────────────────────────────────────────────

// POST /api/analytics/subscriptions — create subscription
// Body: { watchType: 'program'|'category'|'instructor'|'cid', watchValue: string }
router.post('/subscriptions', authenticateUser, h(async (req, res) => {
  const { watchType, watchValue } = req.body;
  if (!watchType || !watchValue) {
    return res.status(400).json({ status: false, message: 'watchType and watchValue are required' });
  }

  const citizenId = `CB${String(req.user._id)}`;
  const sub = await subSvc.subscribe(citizenId, watchType, String(watchValue).trim());
  res.status(201).json({ status: true, data: sub });
}));

// GET /api/analytics/subscriptions — list my subscriptions
router.get('/subscriptions', authenticateUser, h(async (req, res) => {
  const citizenId = `CB${String(req.user._id)}`;
  const data = await subSvc.getSubscriptions(citizenId);
  res.json({ status: true, data });
}));

// DELETE /api/analytics/subscriptions/:id — cancel subscription
router.delete('/subscriptions/:id', authenticateUser, h(async (req, res) => {
  const citizenId = `CB${String(req.user._id)}`;
  const data = await subSvc.unsubscribe(citizenId, req.params.id);
  res.json({ status: true, data });
}));

module.exports = router;
