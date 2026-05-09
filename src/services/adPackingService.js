'use strict';

/**
 * Ad Packing Service — value-density greedy 600-second slot filler.
 *
 * Algorithm:
 *   1. Sort candidates by value-density: rate × matchScore DESC
 *   2. Greedy scan: include first ad that fits remaining time
 *   3. Repeat until slot full or candidates exhausted
 *
 * All ads are handled as CID references — no content bodies are copied.
 * Result is an array of { contentRef, adId, startTime, endTime, duration, ... }
 * ready to be stored in AdPlan.slots.
 *
 * Also exposes: indexLookup() — O(1) candidate fetch from AdInvertedIndex.
 */

const Advertisement       = require('../models/advertisementModel');
const AdInvertedIndex     = require('../models/adInvertedIndexModel');

const SLOT_DURATION = 600; // seconds

// ── Public: build candidates from inverted index (O(1) per key) ──────────────

async function candidatesFromIndex(categories = [], themes = [], ageGroup = null) {
  const queries = [];

  if (categories.length) {
    queries.push(AdInvertedIndex.find({ indexType: 'category', key: { $in: categories.map(c => c.toLowerCase()) } }).lean());
  }
  if (themes.length) {
    queries.push(AdInvertedIndex.find({ indexType: 'theme', key: { $in: themes.map(t => t.toLowerCase()) } }).lean());
  }
  if (ageGroup && ageGroup !== 'all') {
    queries.push(AdInvertedIndex.findOne({ indexType: 'ageGroup', key: ageGroup.toLowerCase() }).lean());
  }

  if (!queries.length) {
    // No filters — fetch all active ads from index
    queries.push(AdInvertedIndex.find({ indexType: 'category' }).lean());
  }

  const results = await Promise.all(queries);
  const entryMap = new Map(); // adId.toString() → entry (dedup)

  for (const docs of results) {
    const docArray = Array.isArray(docs) ? docs : (docs ? [docs] : []);
    for (const doc of docArray) {
      for (const entry of doc.entries) {
        const key = entry.adId.toString();
        // Keep highest-rate entry when the same ad appears in multiple index buckets
        if (!entryMap.has(key) || entry.rate > entryMap.get(key).rate) {
          entryMap.set(key, entry);
        }
      }
    }
  }

  return [...entryMap.values()];
}

// ── Public: live budget check — filters out exhausted or expired ads ──────────
// Runs after index lookup, only hits DB for budget columns (lean, indexed query)

async function filterEligible(entries) {
  if (!entries.length) return [];

  const adIds = entries.map(e => e.adId);
  const now   = new Date();

  const eligibleDocs = await Advertisement.find(
    {
      _id:             { $in: adIds },
      status:          'active',
      isActive:        true,
      remainingBudget: { $gt: 0 },
      expiryDate:      { $gt: now },
    },
    { _id: 1 }
  ).lean();

  const eligibleSet = new Set(eligibleDocs.map(d => d._id.toString()));
  return entries.filter(e => eligibleSet.has(e.adId.toString()));
}

// ── Public: score candidates using optional criteria ─────────────────────────

function scoreEntries(entries, optionalCriteria = {}, learnerProfile = {}) {
  const WEIGHTS = {
    engagementScore:   0.30,
    behavioralSignals: 0.40,
    interestTags:      0.20,
    preferredLanguage: 0.10,
  };

  return entries.map(entry => {
    let optScore = 0;

    // Engagement proximity
    if (optionalCriteria.engagementScoreTarget != null && learnerProfile.engagementScore != null) {
      const dist = Math.abs(optionalCriteria.engagementScoreTarget - learnerProfile.engagementScore);
      optScore += (1 - dist / 100) * WEIGHTS.engagementScore;
    }

    // Behavioral signals
    const signals = optionalCriteria.behavioralSignals;
    if (signals?.length && learnerProfile.behavioralSignals?.length) {
      const matched = signals.filter(s => learnerProfile.behavioralSignals.includes(s)).length;
      optScore += (matched / signals.length) * WEIGHTS.behavioralSignals;
    }

    // Interest tags
    const tags = optionalCriteria.interestTags;
    if (tags?.length && learnerProfile.interests?.length) {
      const matched = tags.filter(t => learnerProfile.interests.includes(t)).length;
      optScore += (matched / tags.length) * WEIGHTS.interestTags;
    }

    // Language
    if (optionalCriteria.preferredLanguage && learnerProfile.preferredLanguage) {
      if (optionalCriteria.preferredLanguage === learnerProfile.preferredLanguage) {
        optScore += WEIGHTS.preferredLanguage;
      }
    }

    // Value density: rate × (1 + optScore) — rewards both price and relevance
    const valueDensity = entry.rate * (1 + optScore);

    return { ...entry, matchScore: optScore, valueDensity };
  });
}

// ── Public: greedy bin-pack into 600s window ──────────────────────────────────

function pack(scoredEntries, totalSeconds = SLOT_DURATION) {
  // Sort by value-density DESC (highest payers + best match first)
  const sorted = [...scoredEntries].sort((a, b) => b.valueDensity - a.valueDensity);

  const slots   = [];
  let remaining = totalSeconds;
  let cursor    = 0;
  const used    = new Set();

  for (const entry of sorted) {
    if (remaining <= 0) break;
    if (used.has(entry.adId.toString())) continue;
    if (entry.duration % 10 !== 0) continue; // safety guard
    if (entry.duration > remaining) continue; // doesn't fit

    slots.push({
      contentRef: entry.contentRef,
      adId:       entry.adId,
      startTime:  cursor,
      endTime:    cursor + entry.duration,
      duration:   entry.duration,
      matchScore: Math.round((entry.matchScore ?? 0) * 1000) / 1000,
      ratePerSec: entry.rate,
      category:   entry.category ?? '',
    });

    used.add(entry.adId.toString());
    cursor    += entry.duration;
    remaining -= entry.duration;
  }

  return slots;
}

// ── Public: delta-update inverted index for a single new/updated ad ───────────
// Called by the UCE commit hook when an ad content is committed.

async function upsertIndexEntry({ adId, contentRef, rate, duration, category, themes = [], ageGroup = 'all' }) {
  const entry = {
    adId,
    contentRef,
    rate,
    duration,
    category,
    addedAt:    new Date(),
    remainingBudget: 0,
    budgetSnapshotAt: new Date(),
  };

  const ops = [];

  // Category index
  if (category) {
    ops.push(
      AdInvertedIndex.findOneAndUpdate(
        { indexType: 'category', key: category.toLowerCase() },
        { $pull: { entries: { adId } } },
        { new: false }
      ).then(() =>
        AdInvertedIndex.findOneAndUpdate(
          { indexType: 'category', key: category.toLowerCase() },
          { $push: { entries: entry }, $set: { updatedAt: new Date() } },
          { upsert: true }
        )
      )
    );
  }

  // Theme indexes
  for (const theme of themes) {
    ops.push(
      AdInvertedIndex.findOneAndUpdate(
        { indexType: 'theme', key: theme.toLowerCase() },
        { $pull: { entries: { adId } } },
        { new: false }
      ).then(() =>
        AdInvertedIndex.findOneAndUpdate(
          { indexType: 'theme', key: theme.toLowerCase() },
          { $push: { entries: entry }, $set: { updatedAt: new Date() } },
          { upsert: true }
        )
      )
    );
  }

  // Age group index
  if (ageGroup && ageGroup !== 'all') {
    ops.push(
      AdInvertedIndex.findOneAndUpdate(
        { indexType: 'ageGroup', key: ageGroup.toLowerCase() },
        { $pull: { entries: { adId } } },
        { new: false }
      ).then(() =>
        AdInvertedIndex.findOneAndUpdate(
          { indexType: 'ageGroup', key: ageGroup.toLowerCase() },
          { $push: { entries: entry }, $set: { updatedAt: new Date() } },
          { upsert: true }
        )
      )
    );
  }

  await Promise.all(ops);
}

// ── Public: remove an ad from all index entries (on pause/expire) ─────────────

async function removeFromIndex(adId) {
  await AdInvertedIndex.updateMany(
    { 'entries.adId': adId },
    { $pull: { entries: { adId } }, $set: { updatedAt: new Date() } }
  );
}

module.exports = {
  candidatesFromIndex,
  filterEligible,
  scoreEntries,
  pack,
  upsertIndexEntry,
  removeFromIndex,
  SLOT_DURATION,
};
