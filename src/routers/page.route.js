'use strict';

const express = require('express');
const router  = express.Router();

const {
  createPage,
  getMyPages,
  getPageById,
  getPageForLecture,
  updatePage,
  deactivatePage,
  resolveEffectiveCriteria,
  getAdsForPage
} = require('../controllers/pageController');

const { authenticateUser } = require('../middlewares');

// All page routes require authentication
router.use(authenticateUser);

// ── CRUD ─────────────────────────────────────────────────────────────────────
router.post('/',                             createPage);
router.get('/',                              getMyPages);
router.get('/lecture/:lectureId',            getPageForLecture);
router.get('/:pageId',                       getPageById);
router.patch('/:pageId',                     updatePage);
router.delete('/:pageId',                    deactivatePage);

// ── Page-aware ad operations ──────────────────────────────────────────────────
// Resolve what criteria apply to the requesting student on this page
router.get('/:pageId/resolve',               resolveEffectiveCriteria);
// Get personalised ad playlist for this student (called by video player after session)
router.get('/:pageId/ads',                   getAdsForPage);

module.exports = router;
