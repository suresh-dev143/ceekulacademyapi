'use strict';

/**
 * Ad Pre-Scheduler Service
 *
 * Builds and persists AdPlan documents BEFORE runtime.
 * Called by:
 *   - Workshop/Lecture session start hooks (5 min before ad break)
 *   - Background cron (nightly warm-up for scheduled sessions)
 *   - Manual trigger via API (teachers, admin)
 *
 * Flow for one session:
 *   1. Resolve page criteria (mandatory + optional, controlMode 1/2/3)
 *   2. Fetch candidates from AdInvertedIndex (O(1) per key)
 *   3. Filter eligible (live budget check — one lean DB query)
 *   4. Score optional criteria
 *   5. Greedy pack into 600s
 *   6. Store result in AdPlan (upsert by sessionKey)
 *   7. Write to Redis with TTL = plan.expiresAt
 *
 * On success: returns { sessionKey, slots, totalDuration, computedAt }
 */

const Page          = require('../models/pageModel');
const AdPlan        = require('../models/adPlanModel');
const packer        = require('./adPackingService');

const PLAN_TTL_SECONDS = 3600; // plans valid for 1hr; recomputed for next session

// ── Optional Redis (degrades gracefully) ──────────────────────────────────────
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

// ── Criteria resolution (mirrors pageService logic without import cycle) ──────

async function _resolveCriteria(pageId, userId = null) {
  const page = await Page.findById(pageId).lean();
  if (!page) return { mandatoryCriteria: {}, optionalCriteria: {} };

  const mc = page.mandatoryCriteria ?? {};
  const oc = page.optionalCriteria  ?? {};

  // Mode 2/3: if userId given, try to fetch student's own page criteria
  if ((page.controlMode === 2 || page.controlMode === 3) && userId) {
    const studentPage = await Page.findOne({
      ownerId:   userId,
      pageType:  'student',
      lectureId: page.lectureId,
      isActive:  true,
    }).lean();

    if (studentPage) {
      return {
        mandatoryCriteria: studentPage.mandatoryCriteria ?? mc,
        optionalCriteria:  studentPage.optionalCriteria  ?? oc,
      };
    }
  }

  return { mandatoryCriteria: mc, optionalCriteria: oc };
}

// ── Main: precompute plan for a page + optional user ─────────────────────────

async function precompute({ pageId, userId = null, learnerProfile = {}, force = false }) {
  const sessionKey = userId
    ? `session:${pageId}:${userId}`
    : `page:${pageId}`;

  // Skip if a fresh plan already exists (unless force=true)
  if (!force) {
    const existing = await AdPlan.findOne({ sessionKey, expiresAt: { $gt: new Date() } }).lean();
    if (existing) return _toResult(existing, true);
  }

  // 1. Resolve criteria
  const { mandatoryCriteria, optionalCriteria } = await _resolveCriteria(pageId, userId);

  // 2. Candidates from inverted index
  const rawEntries = await packer.candidatesFromIndex(
    mandatoryCriteria.categories  ?? [],
    mandatoryCriteria.themes      ?? [],
    mandatoryCriteria.ageGroup    ?? null,
  );

  // 3. Filter eligible (live budget/expiry check)
  const eligible = await packer.filterEligible(rawEntries);

  // 4. Score optional criteria
  const scored = packer.scoreEntries(eligible, optionalCriteria, learnerProfile);

  // 5. Greedy 600s pack
  const slots = packer.pack(scored);

  // 6. Persist plan (upsert)
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_TTL_SECONDS * 1000);

  const plan = await AdPlan.findOneAndUpdate(
    { sessionKey },
    {
      $set: {
        pageId:           pageId || null,
        userId:           userId || null,
        slots,
        totalDuration:    slots.reduce((s, sl) => s + sl.duration, 0),
        criteriaSnapshot: { mandatoryCriteria, optionalCriteria },
        computedAt:       now,
        expiresAt,
        deliveryCount:    0,
      },
    },
    { upsert: true, new: true }
  );

  // 7. Cache in Redis
  const r = await _getRedis();
  if (r) {
    try {
      await r.setEx(`adplan:${sessionKey}`, PLAN_TTL_SECONDS, JSON.stringify(_toResult(plan, false)));
    } catch (_) {}
  }

  return _toResult(plan, false);
}

// ── Batch: precompute for all active pages (nightly warm-up) ─────────────────

async function precomputeAll() {
  const pages = await Page.find({ isActive: true }, { _id: 1 }).lean();
  const results = [];

  for (const page of pages) {
    try {
      const result = await precompute({ pageId: page._id });
      results.push({ pageId: page._id, ok: true, slots: result.slots.length });
    } catch (err) {
      results.push({ pageId: page._id, ok: false, error: err.message });
    }
  }

  return results;
}

// ── Invalidate plan for a page (e.g. ad budget exhausted, criteria changed) ───

async function invalidate(pageId) {
  const pattern = `session:${pageId}:*`;
  const keyExact = `page:${pageId}`;

  await AdPlan.deleteMany({
    $or: [
      { sessionKey: keyExact },
      { pageId: pageId },
    ]
  });

  const r = await _getRedis();
  if (r) {
    try {
      const keys = await r.keys(`adplan:${pattern}`);
      if (keys.length) await r.del(keys);
      await r.del(`adplan:${keyExact}`);
    } catch (_) {}
  }
}

function _toResult(plan, fromCache) {
  return {
    sessionKey:    plan.sessionKey,
    slots:         plan.slots,
    totalDuration: plan.totalDuration,
    computedAt:    plan.computedAt,
    expiresAt:     plan.expiresAt,
    fromCache,
  };
}

module.exports = { precompute, precomputeAll, invalidate };
