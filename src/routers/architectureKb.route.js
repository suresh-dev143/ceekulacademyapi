'use strict';

/**
 * Architecture Knowledge Base Router
 *
 * Specs (committed once, referenced forever):
 *   POST  /api/architecture/spec           — commit an architecture.spec document
 *   GET   /api/architecture/specs          — list all specs (optional ?domain=)
 *   GET   /api/architecture/spec/:cid      — get a specific spec by CID
 *
 * Queries (O(1) cache after first call per unique question):
 *   POST  /api/architecture/query          — submit a question, returns response
 *   GET   /api/architecture/queries        — list recent queries
 *   GET   /api/architecture/response/:queryCid — fetch response for a known queryCid
 */

const express   = require('express');
const router    = express.Router();
const kbSvc     = require('../services/architectureKbService');
const { authenticateUser } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── POST /api/architecture/spec ───────────────────────────────────────────────
// Commit a specification document. Trusted — should only be called by admins
// or internal tooling. Once committed, the CID is stable forever.

router.post('/spec', authenticateUser, h(async (req, res) => {
  const { specId, title, version, body, keywords, domain } = req.body;

  if (!specId || !title || !body) {
    return res.status(400).json({
      status: false,
      message: 'specId, title, and body are required',
    });
  }

  const result = await kbSvc.commitSpec(
    { specId, title, version, body, keywords, domain },
    req.user._id
  );

  res.status(result.fromDedupe ? 200 : 201).json({ status: true, data: result });
}));

// ── GET /api/architecture/specs ───────────────────────────────────────────────
router.get('/specs', authenticateUser, h(async (req, res) => {
  const result = await kbSvc.getSpecs({
    domain: req.query.domain,
    limit:  req.query.limit,
    offset: req.query.offset,
  });
  res.json({ status: true, data: result.specs, total: result.total, limit: result.limit, offset: result.offset });
}));

// ── GET /api/architecture/spec/:cid ──────────────────────────────────────────
router.get('/spec/:cid', authenticateUser, h(async (req, res) => {
  const spec = await kbSvc.getSpec(req.params.cid);
  if (!spec) {
    return res.status(404).json({ status: false, message: 'Spec not found' });
  }
  res.json({ status: true, data: spec });
}));

// ── POST /api/architecture/query ──────────────────────────────────────────────
// Submit an architectural question. If an identical question has been asked
// before, returns the cached Opus response instantly (zero AI cost).
// On a cache miss, calls Opus 4.7, commits the response, and returns it.

router.post('/query', authenticateUser, h(async (req, res) => {
  const { promptId, title, query: queryText, specRefs, parentCid, model } = req.body;

  if (!queryText || String(queryText).trim().length === 0) {
    return res.status(400).json({ status: false, message: 'query text is required' });
  }

  if (specRefs && (!Array.isArray(specRefs) || specRefs.length > 20)) {
    return res.status(400).json({ status: false, message: 'specRefs must be an array of ≤ 20 CIDs' });
  }

  const result = await kbSvc.query({
    promptId,
    title,
    queryText: String(queryText).trim(),
    specRefs:  specRefs || [],
    parentCid: parentCid || null,
    ownerId:   req.user._id,
    model,
  });

  // 200 = cache hit, 201 = new Opus call committed
  res.status(result.fromCache ? 200 : 201).json({ status: true, data: result });
}));

// ── GET /api/architecture/queries ─────────────────────────────────────────────
router.get('/queries', authenticateUser, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
  const offset = Math.max(parseInt(req.query.offset) || 0,  0);
  const list   = await kbSvc.listQueries({ limit, offset });
  res.json({ status: true, data: list, count: list.length });
}));

// ── GET /api/architecture/response/:queryCid ──────────────────────────────────
router.get('/response/:queryCid', authenticateUser, h(async (req, res) => {
  const doc = await kbSvc.getResponseForQuery(req.params.queryCid);
  if (!doc) {
    return res.status(404).json({ status: false, message: 'No response found for this queryCid' });
  }
  res.json({ status: true, data: doc });
}));

module.exports = router;
