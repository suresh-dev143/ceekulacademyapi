'use strict';

/**
 * Page Service
 *
 * Core responsibility: resolve which ad criteria apply for a given student
 * on a given page, according to the page's control mode.
 *
 * Mode 1 — teacher mandatory:  always use teacher's page adCriteria
 * Mode 2 — student override:   start from teacher criteria; let student replace
 *                              individual fields if they have preferences set
 * Mode 3 — private per user:   ignore teacher criteria entirely; use the
 *                              student's own private page criteria
 */

const Page        = require('../models/pageModel');
const Preferences = require('../models/preferencesModel');

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function createPage(ownerId, ownerRole, data) {
  const page = new Page({ ownerId, ownerRole, ...data });
  return page.save();
}

async function updatePage(pageId, ownerId, updates) {
  return Page.findOneAndUpdate(
    { _id: pageId, ownerId },
    { $set: updates },
    { new: true, runValidators: true }
  );
}

async function getMyPages(ownerId) {
  return Page.find({ ownerId, isActive: true }).sort({ createdAt: -1 }).lean();
}

async function getPageById(pageId) {
  return Page.findById(pageId).lean();
}

async function getPageForLecture(lectureId, pageType = 'teacher_global') {
  return Page.findOne({ lectureId, pageType, isActive: true }).lean();
}

async function deactivatePage(pageId, ownerId) {
  return Page.findOneAndUpdate(
    { _id: pageId, ownerId },
    { $set: { isActive: false } },
    { new: true }
  );
}

// ── Criteria resolution ───────────────────────────────────────────────────────

/**
 * Determine the effective ad criteria for a student on a given page.
 * This is the central decision function consumed by the matching engine.
 *
 * @param {string} pageId   - The page whose settings govern the session
 * @param {string} studentId
 * @returns {Promise<{ categories: string[], themes: string[], minRatePerSecond: number }>}
 */
async function resolveEffectiveCriteria(pageId, studentId) {
  const page = await Page.findById(pageId).lean();
  if (!page) throw new Error('Page not found');
  if (!page.isActive) throw new Error('Page is inactive');

  switch (page.controlMode) {
    case 1:
      // Teacher mandatory — every student gets the same criteria
      return _normaliseCriteria(page.adCriteria);

    case 2: {
      // Student can override — merge teacher defaults with student preferences
      const prefs = await Preferences.findOne({ userId: studentId }).lean();
      return {
        categories: prefs?.preferredCategories?.length
          ? _filterBlocked(prefs.preferredCategories, prefs.blockedCategories)
          : _normaliseCriteria(page.adCriteria).categories,
        themes: prefs?.preferredThemes?.length
          ? prefs.preferredThemes
          : _normaliseCriteria(page.adCriteria).themes,
        // Teacher's rate floor always wins (max of teacher vs student preference)
        minRatePerSecond: Math.max(
          page.adCriteria?.minRatePerSecond ?? 0,
          prefs?.minimumAdRate ?? 0
        )
      };
    }

    case 3: {
      // Private per user — find student's own private page
      const privatePage = await Page.findOne({
        ownerId:  studentId,
        pageType: 'private',
        isActive: true
      }).lean();
      return privatePage
        ? _normaliseCriteria(privatePage.adCriteria)
        : _normaliseCriteria(page.adCriteria); // fall back to teacher if no private page
    }

    default:
      return _normaliseCriteria(page.adCriteria);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _normaliseCriteria(criteria) {
  return {
    categories:       Array.isArray(criteria?.categories) ? criteria.categories : [],
    themes:           Array.isArray(criteria?.themes)     ? criteria.themes     : [],
    minRatePerSecond: criteria?.minRatePerSecond ?? 0
  };
}

function _filterBlocked(preferred, blocked = []) {
  if (!blocked?.length) return preferred;
  return preferred.filter(c => !blocked.includes(c));
}

// ── Stats update (called after ad revenue is recorded) ───────────────────────

async function incrementRevenue(pageId, amount) {
  await Page.findByIdAndUpdate(pageId, {
    $inc: { totalAdRevenue: amount }
  });
}

async function incrementViewers(pageId) {
  await Page.findByIdAndUpdate(pageId, {
    $inc: { totalViewers: 1 }
  });
}

module.exports = {
  createPage,
  updatePage,
  getMyPages,
  getPageById,
  getPageForLecture,
  deactivatePage,
  resolveEffectiveCriteria,
  incrementRevenue,
  incrementViewers
};
