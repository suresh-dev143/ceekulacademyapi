'use strict';

/**
 * UCRS Service Registry
 *
 * Every life service domain in the Ceekul Portal is registered here as a
 * CS-prefixed entity. The registry is the authoritative source for:
 *   - which services exist and their UCRS entity IDs
 *   - what capability scopes citizens get by default on registration
 *   - what policy relations the service recognises
 *   - the service's lifecycle state
 *
 * Auto-registration: ucrsServiceRegistryService.bootstrap() reads
 * UCRS_LIFE_SERVICE_DOMAINS and upserts one record per domain on every
 * server startup. Adding a domain to ucrsConstants.js is sufficient to
 * provision it on next deploy — no additional code required.
 */

const mongoose = require('mongoose');
const { UCRS_LIFECYCLE_STATES, UCRS_ACTIONS } = require('../constants/ucrsConstants');

const defaultCapabilityScopeSchema = new mongoose.Schema({
  // e.g. { allowedActions: ['read','observe'], resourceScope: 'CS:education' }
  allowedActions: {
    type: [String],
    validate: {
      validator: (arr) => arr.every(a => UCRS_ACTIONS.includes(a)),
      message: 'allowedActions contains invalid action',
    },
  },
  resourceScope: { type: String, required: true },
}, { _id: false });

const ucrsServiceRegistrySchema = new mongoose.Schema({
  // ── UCRS Identity ──────────────────────────────────────────────────────────
  serviceId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // CS{sequence} — assigned by hybridIdService on first registration
  },

  domain: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // lowercase domain name, e.g. 'education', 'health'
  },

  displayName: {
    type: String,
    required: true,
  },

  description: {
    type: String,
    default: '',
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  status: {
    type: String,
    required: true,
    enum: UCRS_LIFECYCLE_STATES,
    default: 'PENDING',
    index: true,
  },

  available: {
    type: Boolean,
    default: false,
    // mirrors the 'available' flag on the personal page life services card
  },

  // ── Authorization defaults ─────────────────────────────────────────────────
  // Capability scopes issued to every citizen upon portal registration.
  // Evolves as the service matures — changing this record is enough.
  defaultCitizenScopes: {
    type: [defaultCapabilityScopeSchema],
    default: [],
  },

  // Relations that this service recognises for access decisions.
  // e.g. ['member', 'viewer'] — citizens get 'viewer' by default,
  // 'member' on explicit enrolment.
  recognisedRelations: {
    type: [String],
    default: ['viewer'],
  },

  // ── Metadata ───────────────────────────────────────────────────────────────
  version: {
    type: Number,
    default: 1,
    // increment when defaultCitizenScopes or recognisedRelations change
  },

  lastBootstrappedAt: {
    type: Date,
    default: null,
  },

}, {
  timestamps: true,
  strict: true,
});

module.exports = mongoose.model('UCRSServiceRegistry', ucrsServiceRegistrySchema);
