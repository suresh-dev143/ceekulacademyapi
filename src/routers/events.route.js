'use strict';

/**
 * UCRS Event System Router — Phase 5 Resilience + Observability
 *
 * GET  /api/events/replay/:entityId           — entity lifecycle from outbox + ledger
 * GET  /api/events/replay/cid/:cid            — UCE content lifecycle (uce_outbox + ucrs_events)
 * GET  /api/events/outbox/stats               — combined UCE + UCRS outbox stats + latency
 * GET  /api/events/health                     — event system health (stuck entries, status)
 * POST /api/events/heal                       — trigger full self-healing run (admin)
 */

const express   = require('express');
const router    = express.Router();
const healer    = require('../services/selfHealingService');
const UCRSOutbox = require('../models/ucrsOutboxModel');
const UceOutbox  = require('../models/uceOutboxModel');
const UCRSEvent  = require('../models/ucrsEventModel');
const { authenticateAdmin } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── GET /api/events/replay/cid/:cid — UCE content lifecycle ──────────────────
// Reconstructs the full lifecycle of a content CID:
//   UCE outbox delivery record + UCRS outbox events referencing it +
//   UCRS ledger events where resourceId = cid
// Returns a unified, chronologically-sorted timeline.
//
// NOTE: This route must be declared BEFORE /replay/:entityId so Express does
// not mistake "cid" for an entityId value.

router.get('/replay/cid/:cid', authenticateAdmin, h(async (req, res) => {
  const { cid } = req.params;

  const [uceEntries, ucrsEntries, ledgerEvents] = await Promise.all([
    UceOutbox.find({ cid }).sort({ createdAt: 1 }).lean(),
    UCRSOutbox.find({ contentCid: cid }).sort({ createdAt: 1 }).lean(),
    UCRSEvent.find({ resourceId: cid }).sort({ occurredAt: 1 }).lean(),
  ]);

  // Unify into a single timeline with source tagging
  const timeline = [
    ...uceEntries.map(e => ({
      source:    'uce_outbox',
      eventType: e.eventType,
      entityId:  e.cid,
      status:    e.status,
      attempts:  e.attempts,
      payload:   e.payload,
      occurredAt: e.createdAt,
    })),
    ...ucrsEntries.map(e => ({
      source:       'ucrs_outbox',
      eventId:      e.eventId,
      correlationId: e.correlationId,
      eventType:    e.eventType,
      entityType:   e.entityType,
      entityId:     e.entityId,
      actorId:      e.actorId,
      status:       e.status,
      attempts:     e.attempts,
      payload:      e.payload,
      occurredAt:   e.createdAt,
    })),
    ...ledgerEvents.map(e => ({
      source:     'ledger',
      eventId:    e.eventId,
      eventType:  e.eventType,
      actorId:    e.actorId,
      subjectId:  e.subjectId,
      resourceId: e.resourceId,
      traceId:    e.traceId,
      payload:    e.payload,
      occurredAt: e.occurredAt,
    })),
  ].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

  res.json({ status: true, data: { cid, eventCount: timeline.length, timeline } });
}));

// ── GET /api/events/replay/:entityId — UCRS entity lifecycle ─────────────────
// Reconstructs the lifecycle of a UCRS entity (scheduleId, citizenId, etc.):
//   UCRS outbox entries where entityId = entityId +
//   UCRS ledger events where resourceId = entityId or subjectId = entityId
// Returns a unified, chronologically-sorted timeline.

router.get('/replay/:entityId', authenticateAdmin, h(async (req, res) => {
  const { entityId } = req.params;

  const [ucrsEntries, ledgerByResource, ledgerBySubject] = await Promise.all([
    UCRSOutbox.find({ entityId }).sort({ createdAt: 1 }).lean(),
    UCRSEvent.find({ resourceId: entityId }).sort({ occurredAt: 1 }).lean(),
    UCRSEvent.find({ subjectId:  entityId }).sort({ occurredAt: 1 }).lean(),
  ]);

  // Deduplicate ledger events that appear in both queries
  const ledgerMap = new Map();
  for (const e of [...ledgerByResource, ...ledgerBySubject]) {
    ledgerMap.set(e.eventId, e);
  }
  const ledgerEvents = [...ledgerMap.values()].sort((a, b) =>
    new Date(a.occurredAt) - new Date(b.occurredAt)
  );

  const timeline = [
    ...ucrsEntries.map(e => ({
      source:        'ucrs_outbox',
      eventId:       e.eventId,
      correlationId: e.correlationId,
      eventType:     e.eventType,
      entityType:    e.entityType,
      entityId:      e.entityId,
      actorId:       e.actorId,
      contentCid:    e.contentCid,
      status:        e.status,
      attempts:      e.attempts,
      payload:       e.payload,
      occurredAt:    e.createdAt,
    })),
    ...ledgerEvents.map(e => ({
      source:     'ledger',
      eventId:    e.eventId,
      eventType:  e.eventType,
      actorId:    e.actorId,
      subjectId:  e.subjectId,
      resourceId: e.resourceId,
      traceId:    e.traceId,
      payload:    e.payload,
      occurredAt: e.occurredAt,
    })),
  ].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

  res.json({ status: true, data: { entityId, eventCount: timeline.length, timeline } });
}));

// ── GET /api/events/outbox/stats — combined outbox observability ──────────────
// Returns counts by status, stuck entry counts, and per-eventType latency stats.
// Covers both ucrs_outbox and uce_outbox.

router.get('/outbox/stats', authenticateAdmin, h(async (req, res) => {
  const stats = await healer.getOutboxStats();
  res.json({ status: true, data: stats });
}));

// ── GET /api/events/health — event system health check ───────────────────────
// Returns: healthy boolean + stuck entries + outbox backlog summary.
// Lightweight — no aggregations, just counts.

router.get('/health', authenticateAdmin, h(async (req, res) => {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

  const [
    ucrsPending, ucrsFailed, ucrsStuck,
    ucePending,  uceFailed,  uceStuck,
  ] = await Promise.all([
    UCRSOutbox.countDocuments({ status: 'pending' }),
    UCRSOutbox.countDocuments({ status: 'failed' }),
    UCRSOutbox.countDocuments({ status: 'processing', lastAttemptAt: { $lt: staleThreshold } }),
    UceOutbox.countDocuments({ status: 'pending' }),
    UceOutbox.countDocuments({ status: 'failed' }),
    UceOutbox.countDocuments({ status: 'processing', lastAttemptAt: { $lt: staleThreshold } }),
  ]);

  const healthy = ucrsFailed === 0 && uceFailed === 0 && ucrsStuck === 0 && uceStuck === 0;

  res.json({
    status: true,
    data: {
      healthy,
      ucrsOutbox: { pending: ucrsPending, failed: ucrsFailed, stuck: ucrsStuck },
      uceOutbox:  { pending: ucePending,  failed: uceFailed,  stuck: uceStuck  },
    },
  });
}));

// ── POST /api/events/heal — trigger self-healing run ─────────────────────────
// Runs: stuck outbox reset + orphaned enrolment detection + commit bridge repair.
// Idempotent — safe to call multiple times.

router.post('/heal', authenticateAdmin, h(async (req, res) => {
  const report = await healer.runFullHeal();
  res.json({ status: true, data: report });
}));

module.exports = router;
