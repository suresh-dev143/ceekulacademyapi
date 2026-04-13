'use strict';

const mongoose = require('mongoose');

/**
 * Page — the ad-control unit attached to a session (lecture).
 *
 * pageType:
 *   teacher_global  — one page shared by all enrolled students; teacher controls criteria
 *   student         — each student's own personalized page
 *   private         — page visible/used only by the owner (no revenue sharing)
 *
 * controlMode (only meaningful on teacher_global pages):
 *   1 — teacher mandatory: every student receives the teacher's criteria
 *   2 — student override:  teacher criteria are the default; student can override
 *   3 — private per user:  each student uses their own private page criteria
 */

// ── Legacy flat criteria (kept for backward compatibility) ────────────────────
const adCriteriaSchema = new mongoose.Schema(
  {
    categories:       [{ type: String, trim: true, lowercase: true }],
    themes:           [{ type: String, trim: true, lowercase: true }],
    minRatePerSecond: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

// ── Mandatory criteria — ALL must match; ad excluded if any field mismatches ──
const mandatoryCriteriaSchema = new mongoose.Schema(
  {
    categories:   [{ type: String, trim: true, lowercase: true }],
    themes:       [{ type: String, trim: true, lowercase: true }],
    ageGroup: {
      type: String,
      enum: ['children', 'teen', 'adult', 'all'],
      default: 'all'
    },
    contentTypes: [{ type: String, trim: true, lowercase: true }],
    minRatePerSecond: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

// ── Optional criteria — scored when defined; skipped when absent ───────────────
const optionalCriteriaSchema = new mongoose.Schema(
  {
    engagementScoreTarget: { type: Number, min: 0, max: 100 },
    behavioralSignals:     [{ type: String, trim: true, lowercase: true }],
    interestTags:          [{ type: String, trim: true, lowercase: true }],
    preferredLanguage:     { type: String, trim: true, lowercase: true }
  },
  { _id: false }
);

const pageSchema = new mongoose.Schema(
  {
    // ── Ownership ─────────────────────────────────────────────────────────────
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner ID is required'],
      index: true
    },
    ownerRole: {
      type: String,
      enum: ['teacher', 'student'],
      required: [true, 'Owner role is required']
    },

    // ── Page identity ─────────────────────────────────────────────────────────
    title: {
      type: String,
      required: [true, 'Page title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },

    // ── Page type ──────────────────────────────────────────────────────────────
    pageType: {
      type: String,
      enum: ['teacher_global', 'student', 'private'],
      required: [true, 'Page type is required'],
      index: true
    },

    // ── Control mode (teacher_global pages only) ──────────────────────────────
    controlMode: {
      type: Number,
      enum: [1, 2, 3],
      default: 1
      // 1: teacher mandatory
      // 2: student can override
      // 3: private per user
    },

    // ── Ad criteria set by page owner (legacy — kept for compatibility) ────────
    adCriteria: {
      type: adCriteriaSchema,
      default: () => ({ categories: [], themes: [], minRatePerSecond: 0 })
    },

    // ── Structured multi-criteria matching ─────────────────────────────────────
    // mandatoryCriteria: hard-filter — ads must satisfy ALL defined fields
    mandatoryCriteria: {
      type: mandatoryCriteriaSchema,
      default: () => ({ categories: [], themes: [], ageGroup: 'all', contentTypes: [], minRatePerSecond: 0 })
    },
    // optionalCriteria: soft-score — only applied when explicitly defined
    optionalCriteria: {
      type: optionalCriteriaSchema,
      default: () => ({})
    },

    // ── Linked lecture / session ───────────────────────────────────────────────
    lectureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lecture',
      index: true
    },

    // ── Revenue split (percentages; must sum to 100) ───────────────────────────
    revenueSplit: {
      teacher:  { type: Number, default: 33 },
      student:  { type: Number, default: 66 },
      platform: { type: Number, default: 1 }
    },

    // ── Status ────────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true, index: true },

    // ── Aggregate stats (denormalised for quick reads) ───────────────────────
    totalViewers:   { type: Number, default: 0 },
    totalAdRevenue: { type: Number, default: 0 }
  },
  {
    timestamps: true,
    collection: 'pages'
  }
);

// Compound indexes for common query patterns
pageSchema.index({ ownerId: 1, pageType: 1 });
pageSchema.index({ lectureId: 1, pageType: 1 });
pageSchema.index({ ownerId: 1, isActive: 1 });

module.exports = mongoose.model('Page', pageSchema);
