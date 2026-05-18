'use strict';

/**
 * UCRS Semantic Graph Router — Phase 4 Intelligence Layer
 *
 * Read-only graph queries over the living semantic knowledge graph.
 * No writes, no side effects.
 *
 * GET  /api/graph/program                      — Program tree (?title=X[&category=Y])
 * GET  /api/graph/program/instructors           — Instructors teaching a program (?title=X)
 * GET  /api/graph/content/:cid/reuse           — Where is this CID reused?
 * GET  /api/graph/content/:cid/impact          — Impact analysis if CID changes
 * GET  /api/graph/content/:cid/enrolments      — Citizens enrolled via this CID
 * GET  /api/graph/instructor/:instructorId      — All content by instructor
 * GET  /api/graph/consistency                  — Semantic consistency check (admin)
 */

const express   = require('express');
const router    = express.Router();
const graph     = require('../services/semanticGraphService');
const { authenticateUser }  = require('../middlewares');
const { authenticateAdmin } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── GET /api/graph/program ────────────────────────────────────────────────────
// Program → Section → Content hierarchy derived from schedules.
// ?title (required), ?category (optional), ?includeInactive=true (optional)

router.get('/program', h(async (req, res) => {
  const { title, category, includeInactive } = req.query;
  if (!title || !String(title).trim()) {
    return res.status(400).json({ status: false, message: 'title query parameter is required' });
  }

  const tree = await graph.getProgramTree(
    String(title).trim(),
    {
      category:        category ? String(category).trim() : null,
      includeInactive: includeInactive === 'true',
    }
  );

  res.json({ status: true, data: tree });
}));

// ── GET /api/graph/program/instructors ────────────────────────────────────────
// Which instructors are teaching a given programTitle?
// ?title (required)

router.get('/program/instructors', h(async (req, res) => {
  const { title } = req.query;
  if (!title || !String(title).trim()) {
    return res.status(400).json({ status: false, message: 'title query parameter is required' });
  }

  const instructors = await graph.getInstructorsForProgram(String(title).trim());
  res.json({ status: true, data: instructors });
}));

// ── GET /api/graph/content/:cid/reuse ─────────────────────────────────────────
// Where is this CID reused? All schedules that reference it, grouped by category.

router.get('/content/:cid/reuse', h(async (req, res) => {
  const result = await graph.getContentReuse(req.params.cid);
  res.json({ status: true, data: result });
}));

// ── GET /api/graph/content/:cid/impact ────────────────────────────────────────
// Deterministic impact analysis: which schedules, enrolments, and programs would
// be affected if this CID were changed or retired?
// Includes BFS over derived CIDs via reference graph.

router.get('/content/:cid/impact', authenticateUser, h(async (req, res) => {
  const result = await graph.getImpactReport(req.params.cid);
  res.json({ status: true, data: result });
}));

// ── GET /api/graph/content/:cid/enrolments ────────────────────────────────────
// Which citizens are enrolled in schedules that reference this CID?

router.get('/content/:cid/enrolments', authenticateUser, h(async (req, res) => {
  const result = await graph.getEnrolmentMap(req.params.cid);
  res.json({ status: true, data: result });
}));

// ── GET /api/graph/instructor/:instructorId ────────────────────────────────────
// All schedules and content CIDs associated with an instructor.
// Matches both instructorId and createdBy fields.
// ?limit, ?page for pagination.

router.get('/instructor/:instructorId', h(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const page  = Math.max(parseInt(req.query.page)  || 0, 0);

  const result = await graph.getInstructorContent(req.params.instructorId, { limit, page });
  res.json({ status: true, data: result });
}));

// ── GET /api/graph/consistency ────────────────────────────────────────────────
// Semantic consistency validation (admin only).
// Detects: orphaned CID refs, schedules missing CID, title inconsistencies across categories,
// and schedules missing ownership.

router.get('/consistency', authenticateAdmin, h(async (req, res) => {
  const result = await graph.validateSemanticConsistency();
  res.json({ status: true, data: result });
}));

module.exports = router;
