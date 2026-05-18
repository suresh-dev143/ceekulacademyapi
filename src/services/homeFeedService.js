'use strict';

/**
 * Home Feed Service
 *
 * Assembles the complete homepage payload in a single parallel fetch.
 * All sources are fetched concurrently via Promise.allSettled — a single
 * slow/failing source degrades gracefully without blocking the rest.
 *
 * Feed sections:
 *   enrolled    — upcoming active schedules for the citizen (sorted by date)
 *   discovery   — top schedules by enrolment count (enriched with cinematic meta)
 *   trending    — recently active categories with programme samples
 *   notifications — unread UCRS outbox entries for this citizen
 *   needSignals — welfare need intelligence (only if consent given)
 *   screenRef   — most recent screen state CID (for resuming where left off)
 *   experienceTier — server-computed effective rendering tier
 */

const UCRSSchedule       = require('../models/scheduleModel');
const UCRSEnrolment      = require('../models/enrolmentModel');
const UCRSOutbox         = require('../models/ucrsOutboxModel');
const ScreenState        = require('../models/screenStateModel');
const UserExperienceProfile = require('../models/userExperienceProfileModel');
const { enrichWithCinematicMeta, computeEffectiveTier } = require('./cinematicMetaService');
const { assess: assessNeeds }  = require('./needIntelligenceService');

const DISCOVERY_LIMIT      = 20;
const ENROLLED_LIMIT       = 10;
const NOTIF_LIMIT          = 15;
const TRENDING_CATEGORIES  = 5;
const TRENDING_SAMPLES     = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function settled(result, fallback = null) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

/**
 * Fetch the citizen's upcoming active enrolments with joined schedule data.
 */
async function fetchEnrolled(citizenId) {
  const now = new Date();

  const enrolments = await UCRSEnrolment
    .find({ citizenId, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .limit(ENROLLED_LIMIT)
    .lean();

  if (!enrolments.length) return [];

  const scheduleIds = enrolments.map(e => e.scheduleId);

  const schedules = await UCRSSchedule
    .find({
      scheduleId: { $in: scheduleIds },
      status:     'ACTIVE',
      scheduledDate: { $gte: now },
    })
    .sort({ scheduledDate: 1 })
    .lean();

  // Merge enrolment status onto schedule
  const enrolMap = Object.fromEntries(enrolments.map(e => [e.scheduleId, e]));
  return schedules.map(s => ({
    ...s,
    _enrolment: { enrolledAt: enrolMap[s.scheduleId]?.createdAt || null },
  }));
}

/**
 * Fetch top schedules by enrolmentCount for discovery.
 * Attaches enrolmentCount (from enrolment collection count) before enrichment.
 */
async function fetchDiscovery(limit = DISCOVERY_LIMIT) {
  const schedules = await UCRSSchedule
    .find({ status: 'ACTIVE', scheduledDate: { $gte: new Date() } })
    .sort({ scheduledDate: 1 })
    .limit(limit * 3)  // over-fetch; we rank by enrolment count below
    .lean();

  if (!schedules.length) return [];

  const scheduleIds = schedules.map(s => s.scheduleId);

  // Count active enrolments per schedule in one aggregation
  const counts = await UCRSEnrolment.aggregate([
    { $match: { scheduleId: { $in: scheduleIds }, status: 'ACTIVE' } },
    { $group: { _id: '$scheduleId', count: { $sum: 1 } } },
  ]);

  const countMap = Object.fromEntries(counts.map(c => [c._id, c.count]));

  const ranked = schedules
    .map(s => ({ ...s, enrolmentCount: countMap[s.scheduleId] || 0 }))
    .sort((a, b) => b.enrolmentCount - a.enrolmentCount)
    .slice(0, limit);

  return ranked;
}

/**
 * Compute trending categories: 5 most active categories in the last 7 days,
 * each with up to 3 sample schedules.
 */
async function fetchTrending() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const buckets = await UCRSSchedule.aggregate([
    { $match: { status: 'ACTIVE', createdAt: { $gte: since } } },
    { $group: { _id: '$category', count: { $sum: 1 }, scheduleIds: { $push: '$scheduleId' } } },
    { $sort: { count: -1 } },
    { $limit: TRENDING_CATEGORIES },
  ]);

  if (!buckets.length) return [];

  // For each trending category, grab up to TRENDING_SAMPLES upcoming schedules
  const trending = await Promise.all(
    buckets.map(async (bucket) => {
      const samples = await UCRSSchedule
        .find({ category: bucket._id, status: 'ACTIVE', scheduledDate: { $gte: new Date() } })
        .sort({ scheduledDate: 1 })
        .limit(TRENDING_SAMPLES)
        .lean();
      return { category: bucket._id, recentCount: bucket.count, samples };
    })
  );

  return trending;
}

/**
 * Fetch unread UCRS outbox notifications addressed to this citizen.
 * "Notification" = subscription match events (CONTENT_LINKED eventType with actorId = citizenId).
 */
async function fetchNotifications(citizenId) {
  // Subscription notification entries are written with actorId = citizenId
  // and eventType = 'CONTENT_LINKED' by subscriptionService.matchAndNotify
  const entries = await UCRSOutbox
    .find({
      actorId:   citizenId,
      eventType: 'CONTENT_LINKED',
      status:    { $in: ['pending', 'processed'] },
    })
    .sort({ createdAt: -1 })
    .limit(NOTIF_LIMIT)
    .lean();

  return entries.map(e => ({
    eventId:   e.eventId,
    eventType: e.eventType,
    payload:   e.payload,
    createdAt: e.createdAt,
  }));
}

/**
 * Fetch current screen state CID for device-aware resumption.
 * Returns null if no screen state recorded (first visit).
 */
async function fetchScreenRef(userId, deviceId) {
  if (!deviceId) return null;
  const state = await ScreenState
    .findOne({ userId, ...(deviceId ? { deviceId } : {}) })
    .select('currentCid context viewportClass')
    .lean();
  return state ? { cid: state.currentCid, context: state.context, viewportClass: state.viewportClass } : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Assemble the full homepage feed for a citizen.
 *
 * @param {object} opts
 * @param {string}  opts.userId       — MongoDB ObjectId string
 * @param {string}  opts.citizenId    — CB-prefixed UCRS entity ID
 * @param {string}  [opts.deviceId]   — device fingerprint for screen state lookup
 * @param {object}  [opts.deviceOverride] — real-time device snapshot (battery, network, etc.)
 * @returns {object} { enrolled, discovery, trending, notifications, needSignals, screenRef, meta }
 */
async function buildHomeFeed({ userId, citizenId, deviceId, deviceOverride = {} }) {
  // ── 1. Fetch experience profile (needed to compute tier + consent gates) ──
  let profile = null;
  try {
    profile = await UserExperienceProfile.findOne({ userId }).lean();
  } catch {
    // Fall through with null profile — defaults apply
  }

  const effectiveTier = computeEffectiveTier(profile, deviceOverride);
  const animationLevel = effectiveTier.tier;
  const consentNeedIntelligence = profile?.consentNeedIntelligence ?? false;

  // ── 2. Fire all data sources in parallel ─────────────────────────────────
  const [
    enrolledResult,
    discoveryResult,
    trendingResult,
    notifResult,
    screenRefResult,
    needResult,
  ] = await Promise.allSettled([
    fetchEnrolled(citizenId),
    fetchDiscovery(DISCOVERY_LIMIT),
    fetchTrending(),
    fetchNotifications(citizenId),
    fetchScreenRef(userId, deviceId),
    consentNeedIntelligence ? assessNeeds(userId) : Promise.resolve(null),
  ]);

  const enrolled     = settled(enrolledResult,     []);
  const rawDiscovery = settled(discoveryResult,     []);
  const trending     = settled(trendingResult,      []);
  const notifications = settled(notifResult,        []);
  const screenRef    = settled(screenRefResult,     null);
  const needSignals  = settled(needResult,          null);

  // ── 3. Enrich discovery with cinematic metadata ───────────────────────────
  const discovery = enrichWithCinematicMeta(rawDiscovery, animationLevel, {
    enrolCountKey: 'enrolmentCount',
    categoryKey:   'category',
  });

  // Also enrich trending samples (at standard level — less prominent)
  const trendingEnriched = trending.map(bucket => ({
    ...bucket,
    samples: enrichWithCinematicMeta(bucket.samples, 'standard', { categoryKey: 'category' }),
  }));

  return {
    enrolled,
    discovery,
    trending: trendingEnriched,
    notifications,
    needSignals: consentNeedIntelligence ? needSignals : undefined,
    screenRef,
    meta: {
      effectiveTier,
      animationLevel,
      colorScheme:   effectiveTier.colorScheme,
      reducedMotion: effectiveTier.reducedMotion,
      xrActive:      effectiveTier.xrActive,
      recommendations: effectiveTier.recommendations,
      generatedAt:   new Date().toISOString(),
    },
  };
}

/**
 * Slim discovery-only endpoint — for pagination / infinite scroll.
 *
 * @param {object} opts
 * @param {string}  opts.animationLevel
 * @param {string}  [opts.category]      — filter by category
 * @param {number}  [opts.limit]
 * @param {number}  [opts.skip]
 */
async function getDiscoveryPage({ animationLevel = 'standard', category, limit = 20, skip = 0 }) {
  const query = { status: 'ACTIVE', scheduledDate: { $gte: new Date() } };
  if (category) query.category = category;

  const schedules = await UCRSSchedule
    .find(query)
    .sort({ scheduledDate: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  if (!schedules.length) return { items: [], total: 0 };

  const scheduleIds = schedules.map(s => s.scheduleId);
  const counts = await UCRSEnrolment.aggregate([
    { $match: { scheduleId: { $in: scheduleIds }, status: 'ACTIVE' } },
    { $group: { _id: '$scheduleId', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map(c => [c._id, c.count]));

  const items = schedules.map(s => ({ ...s, enrolmentCount: countMap[s.scheduleId] || 0 }));

  const total = await UCRSSchedule.countDocuments(query);

  return {
    items: enrichWithCinematicMeta(items, animationLevel, { enrolCountKey: 'enrolmentCount', categoryKey: 'category' }),
    total,
    skip,
    limit,
  };
}

module.exports = { buildHomeFeed, getDiscoveryPage };
