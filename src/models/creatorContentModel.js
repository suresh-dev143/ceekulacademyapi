'use strict';

/**
 * A) MongoDB Schema — creator_content collection
 *
 * Holds content in SHARED or PUBLISHED state.
 * Design rules:
 *   - Single source of truth — no duplication across domains (domainTags instead).
 *   - esIndexed flag gates ElasticSearch sync; only PUBLISHED content is indexed.
 *   - Redis cache key = "content:<baseId>" — TTL managed by caching layer.
 *   - When a draft transitions to shared/published, it is MOVED here from
 *     user_private_drafts (draft document is deleted, not copied).
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Block sub-schema (same as in draft) ───────────────────────────────────────

const blockSchema = new Schema(
  {
    blockId:  { type: String, required: true },
    type: {
      type: String,
      enum: ['text', 'code', 'image', 'video', 'audio', 'divider', 'columns'],
      required: true
    },
    content:  { type: Schema.Types.Mixed, default: {} },
    order:    { type: Number, required: true },
  },
  { _id: false }
);

// ── Incremental AI summary (delta-only, not full recompute) ──────────────────

const summarySchema = new Schema(
  {
    text:        { type: String, default: '' },
    summaryVer:  { type: Number, default: 0 },
    deltasSince: { type: Number, default: 0 }, // deltas applied since last full summary
    lastUpdated: { type: Date },
  },
  { _id: false }
);

// ── Content schema ────────────────────────────────────────────────────────────

const creatorContentSchema = new Schema(
  {
    // ── Identity (baseId persists from draft — never reassigned) ──────────────
    baseId:    { type: String, required: true, unique: true, index: true },
    hybridId:  { type: String, required: true },  // includes current state suffix

    // ── Ownership ─────────────────────────────────────────────────────────────
    ownerId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // ── Content metadata ──────────────────────────────────────────────────────
    title:       { type: String, required: true, trim: true, maxlength: 300 },
    subtitle:    { type: String, trim: true, maxlength: 500, default: '' },
    contentType: { type: String, enum: ['L', 'H', 'P'], required: true },
    domain:      { type: String, required: true },
    contentTitle: { type: String, default: '' },
    version:     { type: Number, default: 1 },

    // ── Blocks ─────────────────────────────────────────────────────────────────
    blocks: { type: [blockSchema], default: [] },

    // ── Multi-domain publishing (no ID duplication) ───────────────────────────
    domainTags: { type: [String], default: [] }, // ["E-Course", "E-Workshop"]

    // ── State machine: 'shared' | 'published' ─────────────────────────────────
    state: {
      type:     String,
      enum:     ['shared', 'published'],
      required: true,
      index:    true,
    },

    // ── Collaboration ref ──────────────────────────────────────────────────────
    collaborationId: { type: Schema.Types.ObjectId, ref: 'CreatorCollaboration' },

    // ── AI summary (populated when state = 'shared') ──────────────────────────
    summary: { type: summarySchema, default: () => ({}) },

    // ── Publishing metadata ────────────────────────────────────────────────────
    publishedAt: { type: Date },
    canonicalUrl: { type: String }, // set on publish: "https://ceekul.xyz/cb...v01"

    // ── Content stats (denormalised for fast reads, rebuilt by nightly batch) ──
    wordCount:   { type: Number, default: 0 },
    mediaCount:  { type: Number, default: 0 },

    // ── Engagement (published only — updated by event pipeline) ───────────────
    views:      { type: Number, default: 0 },
    enrollments:{ type: Number, default: 0 },
    avgRating:  { type: Number, default: 0, min: 0, max: 5 },
    ratingCount:{ type: Number, default: 0 },

    // ── ElasticSearch / MeiliSearch sync ──────────────────────────────────────
    esIndexed:   { type: Boolean, default: false },
    esIndexedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'creator_content',
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
creatorContentSchema.index({ ownerId: 1, state: 1, createdAt: -1 });
creatorContentSchema.index({ state: 1, esIndexed: 1 });          // ES sync job query
creatorContentSchema.index({ domain: 1, contentType: 1, state: 1 });
creatorContentSchema.index({ domainTags: 1, state: 1 });
creatorContentSchema.index({ 'summary.deltasSince': 1, state: 1 }); // summarization job

module.exports = mongoose.model('CreatorContent', creatorContentSchema);
