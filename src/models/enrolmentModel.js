'use strict';

/**
 * UCRS Enrolment Model — display record alongside policy tuple
 *
 * Authorization gate:  UCRS policy tuple  (CB-citizen, 'member', CP-scheduleId)
 * This model:          display + status tracking only
 *
 * "Is CB001 enrolled in CP-SCHED01?"
 * → policyService.check({ actorId: 'CB001', action: 'read', resourceId: 'CP-SCHED01' })
 * → Redis O(1) lookup
 */

const mongoose = require('mongoose');

const enrolmentSchema = new mongoose.Schema({
  // ── UCRS references ────────────────────────────────────────────────────────
  citizenId: {
    type: String,
    required: true,
    index: true,
    // CB-prefixed entity ID of the enrolling citizen
  },

  scheduleId: {
    type: String,
    required: true,
    index: true,
    // CP-prefixed schedule entity ID
  },

  // ── Optional self-declared CB ID ───────────────────────────────────────────
  selfCbId: {
    type: String,
    default: null,
    // If citizen provides their own CB ID in the Enrol form (optional field)
  },

  // ── Status ────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['ACTIVE', 'CANCELLED', 'COMPLETED'],
    default: 'ACTIVE',
    index: true,
  },

  cancelledAt:  { type: Date, default: null },
  completedAt:  { type: Date, default: null },

  // ── AI filter result ───────────────────────────────────────────────────────
  aiFlags: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

}, {
  timestamps: true,
  collection: 'ucrs_enrolments',
});

// Prevent duplicate enrolments
enrolmentSchema.index({ citizenId: 1, scheduleId: 1 }, { unique: true });

// Enrolment list for a schedule (capacity check)
enrolmentSchema.index({ scheduleId: 1, status: 1 });

module.exports = mongoose.model('UCRSEnrolment', enrolmentSchema);
