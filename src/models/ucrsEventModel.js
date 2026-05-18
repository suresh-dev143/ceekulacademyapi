'use strict';

const mongoose = require('mongoose');
const { UCRS_EVENT_TYPES, UCRS_SCHEMA_VERSION } = require('../constants/ucrsConstants');

/**
 * UCRS Event Ledger — append-only audit trail.
 *
 * Every significant action in the system emits an event here.
 * Records are immutable once written; pre-save hooks enforce this.
 * Hash chaining (previousHash → eventHash) allows tamper detection
 * per actor stream.
 */
const ucrsEventSchema = new mongoose.Schema({
  // ── Identity ──────────────────────────────────────────────────────────────
  eventId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  schemaVersion: {
    type: String,
    required: true,
    default: UCRS_SCHEMA_VERSION,
  },

  eventType: {
    type: String,
    required: true,
    enum: UCRS_EVENT_TYPES,
    index: true,
  },

  // ── Actor (who caused it) ─────────────────────────────────────────────────
  actorId: {
    type: String,
    required: true,
    index: true,
  },

  actorType: {
    type: String,
    required: true,
    // e.g. 'citizen', 'agent', 'service' — mirrors UCRS_ENTITY_PREFIXES values
  },

  // ── Subject and resource ──────────────────────────────────────────────────
  subjectId: {
    type: String,
    default: null,
    // The entity the event is *about* (may differ from actor)
  },

  resourceId: {
    type: String,
    default: null,
    // The resource being acted upon (content CID, workflow ID, etc.)
  },

  // ── Payload ───────────────────────────────────────────────────────────────
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    // Event-type-specific data; schema varies per eventType
  },

  // ── Hash chain (integrity) ────────────────────────────────────────────────
  previousHash: {
    type: String,
    default: null,
    // SHA-256 of the previous event in this actor's stream; null for first event
  },

  eventHash: {
    type: String,
    required: true,
    // SHA-256( eventId + eventType + actorId + occurredAt + previousHash + payload )
  },

  // ── Session context ───────────────────────────────────────────────────────
  sessionRef: {
    type: String,
    default: null,
    index: true,
  },

  // ── Distributed trace ────────────────────────────────────────────────────
  traceId: {
    type: String,
    default: null,
    index: true,
  },

  // ── Request metadata (privacy-safe) ──────────────────────────────────────
  ipHash: {
    type: String,
    default: null,
    // SHA-256 of the originating IP — never store raw IP
  },

  userAgent: {
    type: String,
    default: null,
  },

  region: {
    type: String,
    default: null,
  },

  // ── Timestamp ─────────────────────────────────────────────────────────────
  occurredAt: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
}, {
  // Disable Mongoose auto-timestamps — occurredAt is our canonical timestamp
  timestamps: false,
  // Prevent schema drift from silently swallowing unknown fields
  strict: true,
});

// ── Compound indexes for common query patterns ────────────────────────────────

// Actor timeline (most common: "show me everything actor X did")
ucrsEventSchema.index({ actorId: 1, occurredAt: -1 });

// Session audit (everything in a session, newest first)
ucrsEventSchema.index({ sessionRef: 1, occurredAt: -1 });

// Event type + time (regulatory / compliance queries)
ucrsEventSchema.index({ eventType: 1, occurredAt: -1 });

// Subject audit (everything done *to* an entity)
ucrsEventSchema.index({ subjectId: 1, occurredAt: -1 });

// ── Immutability enforcement ──────────────────────────────────────────────────

ucrsEventSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('UCRS Event Ledger: records are immutable — updates are not permitted'));
  }
  next();
});

// Block all update operations at the model level
const BLOCKED_UPDATE_MSG = 'UCRS Event Ledger: records are immutable — use emit() to append new events';

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne']) {
  ucrsEventSchema.pre(op, function (next) {
    next(new Error(BLOCKED_UPDATE_MSG));
  });
}

module.exports = mongoose.model('UCRSEvent', ucrsEventSchema);
