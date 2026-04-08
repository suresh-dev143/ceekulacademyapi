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

module.exports = {
  matchAdsForStudent,
  fillAdSlot,
  invalidateAdCache,
  getCategories
};
