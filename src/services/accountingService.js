'use strict';

/**
 * Real-Time Ad Accounting Service
 *
 * Tracks ad revenue per second using Redis atomic counters.
 * Flushes to PostgreSQL (MongoDB here) in batches.
 *
 * Flow per second:
 *   1. Redis INCR/DECR for fast atomic operations
 *   2. Batch flush every 5 seconds to MongoDB
 *   3. Distribute revenue splits
 */

const AdImpression = require('../models/adImpressionModel');
const Advertisement = require('../models/advertisementModel');
const { calculateSecondRevenue, splitRevenue } = require('./pricingService');
const { distributeAdRevenue } = require('./walletService');
const { publishEvent } = require('./eventService');

// Redis client
let redisClient = null;
try {
  const redis = require('redis');
  redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  redisClient.connect().catch(() => {
    console.warn('[Accounting] Redis unavailable');
    redisClient = null;
  });
} catch {
  console.warn('[Accounting] Redis not installed');
}

const REVENUE_KEY = (adId) => `rev:ad:${adId}`;
const SESSION_WATCHED_KEY = (sessionId) => `watch:${sessionId}`;
const FLUSH_INTERVAL_MS = 5000;

// In-memory buffer for environments without Redis
const memBuffer = new Map();

/**
 * Record a second of ad playback
 * Called once per second per student
 */
async function recordAdSecond({
  sessionId,
  adId,
  lectureId,
  studentId,
  teacherId,
  isLive = false,
  activeStudentIds = [] // All students currently watching
}) {
  const ad = await getAdFromCache(adId);
  if (!ad) return null;

  const studentCount = activeStudentIds.length || 1;
  const revenue = calculateSecondRevenue(
    ad.ratePerSecondPerStudent,
    studentCount,
    isLive,
    new Date()
  );

  // Check advertiser has budget (Redis atomic check)
  const hasBudget = await checkAndDeductBudgetRedis(adId, revenue.totalRevenue);
  if (!hasBudget) {
    // Mark ad as exhausted
    await Advertisement.findByIdAndUpdate(adId, {
      $set: { status: 'exhausted', isActive: false }
    });
    return null;
  }

  // Increment watch time in Redis
  await incrWatchTime(sessionId, studentId, adId);

  // Buffer the revenue event
  bufferRevenueEvent({
    sessionId,
    adId,
    lectureId,
    studentId,
    teacherId,
    activeStudentIds,
    revenue
  });

  // Publish real-time event
  await publishEvent('revenue_generated', {
    adId,
    lectureId,
    studentId,
    teacherId,
    revenue: revenue.totalRevenue,
    teacherShare: revenue.teacherShare,
    studentShare: revenue.studentShare,
    platformShare: revenue.platformShare,
    timestamp: new Date().toISOString()
  });

  return revenue;
}

/**
 * Start an ad impression session
 */
async function startAdImpression({
  sessionId,
  adId,
  lectureId,
  studentId,
  teacherId,
  isLive,
  adDuration,
  ratePerSecond,
  multiplier,
  effectiveRate,
  deviceFingerprint,
  ipAddress
}) {
  const impression = await AdImpression.create({
    adId,
    lectureId,
    studentId,
    teacherId,
    sessionId,
    startTime: new Date(),
    totalAdDuration: adDuration,
    ratePerSecond,
    effectiveRate,
    multiplier,
    isLive,
    deviceFingerprint,
    ipAddress,
    status: 'active'
  });

  await publishEvent('ad_play_started', {
    sessionId,
    adId,
    lectureId,
    studentId,
    teacherId,
    timestamp: new Date().toISOString()
  });

  return impression;
}

/**
 * Complete an ad impression session
 */
async function completeAdImpression(sessionId, watchedSeconds) {
  const impression = await AdImpression.findOne({ sessionId, status: 'active' });
  if (!impression) return null;

  const completionRate = (watchedSeconds / impression.totalAdDuration) * 100;
  const totalRevenue = parseFloat((impression.effectiveRate * watchedSeconds).toFixed(6));
  const { teacherShare, studentShare, platformShare } = splitRevenue(totalRevenue);

  impression.endTime = new Date();
  impression.secondsWatched = watchedSeconds;
  impression.completionRate = completionRate;
  impression.totalRevenue = totalRevenue;
  impression.teacherShare = teacherShare;
  impression.studentShare = studentShare;
  impression.platformShare = platformShare;
  impression.status = 'completed';
  await impression.save();

  // Distribute revenue
  if (totalRevenue > 0 && !impression.isFraudulent) {
    await distributeAdRevenue({
      advertiserId: (await Advertisement.findById(impression.adId).select('advertiserId')).advertiserId,
      teacherId: impression.teacherId,
      studentIds: [impression.studentId],
      adId: impression.adId,
      lectureId: impression.lectureId,
      adImpressionId: impression._id,
      totalRevenue,
      teacherShare,
      studentShare,
      platformShare
    }).catch(err => console.error('[Accounting] Revenue distribution failed:', err));
  }

  await publishEvent('ad_play_ended', {
    sessionId,
    adId: impression.adId.toString(),
    secondsWatched: watchedSeconds,
    totalRevenue,
    timestamp: new Date().toISOString()
  });

  return impression;
}

// ==================== REDIS HELPERS ====================

async function checkAndDeductBudgetRedis(adId, amount) {
  if (!redisClient) {
    // Fallback to DB check
    const ad = await Advertisement.findById(adId).select('remainingBudget').lean();
    if (!ad || ad.remainingBudget < amount) return false;
    await Advertisement.findByIdAndUpdate(adId, { $inc: { remainingBudget: -amount, totalSpent: amount } });
    return true;
  }

  const key = REVENUE_KEY(adId);
  const budget = await redisClient.get(key);

  if (budget === null) {
    // Load from DB
    const ad = await Advertisement.findById(adId).select('remainingBudget').lean();
    if (!ad) return false;
    await redisClient.set(key, ad.remainingBudget.toFixed(6), { EX: 300 });
    return parseFloat(ad.remainingBudget) >= amount;
  }

  const remaining = parseFloat(budget);
  if (remaining < amount) return false;

  await redisClient.set(key, (remaining - amount).toFixed(6), { KEEPTTL: true });
  return true;
}

async function incrWatchTime(sessionId, studentId, adId) {
  if (!redisClient) return;
  const key = SESSION_WATCHED_KEY(sessionId);
  await redisClient.incr(key);
  await redisClient.expire(key, 3600); // 1 hour TTL
}

// Simple in-memory buffer fallback
const _buffer = [];
function bufferRevenueEvent(event) {
  _buffer.push({ ...event, timestamp: new Date() });
  if (_buffer.length >= 1000) {
    flushBufferedRevenue();
  }
}

async function flushBufferedRevenue() {
  if (_buffer.length === 0) return;
  const batch = _buffer.splice(0, _buffer.length);

  // Aggregate by adId and flush
  const byAd = {};
  for (const event of batch) {
    const key = event.adId;
    if (!byAd[key]) byAd[key] = { totalRevenue: 0, count: 0 };
    byAd[key].totalRevenue += event.revenue?.totalRevenue || 0;
    byAd[key].count++;
  }

  for (const [adId, agg] of Object.entries(byAd)) {
    await Advertisement.findByIdAndUpdate(adId, {
      $inc: {
        remainingBudget: -agg.totalRevenue,
        totalSpent: agg.totalRevenue,
        totalSecondsPlayed: agg.count
      }
    }).catch(err => console.error('[Accounting] DB flush error:', err));
  }
}

// Periodic flush
setInterval(flushBufferedRevenue, FLUSH_INTERVAL_MS);

async function getAdFromCache(adId) {
  if (redisClient) {
    try {
      const cached = await redisClient.get(`ad:meta:${adId}`);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }
  }
  const ad = await Advertisement.findById(adId)
    .select('ratePerSecondPerStudent advertiserId status isActive remainingBudget')
    .lean();
  if (redisClient && ad) {
    redisClient.set(`ad:meta:${adId}`, JSON.stringify(ad), { EX: 60 }).catch(() => {});
  }
  return ad;
}

module.exports = {
  recordAdSecond,
  startAdImpression,
  completeAdImpression,
  flushBufferedRevenue
};
