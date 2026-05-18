'use strict';

/**
 * UCE Content Store — immutable, content-addressed blob store.
 *
 * Design rules:
 *   - Documents are NEVER mutated after creation.
 *   - A new edit produces a new CID and a new document.
 *   - The cid field is the SHA-256-derived content address (see cidGeneratorService).
 *   - Full-text search is served by the compound text index over payload fields.
 *   - Redis cache key = "uce:<cid>:<version>" — TTL 1hr (managed by refResolverService).
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const uceContentSchema = new Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    cid:         { type: String, required: true, unique: true, index: true },

    // ── Content ───────────────────────────────────────────────────────────────
    contentType: { type: String, required: true, index: true },
    payload:     { type: Schema.Types.Mixed, required: true }, // canonical normalized form

    // ── Moderation ────────────────────────────────────────────────────────────
    aiFlags:  { type: Schema.Types.Mixed, default: null }, // runContentEvaluator output
    status:   {
      type:    String,
      enum:    ['approved', 'pending_review', 'blocked'],
      default: 'pending_review',
      index:   true,
    },

    // ── Ownership ─────────────────────────────────────────────────────────────
    ownerId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentType: {
      type:    String,
      default: 'human',
      enum:    ['human', 'ai', 'collective', 'ecosystem'],
      index:   true,
    },

    // ── Stats ─────────────────────────────────────────────────────────────────
    sizeBytes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'uce_content',
  }
);

// ── Compound queries ──────────────────────────────────────────────────────────
uceContentSchema.index({ contentType: 1, status: 1, createdAt: -1 });
uceContentSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

// ── Full-text search (written once at commit time) ────────────────────────────
// MongoDB text index over the nested payload fields that matter for discovery.
uceContentSchema.index(
  {
    'payload.title':    'text',
    'payload.subtitle': 'text',
    'payload.keywords': 'text',
    'payload.body':     'text',
  },
  {
    weights:  { 'payload.title': 10, 'payload.subtitle': 5, 'payload.keywords': 8, 'payload.body': 1 },
    name:     'uce_content_fts',
    default_language: 'english',
  }
);

module.exports = mongoose.model('UceContent', uceContentSchema);
