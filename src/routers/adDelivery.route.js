'use strict';

/**
 * Ad Delivery Router — precomputed, CID-based, O(1) runtime delivery
 *
 * GET  /api/ads/delivery/:sessionKey      — O(1) fetch precomputed plan
 * POST /api/ads/precompute                — trigger plan computation for a page
 * POST /api/ads/precompute/all            — batch warm-up (admin only)
 * GET  /api/ads/index                     — query inverted index (admin/debug)
 * POST /api/ads/index/upsert              — delta-update index for one ad
 * DELETE /api/ads/plan/:pageId            — invalidate plans for a page
 */

const express      = require('express');
const router       = express.Router();
const delivery     = require('../services/adDeliveryService');
const scheduler    = require('../services/adPreSchedulerService');
const packer       = require('../services/adPackingService');
const AdInvertedIndex = require('../models/adInvertedIndexModel');
const { authenticateUser } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { next(err); }
  };
}

// ── GET /api/ads/delivery/:sessionKey ──────────────────────────────────────────
// O(1) — Redis first, MongoDB second, on-demand precompute as last resort.
// Returns { slots: [{contentRef, adId, startTime, endTime, duration}], totalDuration }
// Frontend resolves each contentRef via GET /api/commit/content/:cid

router.get('/delivery/:sessionKey', authenticateUser, h(async (req, res) => {
  const plan = await delivery.deliver(req.params.sessionKey);
  res.json({ status: true, data: plan });
}));

// ── POST /api/ads/precompute ──────────────────────────────────────────────────
// Trigger precomputation for a specific page + optional user.
// Call 5 minutes before an ad break to warm up the plan.
// Body: { pageId, userId?, learnerProfile?, force? }

router.post('/precompute', authenticateUser, h(async (req, res) => {
  const { pageId, userId, learnerProfile, force } = req.body;
  if (!pageId) return res.status(400).json({ status: false, message: 'pageId is required' });

  const result = await scheduler.precompute({
    pageId,
    userId: userId || null,
    learnerProfile: learnerProfile || {},
    force: Boolean(force),
  });

  res.json({ status: true, data: result });
}));

// ── POST /api/ads/precompute/all ──────────────────────────────────────────────
// Batch warm-up for all active pages (nightly cron or admin trigger).
// Returns per-page results so failures are visible without stopping the batch.

router.post('/precompute/all', authenticateUser, h(async (req, res) => {
  const results = await scheduler.precomputeAll();
  const succeeded = results.filter(r => r.ok).length;
  res.json({ status: true, data: { total: results.length, succeeded, results } });
}));

// ── DELETE /api/ads/plan/:pageId ──────────────────────────────────────────────
// Invalidate all precomputed plans for a page (e.g. after criteria change).

router.delete('/plan/:pageId', authenticateUser, h(async (req, res) => {
  await scheduler.invalidate(req.params.pageId);
  res.json({ status: true, message: 'Plans invalidated' });
}));

// ── GET /api/ads/index ────────────────────────────────────────────────────────
// Query the inverted index (admin / debug use).
// Query params: indexType?, key?

router.get('/index', authenticateUser, h(async (req, res) => {
  const filter = {};
  if (req.query.indexType) filter.indexType = req.query.indexType;
  if (req.query.key)       filter.key       = req.query.key.toLowerCase();

  const docs = await AdInvertedIndex.find(filter).lean();
  res.json({ status: true, data: docs });
}));

// ── POST /api/ads/index/upsert ────────────────────────────────────────────────
// Delta-update the inverted index for one ad (called after UCE commit of an ad).
// Body: { adId, contentRef, rate, duration, category, themes?, ageGroup? }

router.post('/index/upsert', authenticateUser, h(async (req, res) => {
  const { adId, contentRef, rate, duration, category, themes, ageGroup } = req.body;
  if (!adId || !contentRef || !rate || !duration) {
    return res.status(400).json({ status: false, message: 'adId, contentRef, rate, duration are required' });
  }

  await packer.upsertIndexEntry({ adId, contentRef, rate, duration, category, themes: themes || [], ageGroup: ageGroup || 'all' });

  // Invalidate affected page plans so they recompute with new ad
  if (category) {
    const pages = await require('../models/pageModel').find({
      $or: [
        { 'mandatoryCriteria.categories': category.toLowerCase() },
        { 'adCriteria.categories': category.toLowerCase() },
        { isActive: true, 'mandatoryCriteria.categories': { $size: 0 } }, // no filter = all
      ],
      isActive: true,
    }, { _id: 1 }).lean();

    for (const page of pages) {
      scheduler.invalidate(page._id).catch(() => {});
    }
  }

  res.json({ status: true, message: 'Index updated' });
}));

// ── POST /api/ads/index/remove ────────────────────────────────────────────────
// Remove an ad from all index entries (on pause/archive).
// Body: { adId }

router.post('/index/remove', authenticateUser, h(async (req, res) => {
  const { adId } = req.body;
  if (!adId) return res.status(400).json({ status: false, message: 'adId is required' });

  await packer.removeFromIndex(adId);
  await delivery.invalidateForAd(adId);
  res.json({ status: true, message: 'Ad removed from index and plans invalidated' });
}));

module.exports = router;
