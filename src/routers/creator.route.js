'use strict';

/**
 * B) Collaboration Engine API — Create Content lifecycle routes
 *
 * Draft flow:    POST /creator/draft  →  PATCH /creator/draft/:baseId  →  action
 * Actions:       POST /creator/:baseId/save      (auto-save update)
 *                POST /creator/:baseId/share     (invite collaborators)
 *                POST /creator/:baseId/publish   (go live)
 * Collaboration: POST /creator/:baseId/delta     (submit content delta)
 *                GET  /creator/:baseId/summary   (current AI summary)
 *                GET  /creator/:baseId/contributions
 * Versioning:    POST /creator/:baseId/republish (new version from published)
 */

const express = require('express');
const router  = express.Router();

const svc = require('../services/creatorService');
const { authenticateUser } = require('../middlewares');

router.use(authenticateUser);

// ── Guard helper ──────────────────────────────────────────────────────────────

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── Draft CRUD ─────────────────────────────────────────────────────────────────

// Create a new draft — assigns baseId and hybridId
router.post('/draft', h(async (req, res) => {
  const { title, contentType, domain, category, blocks, domainTags } = req.body;
  if (!title || !contentType || !domain || !category) {
    return res.status(400).json({ error: 'title, contentType, domain, and category are required' });
  }
  const draft = await svc.createDraft(req.user._id, { title, contentType, domain, category, blocks, domainTags });
  res.status(201).json({ data: draft });
}));

// List authenticated user's drafts
router.get('/drafts', h(async (req, res) => {
  const drafts = await svc.listDrafts(req.user._id);
  res.json({ data: drafts });
}));

// Get a single draft
router.get('/draft/:baseId', h(async (req, res) => {
  const draft = await svc.getDraft(req.params.baseId, req.user._id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json({ data: draft });
}));

// Update draft content (auto-save)
router.patch('/draft/:baseId', h(async (req, res) => {
  const draft = await svc.updateDraft(req.params.baseId, req.user._id, req.body);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json({ data: draft });
}));

// Delete draft
router.delete('/draft/:baseId', h(async (req, res) => {
  await svc.deleteDraft(req.params.baseId, req.user._id);
  res.json({ ok: true });
}));

// ── Action: Share ─────────────────────────────────────────────────────────────

/**
 * Share a draft with collaborators.
 * Body: { collaboratorIds: ["userId1", "userId2"] }
 * Moves draft → creator_content (state: shared).
 * Creates collaboration record.
 */
router.post('/:baseId/share', h(async (req, res) => {
  const { collaboratorIds } = req.body;
  const result = await svc.shareDraft(req.params.baseId, req.user._id, { collaboratorIds });
  res.json({ data: result });
}));

// ── Action: Collaboration delta ───────────────────────────────────────────────

/**
 * Submit a content delta from a collaborator.
 * Body: {
 *   addedWords, removedWords, addedMedia,
 *   summary,       // author's change note (≤ 300 chars)
 *   blocksDiff,    // [{blockId, op, type, textSnippet}]
 *   updatedBlocks, // full updated blocks array (optional — for live sync)
 * }
 * Increments contribution counters; appends to delta log.
 * AI summarization runs on a schedule — NOT triggered here.
 */
router.post('/:baseId/delta', h(async (req, res) => {
  const result = await svc.submitDelta(req.params.baseId, req.user._id, req.body);
  res.json({ data: result });
}));

// ── Action: Get AI summary ────────────────────────────────────────────────────

router.get('/:baseId/summary', h(async (req, res) => {
  const summary = await svc.getSummary(req.params.baseId);
  res.json({ data: summary });
}));

// ── Action: Contribution stats ────────────────────────────────────────────────

router.get('/:baseId/contributions', h(async (req, res) => {
  const data = await svc.getContributions(req.params.baseId, req.user._id);
  res.json({ data });
}));

// ── Action: Publish ───────────────────────────────────────────────────────────

/**
 * Publish shared content.  Sets state = 'published', esIndexed = false.
 * ES sync job picks up documents where state=published AND esIndexed=false.
 */
router.post('/:baseId/publish', h(async (req, res) => {
  const content = await svc.publishContent(req.params.baseId, req.user._id);
  res.json({ data: content });
}));

// ── Action: Republish (new version) ──────────────────────────────────────────

/**
 * Opens a new draft of an already-published piece.
 * Published version stays live.  New draft gets bumped version number.
 */
router.post('/:baseId/republish', h(async (req, res) => {
  const draft = await svc.republish(req.params.baseId, req.user._id);
  res.json({ data: draft });
}));

module.exports = router;
