'use strict';

/**
 * Ad Matching Engine
 *
 * Algorithm:
 * 1. Determine whose preferences to use (teacher vs student)
 * 2. Get eligible ad categories
 * 3. Filter ads: active + budget > 0 + not expired + category match
 * 4. Rank by highest effective_rate (base_rate × multiplier)
 * 5. Fill 10-minute ad slot with top-ranked ads
 *
 * Performance: Redis cache for ad pool (TTL 60s)
 * Target: <100ms response for 10,000+ concurrent users
 */

const Advertisement = require('../models/advertisementModel');
const Preferences = require('../models/preferencesModel');
const Lecture = require('../models/lectureModel');
const { calculateEffectiveRate } = require('./pricingService');

// Redis client - optional, degrades gracefully if not available
let redisClient = null;
try {
  const redis = require('redis');
  redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { connectTimeout: 2000 }
  });
  redisClient.connect().catch(() => {
    console.warn('[AdMatching] Redis unavailable — running without cache');
    redisClient = null;
  });
} catch {
  console.warn('[AdMatching] Redis not installed — running without cache');
}

const AD_SLOT_DURATION = 10 * 60; // 10 minutes in seconds
const CACHE_TTL = 60; // seconds
const CACHE_PREFIX = 'admatch:';

// ── Optional criteria weight distribution (must sum to 1.0) ──────────────────
const OPTIONAL_WEIGHTS = {
  engagementScore:   0.30,
  behavioralSignals: 0.40,
  interestTags:      0.20,
  preferredLanguage: 0.10
};

/**
 * Main matching function
 * @param {string} studentId
 * @param {string} lectureId
 * @returns {Promise<Array>} sorted list of ads to fill the 10-min slot
 */
async function matchAdsForStudent(studentId, lectureId) {
  const startTime = Date.now();

  // 1. Load lecture
  const lecture = await Lecture.findById(lectureId).lean();
  if (!lecture) throw new Error('Lecture not found');

  const isLive = lecture.isLive || lecture.type === 'live';

  // 2. Determine preference source
  const categories = await getCategories(studentId, lecture);

  // 3. Cache key
  const cacheKey = `${CACHE_PREFIX}${categories.sort().join(',')}:${isLive}`;

  // 4. Try cache
  let eligibleAds = await getCachedAds(cacheKey);

  if (!eligibleAds) {
    // 5. DB query for eligible ads
    eligibleAds = await Advertisement.findEligibleAds(categories).lean();

    // 6. Apply effective rate
    eligibleAds = eligibleAds.map(ad => ({
      ...ad,
      effectiveRate: calculateEffectiveRate(ad.ratePerSecondPerStudent, isLive).effectiveRate,
      multiplier: calculateEffectiveRate(ad.ratePerSecondPerStudent, isLive).multiplier
    }));

    // Sort by effective rate descending
    eligibleAds.sort((a, b) => b.effectiveRate - a.effectiveRate);

    await setCachedAds(cacheKey, eligibleAds);
  }

  // 7. Fill 10-minute slot
  const selectedAds = fillAdSlot(eligibleAds, AD_SLOT_DURATION);

  const latency = Date.now() - startTime;
  if (latency > 100) {
    console.warn(`[AdMatching] High latency: ${latency}ms for student ${studentId}`);
  }

  return {
    ads: selectedAds,
    totalDuration: selectedAds.reduce((sum, ad) => sum + ad.duration, 0),
    categories,
    isLive,
    latencyMs: latency
  };
}

/**
 * Get ad categories based on preferences hierarchy
 */
async function getCategories(studentId, lecture) {
  // Teacher controls → use teacher preferences
  if (lecture.adControl === 'teacher') {
    if (lecture.preferredAdCategories && lecture.preferredAdCategories.length > 0) {
      return lecture.preferredAdCategories;
    }
    // Fall back to teacher's saved preferences
    const teacherPrefs = await Preferences.findOne({
      userId: lecture.teacherId,
      userRole: 'teacher'
    }).lean();
    if (teacherPrefs?.preferredCategories?.length > 0) {
      return filterCategories(teacherPrefs.preferredCategories, teacherPrefs.blockedCategories);
    }
  }

  // Student controls → use student preferences
  const studentPrefs = await Preferences.findOne({
    userId: studentId,
    userRole: 'student'
  }).lean();

  if (studentPrefs?.preferredCategories?.length > 0) {
    return filterCategories(studentPrefs.preferredCategories, studentPrefs.blockedCategories);
  }

  // Default: all categories
  return await getAllActiveCategories();
}

function filterCategories(preferred, blocked = []) {
  if (!blocked || blocked.length === 0) return preferred;
  return preferred.filter(c => !blocked.includes(c));
}

async function getAllActiveCategories() {
  const cached = await getCachedData('all_categories');
  if (cached) return cached;

  const categories = await Advertisement.distinct('category', {
    status: 'active',
    isActive: true,
    expiryDate: { $gt: new Date() },
    remainingBudget: { $gt: 0 }
  });

  await setCachedData('all_categories', categories, 300); // Cache 5 min
  return categories;
}

/**
 * Greedy algorithm to fill ad slot
 * Fills duration with highest-paying ads first
 */
function fillAdSlot(ads, targetDuration) {
  const selected = [];
  let remaining = targetDuration;
  const usedAds = new Set();

  for (const ad of ads) {
    if (remaining <= 0) break;
    if (usedAds.has(ad._id.toString())) continue;

    selected.push({
      adId: ad._id,
      title: ad.title,
      videoUrl: ad.videoUrl,
      duration: ad.duration,
      effectiveRate: ad.effectiveRate,
      multiplier: ad.multiplier,
      category: ad.category
    });

    usedAds.add(ad._id.toString());
    remaining -= ad.duration;

    // If we've gone past target, remove last ad and re-evaluate
    if (remaining < -10) { // Allow 10s overflow
      selected.pop();
      remaining += ad.duration;
    }
  }

  return selected;
}

// ==================== CACHE HELPERS ====================
async function getCachedAds(key) {
  if (!redisClient) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function setCachedAds(key, data, ttl = CACHE_TTL) {
  if (!redisClient) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch {
    // Non-critical
  }
}

async function getCachedData(key) {
  return getCachedAds(CACHE_PREFIX + key);
}

async function setCachedData(key, data, ttl) {
  return setCachedAds(CACHE_PREFIX + key, data, ttl);
}

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-CRITERIA MATCHING ENGINE
// Replaces the flat category-only filter with:
//   Step 1 — mandatory hard-filter  (zero-tolerance, excludes non-matches)
//   Step 2 — optional soft-scoring  (weighted, only when criteria are defined)
//   Step 3 — greedy 600-second slot fill (score-ordered)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Primary entry point for the multi-criteria scheduler.
 * Called by the SchedulerService when a session transitions to ad phase.
 *
 * @param {Object} pageContext  - Resolved page context (see schedulerService)
 * @param {Object} learnerProfile - { engagementScore, behavioralSignals, interests, preferredLanguage }
 * @returns {Promise<Array>}    - Ordered AdSlot array ready for playback
 */
async function matchAdsMultiCriteria(pageContext, learnerProfile = {}) {
  const startTime = Date.now();

  // 1. Fetch all currently eligible ads from DB (active, budget > 0, not expired)
  const baseQuery = {
    status:          'active',
    isActive:        true,
    remainingBudget: { $gt: 0 },
    expiryDate:      { $gt: new Date() }
  };

  const allAds = await Advertisement.find(baseQuery).lean();

  // 2. Mandatory filter — hard exclusion
  const mandatoryPassed = applyMandatoryFilter(allAds, pageContext);

  // 3. Optional scoring — soft ranking
  const scored = scoreOptionalCriteria(mandatoryPassed, pageContext, learnerProfile);

  // 4. Sort by score DESC, then by effectiveRate DESC as tiebreaker
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : b.ad.ratePerSecondPerStudent - a.ad.ratePerSecondPerStudent
  );

  // 5. Greedy bin-pack into 600-second window (multiples of 10 only)
  const slots = packAdSlots(scored, AD_SLOT_DURATION);

  const latency = Date.now() - startTime;
  if (latency > 100) {
    console.warn(`[AdMatching] Multi-criteria high latency: ${latency}ms`);
  }

  return {
    slots,
    totalDuration: slots.reduce((s, sl) => s + sl.advertisement.duration, 0),
    latencyMs:     latency
  };
}

/**
 * Step 1 — Mandatory filter.
 * An ad is excluded if ANY mandatory criterion defined on the page mismatches.
 * Empty arrays on the page side are treated as "no restriction" (pass-through).
 */
function applyMandatoryFilter(ads, pageContext) {
  const mc = pageContext.mandatoryCriteria || {};

  return ads.filter(ad => {
    const amc = ad.mandatoryCriteria || {};

    // Category — page defines categories → ad must declare at least one match
    if (mc.categories?.length && amc.categories?.length) {
      const overlap = amc.categories.some(c => mc.categories.includes(c));
      if (!overlap) return false;
    } else if (mc.categories?.length) {
      // Page restricts categories but ad declares none → use legacy ad.category
      if (!mc.categories.includes((ad.category || '').toLowerCase())) return false;
    }

    // Age group — 'all' on either side passes through
    if (mc.ageGroup && mc.ageGroup !== 'all' && amc.ageGroup && amc.ageGroup !== 'all') {
      if (mc.ageGroup !== amc.ageGroup) return false;
    }

    // Content type — page restricts → ad must overlap
    if (mc.contentTypes?.length && amc.contentTypes?.length) {
      const overlap = amc.contentTypes.some(t => mc.contentTypes.includes(t));
      if (!overlap) return false;
    }

    // Theme — page restricts → ad must overlap
    if (mc.themes?.length && amc.themes?.length) {
      const overlap = amc.themes.some(t => mc.themes.includes(t));
      if (!overlap) return false;
    }

    // Minimum rate
    if (mc.minRatePerSecond > 0) {
      if (ad.ratePerSecondPerStudent < mc.minRatePerSecond) return false;
    }

    return true;
  });
}

/**
 * Step 2 — Optional soft scoring.
 * Only criteria that are explicitly defined on BOTH the page and the ad are
 * evaluated. Missing criteria contribute 0 to the score (not a penalty).
 */
function scoreOptionalCriteria(ads, pageContext, learnerProfile) {
  const oc = pageContext.optionalCriteria || {};

  return ads.map(ad => {
    const aoc = ad.optionalCriteria || {};
    let score = 0;

    // Engagement proximity — lower distance → higher score
    const engTarget = aoc.engagementScoreTarget ?? oc.engagementScoreTarget;
    if (engTarget !== undefined && learnerProfile.engagementScore !== undefined) {
      const dist = Math.abs(engTarget - learnerProfile.engagementScore);
      score += (1 - dist / 100) * OPTIONAL_WEIGHTS.engagementScore;
    }

    // Behavioural signal overlap
    const signals = aoc.behavioralSignals?.length ? aoc.behavioralSignals : oc.behavioralSignals;
    if (signals?.length && learnerProfile.behavioralSignals?.length) {
      const matched = signals.filter(s => learnerProfile.behavioralSignals.includes(s)).length;
      score += (matched / signals.length) * OPTIONAL_WEIGHTS.behavioralSignals;
    }

    // Interest tag overlap
    const tags = aoc.interestTags?.length ? aoc.interestTags : oc.interestTags;
    if (tags?.length && learnerProfile.interests?.length) {
      const matched = tags.filter(t => learnerProfile.interests.includes(t)).length;
      score += (matched / tags.length) * OPTIONAL_WEIGHTS.interestTags;
    }

    // Language — binary match
    const lang = aoc.preferredLanguage || oc.preferredLanguage;
    if (lang && learnerProfile.preferredLanguage) {
      if (lang === learnerProfile.preferredLanguage) {
        score += OPTIONAL_WEIGHTS.preferredLanguage;
      }
    }

    return { ad, score };
  });
}

/**
 * Step 3 — Greedy bin-packing.
 * Fills exactly 600 seconds using score-ordered ads.
 * Only admits ads whose duration is a multiple of 10 and fits in remaining time.
 */
function packAdSlots(scoredAds, totalSeconds) {
  const slots    = [];
  let remaining  = totalSeconds;
  let cursor     = 0;
  const used     = new Set();

  for (const { ad, score } of scoredAds) {
    if (remaining <= 0) break;
    if (used.has(ad._id.toString())) continue;
    if (ad.duration % 10 !== 0 || ad.duration > remaining) continue;

    slots.push({
      advertisement: ad,
      startTime:     cursor,
      endTime:       cursor + ad.duration,
      matchScore:    Math.round(score * 1000) / 1000
    });

    used.add(ad._id.toString());
    cursor    += ad.duration;
    remaining -= ad.duration;
  }

  return slots;
}

/**
 * Invalidate ad cache when an ad is updated
 */
async function invalidateAdCache() {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(`${CACHE_PREFIX}*`);
    if (keys.length > 0) await redisClient.del(keys);
  } catch {
    // Non-critical
  }
}

/**
 * matchAdsForPage — page-aware matching (Mode 1 / 2 / 3).
 *
 * This is the primary entry point for the new page-based system.
 * It delegates criteria resolution to pageService, then runs the same
 * greedy fill algorithm used by matchAdsForStudent.
 *
 * Cache key: admatch:page:<pageId>:<studentId>  TTL: 30s (personalised)
 *
 * @param {string} pageId
 * @param {string} studentId
 * @returns {Promise<{ ads: Array, totalDuration: number, latencyMs: number }>}
 */
async function matchAdsForPage(pageId, studentId) {
  const startTime = Date.now();

  // Resolve effective criteria based on page control mode
  const { resolveEffectiveCriteria } = require('./pageService');
  const criteria = await resolveEffectiveCriteria(pageId, studentId);

  const cacheKey = `${CACHE_PREFIX}page:${pageId}:${studentId}`;
  let eligibleAds = await getCachedAds(cacheKey);

  if (!eligibleAds) {
    const now = new Date();

    const query = {
      status:          'active',
      isActive:        true,
      remainingBudget: { $gt: 0 },
      expiryDate:      { $gt: now }
    };

    if (criteria.categories?.length) {
      query.category = { $in: criteria.categories };
    }

    if (criteria.minRatePerSecond > 0) {
      query.ratePerSecondPerStudent = { $gte: criteria.minRatePerSecond };
    }

    eligibleAds = await Advertisement.find(query)
      .sort({ ratePerSecondPerStudent: -1 })
      .lean();

    // Apply effective rate using pricingService (no live/recorded distinction at page level)
    eligibleAds = eligibleAds.map(ad => ({
      ...ad,
      effectiveRate: ad.ratePerSecondPerStudent,
      multiplier:    1
    }));

    // Personalised results get a shorter TTL to stay fresh (30s vs 60s)
    await setCachedAds(cacheKey, eligibleAds, 30);
  }

  const selectedAds = fillAdSlot(eligibleAds, AD_SLOT_DURATION);
  const latency     = Date.now() - startTime;

  if (latency > 100) {
    console.warn(`[AdMatching] High latency: ${latency}ms for page ${pageId} student ${studentId}`);
  }

  return {
    ads:           selectedAds,
    totalDuration: selectedAds.reduce((s, a) => s + a.duration, 0),
    latencyMs:     latency
  };
}

/**
 * Invalidate all cached results for a specific page (e.g. when criteria change).
 */
async function invalidatePageCache(pageId) {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(`${CACHE_PREFIX}page:${pageId}:*`);
    if (keys.length > 0) await redisClient.del(keys);
  } catch {
    // Non-critical
  }
}

module.exports = {
  matchAdsForStudent,
  matchAdsForPage,
  matchAdsMultiCriteria,
  fillAdSlot,
  applyMandatoryFilter,
  scoreOptionalCriteria,
  packAdSlots,
  invalidateAdCache,
  invalidatePageCache,
  getCategories
};
