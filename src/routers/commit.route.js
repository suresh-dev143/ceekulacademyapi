'use strict';

/**
 * UCRS Commit Router
 *
 * POST   /api/commit                        — run UCE pipeline, returns { cid, version, ... }
 * GET    /api/commit/content/:cid           — resolve latest version of a CID/logicalId
 * GET    /api/commit/content/:cid/v/:ver    — resolve specific version
 * GET    /api/commit/history/:logicalId     — full version chain (auth required)
 * GET    /api/commit/lineage/:cid           — full semantic trace across all UCRS subsystems
 * GET    /api/commit/consistency            — UCE↔UCRS consistency check (admin)
 * POST   /api/commit/resolve-many           — batch resolve up to 50 refs
 * GET    /api/commit/search                 — full-text search over approved content
 *
 * Reference Graph:
 * POST   /api/commit/graph/edge             — manually add a reference edge
 * GET    /api/commit/graph/:cid/out         — outbound edges (what this content references)
 * GET    /api/commit/graph/:cid/in          — inbound edges (what references this content)
 * GET    /api/commit/graph/:cid/affected    — BFS impact analysis (transitive dependents)
 */

const express              = require('express');
const router               = express.Router();
const commitSvc            = require('../services/universalCommitService');
const refResolver          = require('../services/refResolverService');
const graphSvc             = require('../services/referenceGraphService');
const UceContent           = require('../models/uceContentModel');
const UceVersionRegistry   = require('../models/uceVersionRegistryModel');
const UceOutbox            = require('../models/uceOutboxModel');
const UCRSCommit           = require('../models/ucrsCommitModel');
const AgentTask            = require('../models/agentTaskModel');
const { authenticateAdmin } = require('../middlewares');
const { authenticateUser } = require('../middlewares');

// Async error wrapper
function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── POST /api/commit ──────────────────────────────────────────────────────────
// Run the full UCE pipeline. Returns 201 on new commit, 200 on dedup hit.

router.post('/', authenticateUser, h(async (req, res) => {
  const { source, contentType, payload, parentCid } = req.body;

  if (!contentType) {
    return res.status(400).json({ status: false, message: 'contentType is required' });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ status: false, message: 'payload must be a non-null object' });
  }

  const result = await commitSvc.commit({
    source:    source || 'api',
    contentType,
    payload,
    ownerId:   req.user._id,
    parentCid: parentCid || null,
    traceId:   req.requestId || null,
  });

  res.status(result.fromDedupe ? 200 : 201).json({ status: true, data: result });
}));

// ── GET /api/commit/content/:cid ──────────────────────────────────────────────
// Resolve a CID or logicalId to its latest approved content. No auth required
// (content is approved before it reaches here).

router.get('/content/:cid', h(async (req, res) => {
  const result = await refResolver.resolve({ contentRef: req.params.cid });
  res.json({ status: true, data: result });
}));

// ── GET /api/commit/content/:cid/v/:version ───────────────────────────────────
// Resolve a specific version of a CID or logicalId.

router.get('/content/:cid/v/:version', h(async (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (!Number.isInteger(version) || version < 1) {
    return res.status(400).json({ status: false, message: 'version must be a positive integer' });
  }
  const result = await refResolver.resolve({ contentRef: req.params.cid, version });
  res.json({ status: true, data: result });
}));

// ── GET /api/commit/diff/:cid ─────────────────────────────────────────────────
// Return the semantic diff stored on the version registry entry for this CID.
// diff is null for v1 (no parent). For v2+, shows exactly what changed.

router.get('/diff/:cid', h(async (req, res) => {
  const entry = await UceVersionRegistry.findOne({ cid: req.params.cid })
    .select('cid version logicalId parentCid contentType committedAt diff')
    .lean();
  if (!entry) {
    return res.status(404).json({ status: false, message: 'CID not found in version registry' });
  }
  res.json({ status: true, data: entry });
}));

// ── GET /api/commit/history/:logicalId ───────────────────────────────────────
// Full version chain for a logicalId. Auth required (internal use by editors).

router.get('/history/:logicalId', authenticateUser, h(async (req, res) => {
  const history = await commitSvc.getHistory(req.params.logicalId);
  res.json({ status: true, data: history });
}));

// ── POST /api/commit/resolve-many ─────────────────────────────────────────────
// Batch resolve up to 50 refs in one round trip.
// Body: { refs: [{ contentRef, version? }, ...] }

router.post('/resolve-many', h(async (req, res) => {
  const { refs } = req.body;
  if (!Array.isArray(refs) || refs.length === 0) {
    return res.status(400).json({ status: false, message: 'refs must be a non-empty array' });
  }
  if (refs.length > 50) {
    return res.status(400).json({ status: false, message: 'Maximum 50 refs per batch' });
  }
  const results = await refResolver.resolveMany(refs);
  res.json({ status: true, data: results });
}));

// ── GET /api/commit/search ────────────────────────────────────────────────────
// Full-text search over approved content using MongoDB text index.
// Query params: q (required), contentType (optional), page, limit

router.get('/search', h(async (req, res) => {
  const { q, contentType, page = '1', limit = '20' } = req.query;

  if (!q || String(q).trim().length === 0) {
    return res.status(400).json({ status: false, message: 'q query parameter is required' });
  }

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

  const filter = { status: 'approved', $text: { $search: String(q).trim() } };
  if (contentType) filter.contentType = String(contentType);

  const [results, total] = await Promise.all([
    UceContent
      .find(filter, { score: { $meta: 'textScore' }, payload: 1, cid: 1, contentType: 1, createdAt: 1 })
      .sort({ score: { $meta: 'textScore' } })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    UceContent.countDocuments(filter),
  ]);

  res.json({
    status: true,
    data:   { results, total, page: pageNum, limit: limitNum },
  });
}));

// ── Reference Graph ───────────────────────────────────────────────────────────

// POST /api/commit/graph/edge — manually register a semantic reference between two CIDs
router.post('/graph/edge', authenticateUser, h(async (req, res) => {
  const { fromCid, toCid, edgeType, metadata } = req.body;
  if (!fromCid || !toCid || !edgeType) {
    return res.status(400).json({ status: false, message: 'fromCid, toCid, edgeType are required' });
  }
  const edge = await graphSvc.addEdge({ fromCid, toCid, edgeType, ownerId: req.user._id, metadata });
  res.status(edge ? 201 : 200).json({ status: true, data: edge });
}));

// GET /api/commit/graph/:cid/out — what does this content reference or derive from?
router.get('/graph/:cid/out', h(async (req, res) => {
  const edges = await graphSvc.getOutEdges(req.params.cid, req.query.edgeType || null);
  res.json({ status: true, data: edges });
}));

// GET /api/commit/graph/:cid/in — what content references or derives from this?
router.get('/graph/:cid/in', h(async (req, res) => {
  const edges = await graphSvc.getInEdges(req.params.cid, req.query.edgeType || null);
  res.json({ status: true, data: edges });
}));

// GET /api/commit/graph/:cid/affected — BFS: all content that transitively depends on this CID
router.get('/graph/:cid/affected', h(async (req, res) => {
  const maxDepth = Math.min(parseInt(req.query.depth) || 3, 5);
  const affected = await graphSvc.getAffectedContent(req.params.cid, maxDepth);
  res.json({ status: true, data: affected, count: affected.length });
}));

// ── GET /api/commit/lineage/:cid — full semantic trace ───────────────────────
// Returns UCE content + version chain + UCRS commits + agent tasks + graph edges + outbox entry.
// Useful for debugging the full life of a CID across all UCRS subsystems.

router.get('/lineage/:cid', h(async (req, res) => {
  const { cid } = req.params;

  const [content, versionEntry, outboxEntry] = await Promise.all([
    UceContent.findOne({ cid }).lean(),
    UceVersionRegistry.findOne({ cid }).lean(),
    UceOutbox.findOne({ cid }).sort({ createdAt: -1 }).lean(),
  ]);

  if (!content && !versionEntry) {
    return res.status(404).json({ status: false, message: 'CID not found' });
  }

  const logicalId = versionEntry?.logicalId;

  const [versionChain, ucrsCommits, agentTasks, outEdges, inEdges] = await Promise.all([
    logicalId ? commitSvc.getHistory(logicalId) : Promise.resolve([]),
    UCRSCommit.find({ contentCid: cid }).sort({ createdAt: -1 }).lean(),
    AgentTask.find({ $or: [{ inputCid: cid }, { outputCid: cid }] }).lean(),
    graphSvc.getOutEdges(cid, null),
    graphSvc.getInEdges(cid, null),
  ]);

  res.json({ status: true, data: {
    cid,
    content,
    versionEntry,
    versionChain,
    ucrsCommits,
    agentTasks,
    referenceGraph: { outEdges, inEdges },
    outbox: outboxEntry,
  }});
}));

// ── GET /api/commit/consistency — UCE↔UCRS consistency check (admin only) ────
// Detects orphaned registry entries, stuck outbox entries, and outbox backlog.

router.get('/consistency', authenticateAdmin, h(async (req, res) => {
  const cutoff5m  = new Date(Date.now() - 5 * 60 * 1000);
  const cutoff60s = new Date(Date.now() - 60_000);

  const registryEntries = await UceVersionRegistry
    .find({ committedAt: { $lt: cutoff60s } }, { cid: 1 })
    .lean();

  let orphanCount = 0;
  let orphanCids  = [];

  if (registryEntries.length > 0) {
    const regCids = registryEntries.map(e => e.cid);
    const existingContent = await UceContent.find({ cid: { $in: regCids } }, { cid: 1 }).lean();
    const existingCids    = new Set(existingContent.map(c => c.cid));
    orphanCids  = regCids.filter(c => !existingCids.has(c));
    orphanCount = orphanCids.length;
  }

  const [stuckOutbox, pendingOutbox, failedOutbox] = await Promise.all([
    UceOutbox.countDocuments({ status: 'processing', lastAttemptAt: { $lt: cutoff5m } }),
    UceOutbox.countDocuments({ status: 'pending' }),
    UceOutbox.countDocuments({ status: 'failed' }),
  ]);

  const healthy = orphanCount === 0 && stuckOutbox === 0 && failedOutbox === 0;

  res.json({ status: true, data: {
    healthy,
    checks: {
      orphanedRegistryEntries: { count: orphanCount, sample: orphanCids.slice(0, 10) },
      stuckOutboxEntries:      { count: stuckOutbox },
      outboxBacklog:           { pending: pendingOutbox, failed: failedOutbox },
    },
  }});
}));

// ── Outbox Admin (dead-letter inspection and recovery) ────────────────────────

// GET /api/commit/outbox/stats — counts by status
router.get('/outbox/stats', authenticateAdmin, h(async (req, res) => {
  const [pending, processing, processed, failed] = await Promise.all([
    UceOutbox.countDocuments({ status: 'pending' }),
    UceOutbox.countDocuments({ status: 'processing' }),
    UceOutbox.countDocuments({ status: 'processed' }),
    UceOutbox.countDocuments({ status: 'failed' }),
  ]);
  res.json({ status: true, data: { pending, processing, processed, failed } });
}));

// GET /api/commit/outbox/failed — list permanently failed entries (paginated)
router.get('/outbox/failed', authenticateAdmin, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const [entries, total] = await Promise.all([
    UceOutbox.find({ status: 'failed' })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    UceOutbox.countDocuments({ status: 'failed' }),
  ]);
  res.json({ status: true, data: { entries, total } });
}));

// POST /api/commit/outbox/retry/:id — reset a failed entry so the worker picks it up again
router.post('/outbox/retry/:id', authenticateAdmin, h(async (req, res) => {
  const entry = await UceOutbox.findOneAndUpdate(
    { _id: req.params.id, status: 'failed' },
    { $set: { status: 'pending', attempts: 0, errorMessage: null, lastAttemptAt: null } },
    { new: true }
  );
  if (!entry) {
    return res.status(404).json({ status: false, message: 'Failed outbox entry not found' });
  }
  res.json({ status: true, data: entry });
}));

// POST /api/commit/outbox/retry-all — reset all failed entries (use with care)
router.post('/outbox/retry-all', authenticateAdmin, h(async (req, res) => {
  const result = await UceOutbox.updateMany(
    { status: 'failed' },
    { $set: { status: 'pending', attempts: 0, errorMessage: null, lastAttemptAt: null } }
  );
  res.json({ status: true, data: { resetCount: result.modifiedCount } });
}));

module.exports = router;
