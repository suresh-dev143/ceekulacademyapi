'use strict';

/**
 * UCRS Policy Tuple Store — Zanzibar-style relationship graph.
 *
 * Each record is a (subject, relation, object) triple stating that
 * a subject entity has a named relationship to an object entity.
 *
 * Authorization checks evaluate:
 *   can(actor, action, resource)
 *   → find tuples where subject=actor AND object=resource
 *   → check if any relation's action set includes action
 *   → optionally traverse parent object hierarchies (group membership etc.)
 *
 * The relation vocabulary is open — new relations can be introduced via API
 * without schema changes. The built-in set is in UCRS_RELATIONS.
 */

const mongoose = require('mongoose');

const ucrsPolicyTupleSchema = new mongoose.Schema({
  // ── Subject (who) ──────────────────────────────────────────────────────────
  subjectId: {
    type: String,
    required: true,
    index: true,
  },

  subjectType: {
    type: String,
    required: true,
  },

  // ── Relation (how they relate) ─────────────────────────────────────────────
  relation: {
    type: String,
    required: true,
    // Open string — 'owner','admin','editor','member','viewer','auditor', or custom
  },

  // ── Object (to what) ──────────────────────────────────────────────────────
  objectId: {
    type: String,
    required: true,
    index: true,
  },

  objectType: {
    type: String,
    required: true,
  },

  // ── Provenance ─────────────────────────────────────────────────────────────
  createdBy: {
    type: String,
    required: true,
    // entityId of who granted this relationship
  },

  // ── Optional constraints ───────────────────────────────────────────────────
  expiresAt: {
    type: Date,
    default: null,
    index: true,
    // null = permanent until explicitly revoked
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    // e.g. { reason: 'enrolled', courseId: '...' }
  },

}, {
  timestamps: true,
  strict: true,
});

// Primary check: does subject have relation to object?
ucrsPolicyTupleSchema.index({ subjectId: 1, relation: 1, objectId: 1 }, { unique: true });

// Reverse lookup: who has relation to this object?
ucrsPolicyTupleSchema.index({ objectId: 1, relation: 1 });

// Expiry sweeper
ucrsPolicyTupleSchema.index({ expiresAt: 1 }, { sparse: true });

module.exports = mongoose.model('UCRSPolicyTuple', ucrsPolicyTupleSchema);
