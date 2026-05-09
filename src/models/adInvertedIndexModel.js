'use strict';

/**
 * Ad Inverted Index — maps filter keys to CID arrays for O(1) ad lookup.
 *
 * Instead of scanning the advertisements collection at match time, we maintain
 * pre-built index entries keyed by (indexType, key). Each entry holds a compact
 * list of CID references for ads that match that key.
 *
 * Updated delta-only at UCE commit time (one write per new ad, not full rebuild).
 *
 * indexType: 'category' | 'theme' | 'contentType' | 'ageGroup'
 * key:       e.g. 'technology', 'adult', 'practice'
 *
 * Lookup: O(1) — db.ad_inverted_index.findOne({ indexType, key })
 *   → returns entries[] with contentRef + adId + rate + duration
 *   → pass to adPackingService.pack() directly
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const indexEntrySchema = new Schema(
  {
    adId:       { type: Schema.Types.ObjectId, ref: 'Advertisement', required: true },
    contentRef: { type: String, required: true }, // UCE CID of the ad content
    rate:       { type: Number, required: true },  // ratePerSecondPerStudent
    duration:   { type: Number, required: true },  // seconds (multiple of 10)
    category:   { type: String },
    addedAt:    { type: Date, default: Date.now },
    // Budget snapshot — stale after ~60s, refresh on delivery miss
    remainingBudget: { type: Number, default: 0 },
    budgetSnapshotAt: { type: Date },
  },
  { _id: false }
);

const adInvertedIndexSchema = new Schema(
  {
    indexType: {
      type: String,
      enum: ['category', 'theme', 'contentType', 'ageGroup'],
      required: true,
    },
    key:       { type: String, required: true, lowercase: true, trim: true },
    entries:   { type: [indexEntrySchema], default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'ad_inverted_index',
  }
);

// Compound unique — one document per (type, key)
adInvertedIndexSchema.index({ indexType: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('AdInvertedIndex', adInvertedIndexSchema);
