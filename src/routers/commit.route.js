'use strict';

/**
 * UCRS Commit Router
 *
 * POST   /api/commit                     — run UCE pipeline, returns { cid, version, ... }
 * GET    /api/commit/content/:cid        — resolve latest version of a CID/logicalId
 * GET    /api/commit/content/:cid/v/:ver — resolve specific version
 * GET    /api/commit/history/:logicalId  — full version chain (auth required)
 * POST   /api/commit/resolve-many        — batch resolve up to 50 refs
 * GET    /api/commit/search              — full-text search over approved content
 */

const express      = require('express');
const router       = express.Router();
const commitSvc    = require('../services/universalCommitService');
const refResolver  = require('../services/refResolverService');
const UceContent   = require('../models/uceContentModel');
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

module.exports = router;
