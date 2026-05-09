'use strict';

/**
 * A) MongoDB Schema — user_private_drafts collection
 *
 * Design rules:
 *   - Stored in a SEPARATE collection from published content — never globally
 *     indexed, never synced to ElasticSearch / MeiliSearch.
 *   - Minimal indexes: only ownerId (for "list my drafts") and baseId (for lookup).
 *   - baseId is assigned ONCE at creation and never reassigned.
 *   - hybridId includes the full suffix but state is always "D" in this collection.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Block sub-schema (mirrors the Angular Block interface) ─────────────────────

const blockSchema = new Schema(
  {
    blockId:  { type: String, required: true },
    type:     {
      type: String,
      enum: ['text', 'code', 'image', 'video', 'audio', 'divider', 'columns'],
      required: true
    },
    content:  { type: Schema.Types.Mixed, default: {} },
    order:    { type: Number, required: true },
  },
  { _id: false }
);

// ── Draft schema ──────────────────────────────────────────────────────────────

const creatorDraftSchema = new Schema(
  {
    // ── Identity ───────────────────────────────────────────────────────────────
    baseId:   {
      type:     String,
      required: true,
      unique:   true,     // "CB100000000001" — never reassigned
      index:    true,
    },
    hybridId: { type: String, required: true }, // full form including "-D" suffix

    // ── Ownership ──────────────────────────────────────────────────────────────
    ownerId:  {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },

    // ── Content metadata ───────────────────────────────────────────────────────
    title:       { type: String, required: true, trim: true, maxlength: 300 },
    subtitle:    { type: String, trim: true, maxlength: 500, default: '' },
    contentType: { type: String, enum: ['L', 'H', 'P'], required: true },
    domain:      { type: String, required: true }, // 'education' | 'health' | ...
    category:    { type: String, required: true }, // key into CATEGORY_CODES
    version:     { type: Number, default: 1 },

    // ── Block content (from canvas editor) ────────────────────────────────────
    blocks: { type: [blockSchema], default: [] },

    // ── Multi-domain tags (no ID duplication, just tags) ──────────────────────
    // e.g. ["E-Course", "E-Workshop", "H-Research"]
    domainTags: { type: [String], default: [] },

    // ── Auto-computed metadata (updated on save) ───────────────────────────────
    wordCount:   { type: Number, default: 0 },
    mediaCount:  { type: Number, default: 0 },
    estimatedReadMinutes: { type: Number, default: 0 },

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    // 'draft' is the only valid state in this collection.
    // When shared/published, document is MOVED to creator_content, not duplicated.
    state: { type: String, enum: ['draft'], default: 'draft' },

    lastAutoSaved: { type: Date },
  },
  {
    timestamps:  true,
    collection:  'user_private_drafts',
  }
);

// ── Indexes: minimal — this collection is never globally queried ──────────────
creatorDraftSchema.index({ ownerId: 1, createdAt: -1 });
creatorDraftSchema.index({ baseId: 1 }, { unique: true });
// NO text search index — private, not discoverable

module.exports = mongoose.model('CreatorDraft', creatorDraftSchema);
