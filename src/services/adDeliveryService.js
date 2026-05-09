'use strict';

/**
 * Ad Delivery Service — O(1) runtime ad plan fetcher.
 *
 * At the 50-minute mark (or any session ad break trigger), the client calls:
 *   GET /api/ads/plan/delivery/:sessionKey
 *
 * This service:
 *   1. Checks Redis first (L1 — ~1ms)
 *   2. Falls back to MongoDB AdPlan collection (L2 — ~5ms, indexed by sessionKey)
 *   3. If plan is missing or expired → triggers precompute on-demand (lazy fallback)
 *   4. Increments deliveryCount (fire-and-forget)
 *
 * Returns only CID references — NO content bodies.
 * The frontend resolves each slot.contentRef via GET /api/commit/content/:cid
 * which is itself cached at L1/L2/L3 in refResolverService.
 *
 * Cost: ~0 compute, ~1ms network round-trip after first plan computation.
 */

const AdPlan        = require('../models/adPlanModel');
const scheduler     = require('./adPreSchedulerService');

// ── Optional Redis ────────────────────────────────────────────────────────────
let _redis = null;
let _redisConnecting = false;

async function _getRedis() {
  if (_redis?.isReady) return _redis;
  if (_redisConnecting || !process.env.REDIS_URL) return null;
  try {
    _redisConnecting = true;
    const { createClient } = require('redis');
    _redis = createClient({ url: process.env.REDIS_URL });
    _redis.on('error', () => { _redis = null; _redisConnecting = false; });
    await _redis.connect();
    _redisConnecting = false;
    return _redis;
  } catch (_) {
    _redis = null;
    _redisConnecting = false;
    return null;
  }
}

// ── Main: O(1) plan delivery ──────────────────────────────────────────────────

async function deliver(sessionKey) {
  if (!sessionKey) throw Object.assign(new Error('sessionKey is required'), { status: 400 });

  const r = await _getRedis();

  // L1: Redis
  if (r) {
    try {
      const cached = await r.get(`adplan:${sessionKey}`);
      if (cached) {
        const plan = JSON.parse(cached);
        _incrementDelivery(sessionKey).catch(() => {});
        return { ...plan, fromCache: true };
      }
    } catch (_) {}
  }

  // L2: MongoDB
  const plan = await AdPlan.findOne({
    sessionKey,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (plan) {
    const result = _toDeliveryPayload(plan);
    // Re-populate Redis cache
    if (r) {
      try {
        const ttl = Math.floor((new Date(plan.expiresAt) - Date.now()) / 1000);
        if (ttl > 0) await r.setEx(`adplan:${sessionKey}`, ttl, JSON.stringify(result));
      } catch (_) {}
    }
    _incrementDelivery(sessionKey).catch(() => {});
    return { ...result, fromCache: false };
  }

  // L3: On-demand precompute (lazy fallback — rare after warm-up)
  const parts = sessionKey.split(':');
  let pageId = null;
  let userId = null;

  if (parts[0] === 'page') {
    pageId = parts[1];
  } else if (parts[0] === 'session') {
    pageId = parts[1];
    userId = parts[2];
  }

  if (!pageId) throw Object.assign(new Error('Invalid sessionKey format'), { status: 400 });

  const computed = await scheduler.precompute({ pageId, userId, force: true });
  return { ...computed, fromCache: false, lazily_computed: true };
}

// ── Batch: deliver for multiple sessions (e.g. a workshop with multiple rooms)

async function deliverMany(sessionKeys) {
  return Promise.all(sessionKeys.map(k => deliver(k).catch(err => ({ error: err.message, sessionKey: k }))));
}

// ── Invalidate on ad status change ────────────────────────────────────────────

async function invalidateForAd(adId) {
  // Find all plans that contain this ad and delete them (forces recompute on next request)
  await AdPlan.deleteMany({ 'slots.adId': adId });

  const r = await _getRedis();
  if (r) {
    try {
      const keys = await r.keys('adplan:*');
      // Batch-check and purge plans containing this adId
      // (conservative: delete all cached plans — they'll recompute lazily)
      if (keys.length) await r.del(keys);
    } catch (_) {}
  }
}

// ── Fire-and-forget delivery counter ──────────────────────────────────────────

async function _incrementDelivery(sessionKey) {
  await AdPlan.updateOne({ sessionKey }, { $inc: { deliveryCount: 1 } });
}

function _toDeliveryPayload(plan) {
  return {
    sessionKey:    plan.sessionKey,
    slots:         plan.slots,              // [{ contentRef, adId, startTime, endTime, duration }]
    totalDuration: plan.totalDuration,
    computedAt:    plan.computedAt,
    expiresAt:     plan.expiresAt,
  };
}

module.exports = { deliver, deliverMany, invalidateForAd };
