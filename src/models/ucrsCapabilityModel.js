'use strict';

/**
 * UCRS Capability Token Store
 *
 * Replaces JWT for authorization. Each record is a signed capability granting
 * a subject entity the right to perform specific actions on a resource scope.
 *
 * Capabilities are delegatable (parent → child with equal or narrower scope)
 * and revocable by ID without a blocklist scan — status field is the gate.
 *
 * Verification: check status=ACTIVE, not expired, action in allowedActions,
 * resourceId matches resourceScope pattern.
 */

const mongoose = require('mongoose');
const { UCRS_ACTIONS } = require('../constants/ucrsConstants');

const constraintsSchema = new mongoose.Schema({
  expiresAt:        { type: Date,    default: null },
  maxDelegations:   { type: Number,  default: 3    }, // max delegation depth from this token
  locationRequired: { type: Boolean, default: false },
  riskScoreMax:     { type: Number,  default: 1.0, min: 0, max: 1 }, // 0=strictest, 1=any
  sessionBound:     { type: Boolean, default: false }, // if true, invalidated on session end
  ipLocked:         { type: String,  default: null  }, // SHA-256 of locked IP, if any
}, { _id: false });

const ucrsCapabilitySchema = new mongoose.Schema({
  // ── Identity ───────────────────────────────────────────────────────────────
  capabilityId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // ── Subject (who holds this capability) ───────────────────────────────────
  subjectId: {
    type: String,
    required: true,
    index: true,
  },

  subjectType: {
    type: String,
    required: true,
    // 'citizen' | 'agent' | 'service' | 'device' | 'process' | 'workflow'
  },

  // ── Resource scope ─────────────────────────────────────────────────────────
  // Glob-style scope: '*' = all, 'CS:education' = education service,
  // 'CR:abc123' = specific content, 'CS:*' = all services
  resourceScope: {
    type: String,
    required: true,
    default: '*',
  },

  // ── Permissions ────────────────────────────────────────────────────────────
  allowedActions: {
    type: [String],
    required: true,
    validate: {
      validator: (arr) => arr.every(a => UCRS_ACTIONS.includes(a)),
      message: 'allowedActions contains invalid action',
    },
  },

  // ── Constraints ────────────────────────────────────────────────────────────
  constraints: {
    type: constraintsSchema,
    default: () => ({}),
  },

  // ── Delegation chain ───────────────────────────────────────────────────────
  issuer: {
    type: String,
    required: true,
    // UCRS entityId or 'system' for root capabilities
  },

  parentCapabilityId: {
    type: String,
    default: null,
    index: true,
    // null = root capability; set for delegated child capabilities
  },

  delegationDepth: {
    type: Number,
    default: 0,
    // 0 = root, 1 = first delegation, etc. Cannot exceed parent maxDelegations.
  },

  // ── Integrity ──────────────────────────────────────────────────────────────
  // SHA-256( capabilityId + subjectId + resourceScope + allowedActions + issuer + issuedAt )
  // Verified on each capability check to detect record tampering.
  integrityHash: {
    type: String,
    required: true,
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'REVOKED', 'EXPIRED'],
    default: 'ACTIVE',
    index: true,
  },

  issuedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },

  revokedAt:  { type: Date,   default: null },
  revokedBy:  { type: String, default: null },
  revokeReason: { type: String, default: null },

}, {
  timestamps: false,
  strict: true,
});

// Subject's active capabilities (authorization hot path)
ucrsCapabilitySchema.index({ subjectId: 1, status: 1 });

// Cascade revoke: find all children of a revoked parent
ucrsCapabilitySchema.index({ parentCapabilityId: 1, status: 1 });

// Resource scope queries: "who can act on CS:education?"
ucrsCapabilitySchema.index({ resourceScope: 1, status: 1 });

module.exports = mongoose.model('UCRSCapability', ucrsCapabilitySchema);
