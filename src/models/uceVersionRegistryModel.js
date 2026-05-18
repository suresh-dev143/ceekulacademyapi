'use strict';

/**
 * UCE Version Registry — append-only chain linking CIDs across versions.
 *
 * Design rules:
 *   - Documents are NEVER mutated or deleted.
 *   - Each commit produces exactly one registry entry.
 *   - logicalId is a UUID that persists across all versions of the same entity.
 *     New content → new UUID. Edit of existing → inherits parentCid's logicalId.
 *   - parentCid is null for brand-new content; set to the predecessor CID for edits.
 *   - version starts at 1 and increments per logicalId.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const uceVersionRegistrySchema = new Schema(
  {
    // ── Content address ───────────────────────────────────────────────────────
    cid:         { type: String, required: true, unique: true, index: true },

    // ── Logical entity chain ──────────────────────────────────────────────────
    logicalId:   { type: String, required: true, index: true }, // persistent across edits
    parentCid:   { type: String, default: null, index: true },  // null for v1
    version:     { type: Number, required: true },

    // ── Metadata ──────────────────────────────────────────────────────────────
    contentType: { type: String, required: true },
    ownerId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    committedAt: { type: Date, default: Date.now, index: true },

    // ── Normalizer version ────────────────────────────────────────────────────
    // Records which normalizerService schema produced this CID.
    // Allows detection of stale CIDs after normalizer schema upgrades.
    normalizerVersion: { type: String, default: '1.0.0' },

    // ── Semantic diff ─────────────────────────────────────────────────────────
    // Null for v1 (no parent). For v2+, a structured field-by-field diff
    // computed at commit time by semanticDiffService.
    // Enables "what changed in this version?" with a single document read.
    diff: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'uce_version_registry',
  }
);

// Fast lookup: all versions of a logical entity, newest first
uceVersionRegistrySchema.index({ logicalId: 1, version: -1 });

module.exports = mongoose.model('UceVersionRegistry', uceVersionRegistrySchema);
