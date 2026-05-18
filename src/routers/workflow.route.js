'use strict';

/**
 * Workflow Admin Router — Phase 6 Semantic Orchestration
 *
 * GET  /api/workflows/stats                — aggregate counts by name + status
 * GET  /api/workflows                      — paginated list of workflow instances
 * GET  /api/workflows/:workflowId          — single workflow instance detail
 * POST /api/workflows/trigger              — manually trigger a workflow (admin)
 * DELETE /api/workflows/failed            — purge completed/failed older than N days (admin)
 */

const express  = require('express');
const router   = express.Router();
const engine   = require('../services/workflowEngineService');
const UCRSWorkflow = require('../models/ucrsWorkflowModel');
const { authenticateAdmin } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// GET /api/workflows/stats
router.get('/stats', authenticateAdmin, h(async (req, res) => {
  const stats = await engine.getStats();
  res.json({ status: true, data: stats });
}));

// GET /api/workflows — paginated workflow instance list
router.get('/', authenticateAdmin, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const page   = Math.max(parseInt(req.query.page) || 0, 0);
  const name   = req.query.name   || null;
  const status = req.query.status || null;

  const filter = {};
  if (name)   filter.name   = name;
  if (status) filter.status = status;

  const [workflows, total] = await Promise.all([
    UCRSWorkflow.find(filter)
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean(),
    UCRSWorkflow.countDocuments(filter),
  ]);

  res.json({ status: true, data: { workflows, total, page, limit } });
}));

// GET /api/workflows/:workflowId — single instance detail
router.get('/:workflowId', authenticateAdmin, h(async (req, res) => {
  const wf = await UCRSWorkflow.findOne({ workflowId: req.params.workflowId }).lean();
  if (!wf) return res.status(404).json({ status: false, message: 'Workflow not found' });
  res.json({ status: true, data: wf });
}));

// POST /api/workflows/trigger — manually inject a workflow instance
// Body: { name, eventType, entityId, context }
router.post('/trigger', authenticateAdmin, h(async (req, res) => {
  const { name, eventType, entityId, context = {} } = req.body;
  if (!name || !eventType) {
    return res.status(400).json({ status: false, message: 'name and eventType are required' });
  }

  // Synthesise an event and pass it through the engine's normal trigger handler
  const syntheticEvent = {
    type:    eventType,
    payload: { eventId: `manual-${Date.now()}`, entityId, ...context },
    timestamp: new Date().toISOString(),
    version: '1.0',
  };

  await engine.handleEvent(syntheticEvent);
  res.json({ status: true, message: 'Workflow instance scheduled (if trigger matched a registered workflow)' });
}));

// DELETE /api/workflows/failed — purge completed + failed older than ?days (default 30)
router.delete('/failed', authenticateAdmin, h(async (req, res) => {
  const days   = Math.max(parseInt(req.query.days) || 30, 7); // minimum 7 days
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await UCRSWorkflow.deleteMany({
    status: { $in: ['completed', 'failed'] },
    completedAt: { $lt: cutoff },
  });

  res.json({ status: true, data: { purged: result.deletedCount, olderThanDays: days } });
}));

module.exports = router;
