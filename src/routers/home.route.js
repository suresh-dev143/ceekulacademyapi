'use strict';

const express = require('express');
const router  = express.Router();
const { buildHomeFeed, getDiscoveryPage } = require('../services/homeFeedService');

// ── Middleware stub — replace with your real auth middleware ─────────────────
// Expects req.user = { _id, citizenId } set by upstream auth.
function requireAuth(req, res, next) {
  if (!req.user?._id) {
    return res.status(401).json({ status: false, message: 'Authentication required' });
  }
  next();
}

/**
 * GET /api/home/feed
 *
 * Main homepage payload — enrolled schedules, discovery, trending,
 * subscription notifications, need signals (consent-gated), screen ref,
 * and the server-computed rendering tier.
 *
 * Query params:
 *   deviceId          — device fingerprint string (optional)
 *   batteryLevel      — 0–1 (optional, sent by app on each launch)
 *   networkQuality    — poor | fair | good | excellent (optional)
 *   performanceTier   — low | mid | high | flagship (optional)
 */
router.get('/feed', requireAuth, async (req, res, next) => {
  try {
    const { _id: userId, citizenId } = req.user;
    const { deviceId, batteryLevel, networkQuality, performanceTier } = req.query;

    // Build a real-time device override from query params (client reports on launch)
    const deviceOverride = {};
    if (batteryLevel   !== undefined) deviceOverride.batteryLevel   = parseFloat(batteryLevel);
    if (networkQuality !== undefined) deviceOverride.networkQuality = networkQuality;
    if (performanceTier !== undefined) deviceOverride.performanceTier = performanceTier;

    const feed = await buildHomeFeed({
      userId:      String(userId),
      citizenId,
      deviceId:    deviceId || null,
      deviceOverride,
    });

    res.status(200).json({ status: true, data: feed });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/home/discovery
 *
 * Paginated discovery feed — for infinite scroll / category filter.
 *
 * Query params:
 *   animationLevel — baseline | standard | cinematic | immersive  (default: standard)
 *   category       — filter by category (optional)
 *   limit          — page size (default: 20, max: 50)
 *   skip           — offset (default: 0)
 */
router.get('/discovery', requireAuth, async (req, res, next) => {
  try {
    const {
      animationLevel = 'standard',
      category,
      limit  = '20',
      skip   = '0',
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 50);
    const parsedSkip  = parseInt(skip, 10) || 0;

    const page = await getDiscoveryPage({
      animationLevel,
      category: category || undefined,
      limit:    parsedLimit,
      skip:     parsedSkip,
    });

    res.status(200).json({ status: true, data: page });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
