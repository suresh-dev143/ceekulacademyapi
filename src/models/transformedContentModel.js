'use strict';

/**
 * Cache for deterministically transformed content.
 *
 * Design rules:
 *   - One document per (cid × targetType) pair — compound unique index.
 *   - Invalidated only when source content.updatedAt advances past contentUpdatedAt.
 *   - AI is never used here; all transformation is deterministic/rule-based.
 *   - Redis may sit in front of this; this is the persistent fallback.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const transformedContentSchema = new Schema(
  {
    cid:        { type: String, required: true },
    targetType: {
      type: String,
      enum: ['workshop', 'course', 'research', 'advertisement'],
      required: true,
    },

    version:          { type: Number, default: 1 },
    data:             { type: Schema.Types.Mixed, required: true },
    contentUpdatedAt: { type: Date, required: true }, // updatedAt of source at transform time
    status:           { type: String, enum: ['ok', 'needs_review'], default: 'ok' },
    message:          { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'transformed_content',
  }
);

// One cached result per (cid, targetType) — upserted on every transform
transformedContentSchema.index({ cid: 1, targetType: 1 }, { unique: true });

module.exports = mongoose.model('TransformedContent', transformedContentSchema);
