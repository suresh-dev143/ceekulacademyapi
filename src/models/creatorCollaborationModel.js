'use strict';

/**
 * A) MongoDB Schema — creator_collaborations collection
 *
 * Tracks:
 *   - Who is collaborating on a shared piece of content
 *   - Lightweight contribution counters {words, media, edits} per collaborator
 *     (updated synchronously on each delta submission)
 *   - Profit-share percentages (computed by nightly batch AI scoring job,
 *     not on every save — cost-efficiency constraint)
 *   - Delta log for incremental AI summarization (only appended, never rewritten)
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Per-collaborator record ────────────────────────────────────────────────────

const collaboratorSchema = new Schema(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role:       { type: String, enum: ['author', 'reviewer', 'contributor'], default: 'contributor' },
    invitedAt:  { type: Date, default: Date.now },
    acceptedAt: { type: Date },
    status:     { type: String, enum: ['pending', 'active', 'declined'], default: 'pending' },

    // Lightweight counters — incremented on delta submission (O(1) update)
    contributions: {
      words:  { type: Number, default: 0 },
      media:  { type: Number, default: 0 },
      edits:  { type: Number, default: 0 },
    },
    lastActiveAt: { type: Date },
  },
  { _id: false }
);

// ── Profit-share score (nightly batch output) ─────────────────────────────────

const profitShareSchema = new Schema(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    percentage:  { type: Number, min: 0, max: 100 },
    computedAt:  { type: Date },
    batchJobId:  { type: String }, // traceability
  },
  { _id: false }
);

// ── Delta log entry — appended on every "Share delta" call ───────────────────
// These are consumed by the incremental summarizer.  Processed deltas are
// marked processed=true; the summarizer never reprocesses them.

const deltaSchema = new Schema(
  {
    deltaId:        { type: String, required: true }, // snowflakeId()
    authorId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt:    { type: Date, default: Date.now },

    // What changed — stored as a compact diff, not full block snapshots
    addedWords:     { type: Number, default: 0 },
    removedWords:   { type: Number, default: 0 },
    addedMedia:     { type: Number, default: 0 },
    summary:        { type: String },  // author-provided change note (≤ 300 chars)
    blocksDiff: [{                     // lightweight block-level diff
      blockId:  String,
      op:       { type: String, enum: ['add', 'remove', 'update'] },
      type:     String,
      textSnippet: String,             // first 200 chars of added/changed text
    }],

    // Set by incremental summarizer after processing
    processed:      { type: Boolean, default: false },
    processedAt:    { type: Date },
  },
  { _id: false }
);

// ── Main collaboration schema ─────────────────────────────────────────────────

const creatorCollaborationSchema = new Schema(
  {
    // Link to the content (baseId is stable through all state changes)
    baseId:       { type: String, required: true, unique: true, index: true },
    contentRef:   { type: Schema.Types.ObjectId, ref: 'CreatorContent' },

    initiatorId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: { type: [collaboratorSchema], default: [] },

    // AI-computed profit share (nightly batch — NOT computed on every delta)
    profitShare:  { type: [profitShareSchema], default: [] },
    lastProfitShareAt: { type: Date },

    // Delta log — appended only, never rewritten
    deltas:       { type: [deltaSchema], default: [] },
    totalDeltas:  { type: Number, default: 0 },

    // Summarizer state
    summaryVersion:   { type: Number, default: 0 },
    unprocessedCount: { type: Number, default: 0 }, // deltas not yet summarized

    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  },
  {
    timestamps:  true,
    collection:  'creator_collaborations',
  }
);

creatorCollaborationSchema.index({ initiatorId: 1 });
creatorCollaborationSchema.index({ 'collaborators.userId': 1, 'collaborators.status': 1 });
creatorCollaborationSchema.index({ unprocessedCount: 1, status: 1 }); // summarizer batch query

module.exports = mongoose.model('CreatorCollaboration', creatorCollaborationSchema);
