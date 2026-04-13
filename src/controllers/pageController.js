'use strict';

const pageService        = require('../services/pageService');
const { matchAdsForPage } = require('../services/adMatchingService');

// ── POST /api/pages ──────────────────────────────────────────────────────────
async function createPage(req, res, next) {
  try {
    const { title, description, pageType, controlMode, adCriteria, lectureId, revenueSplit } = req.body;

    if (!title)    return res.status(400).json({ status: false, message: 'title is required' });
    if (!pageType) return res.status(400).json({ status: false, message: 'pageType is required' });

    const ownerRole = req.user.role === 'teacher' ? 'teacher' : 'student';

    const page = await pageService.createPage(req.user._id, ownerRole, {
      title,
      description,
      pageType,
      controlMode: controlMode ?? 1,
      adCriteria,
      lectureId,
      revenueSplit
    });

    res.status(201).json({ status: true, message: 'Page created', data: page });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/pages ───────────────────────────────────────────────────────────
async function getMyPages(req, res, next) {
  try {
    const pages = await pageService.getMyPages(req.user._id);
    res.json({ status: true, data: pages });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/pages/:pageId ────────────────────────────────────────────────────
async function getPageById(req, res, next) {
  try {
    const page = await pageService.getPageById(req.params.pageId);
    if (!page) return res.status(404).json({ status: false, message: 'Page not found' });
    res.json({ status: true, data: page });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/pages/lecture/:lectureId ─────────────────────────────────────────
// Returns the teacher_global page linked to a lecture (used by students at join)
async function getPageForLecture(req, res, next) {
  try {
    const { lectureId } = req.params;
    const { pageType = 'teacher_global' } = req.query;
    const page = await pageService.getPageForLecture(lectureId, pageType);
    if (!page) return res.status(404).json({ status: false, message: 'No page found for this lecture' });
    res.json({ status: true, data: page });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/pages/:pageId ──────────────────────────────────────────────────
async function updatePage(req, res, next) {
  try {
    const allowedFields = ['title', 'description', 'controlMode', 'adCriteria', 'revenueSplit', 'lectureId'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const page = await pageService.updatePage(req.params.pageId, req.user._id, updates);
    if (!page) return res.status(404).json({ status: false, message: 'Page not found or not yours' });

    res.json({ status: true, message: 'Page updated', data: page });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/pages/:pageId (soft delete) ───────────────────────────────────
async function deactivatePage(req, res, next) {
  try {
    const page = await pageService.deactivatePage(req.params.pageId, req.user._id);
    if (!page) return res.status(404).json({ status: false, message: 'Page not found or not yours' });
    res.json({ status: true, message: 'Page deactivated' });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/pages/:pageId/resolve ───────────────────────────────────────────
// Returns the effective ad criteria for the requesting student on this page
async function resolveEffectiveCriteria(req, res, next) {
  try {
    const { pageId } = req.params;
    const studentId  = (req.query.studentId || req.user._id).toString();
    const criteria   = await pageService.resolveEffectiveCriteria(pageId, studentId);
    res.json({ status: true, data: criteria });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/pages/:pageId/ads ────────────────────────────────────────────────
// Returns the personalised ad playlist for this student on this page.
// Called by the video player right after the session ends.
async function getAdsForPage(req, res, next) {
  try {
    const { pageId }  = req.params;
    const studentId   = req.user._id.toString();
    const result      = await matchAdsForPage(pageId, studentId);
    res.json({ status: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPage,
  getMyPages,
  getPageById,
  getPageForLecture,
  updatePage,
  deactivatePage,
  resolveEffectiveCriteria,
  getAdsForPage
};
