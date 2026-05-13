'use strict';

/**
 * UCRS Schedule Model — CP (Process) entity
 *
 * A schedule is an EXECUTION CONTEXT for semantic content.
 * It never stores content — only references it via CID.
 * The same content can be scheduled as workshop, course, webinar, etc.
 *
 * UCRS integration:
 *   - scheduleId is a CP-prefixed entity ID (deterministic hash)
 *   - Every write emits ENTITY_CREATED to the event ledger
 *   - Enrolments are stored as UCRS policy tuples (citizen → member → schedule)
 */

const mongoose = require('mongoose');
const { UCRS_LIFECYCLE_STATES } = require('../constants/ucrsConstants');

const SCHEDULE_CATEGORIES = [
  'course', 'workshop', 'webinar', 'research',
  'project', 'advertisement', 'vision-flow', 'other',
];

const DELIVERY_MODES = ['online', 'offline', 'hybrid'];

const scheduleSchema = new mongoose.Schema({
  // ── UCRS Identity ──────────────────────────────────────────────────────────
  scheduleId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // CP{12-char-sha256} — deterministic from (createdBy+category+contentCid+date+startTime)
  },

  // ── Execution context ──────────────────────────────────────────────────────
  category: {
    type: String,
    required: true,
    enum: SCHEDULE_CATEGORIES,
    index: true,
  },

  // ── Semantic content reference (never duplicated) ──────────────────────────
  programTitle:  { type: String, required: true, trim: true, maxlength: 300 },
  sectionTitle:  { type: String, default: '', trim: true, maxlength: 300 },
  contentTitle:  { type: String, default: '', trim: true, maxlength: 300 },

  contentRef: {
    cid:      { type: String, default: null },  // CR-prefixed content ID
    hybridId: { type: String, default: null },
    baseId:   { type: String, default: null },
  },

  // ── Instructor / Expert ────────────────────────────────────────────────────
  instructorId: {
    type: String,
    default: null,
    index: true,
    // CB-prefixed UCRS citizen ID — optional
  },

  instructorName: { type: String, default: null },

  // ── Timing ────────────────────────────────────────────────────────────────
  scheduledDate: {
    type: Date,
    required: true,
    index: true,
  },

  startTime: { type: String, required: true },  // 'HH:MM' in 24h
  endTime:   { type: String, required: true },

  timezone: {
    type: String,
    required: true,
    default: 'Asia/Kolkata',
  },

  deliveryMode: {
    type: String,
    enum: DELIVERY_MODES,
    default: 'online',
  },

  capacity: {
    type: Number,
    default: null,
    // null = unlimited
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: UCRS_LIFECYCLE_STATES,
    default: 'ACTIVE',
    index: true,
  },

  // ── Ownership ─────────────────────────────────────────────────────────────
  createdBy: {
    type: String,
    required: true,
    index: true,
    // CB-prefixed creator ID
  },

  // ── AI filter result (mirrors UCE pipeline) ────────────────────────────────
  aiFlags: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // ── Integrity (tamper detection) ───────────────────────────────────────────
  integrityHash: {
    type: String,
    required: true,
    // SHA-256(scheduleId + category + programTitle + createdBy + scheduledDate + startTime)
  },

  // ── Enrolment count (denormalized for O(1) reads) ─────────────────────────
  enrolmentCount: {
    type: Number,
    default: 0,
  },

}, {
  timestamps: true,
  collection: 'ucrs_schedules',
});

// Category + date for calendar queries
scheduleSchema.index({ category: 1, scheduledDate: 1, status: 1 });
// Creator's schedules
scheduleSchema.index({ createdBy: 1, scheduledDate: -1 });
// Full-text search over titles
scheduleSchema.index({ programTitle: 'text', sectionTitle: 'text', contentTitle: 'text' });

module.exports = mongoose.model('UCRSSchedule', scheduleSchema);
module.exports.SCHEDULE_CATEGORIES = SCHEDULE_CATEGORIES;
