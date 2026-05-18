'use strict';

/**
 * UCRS Outbox — Generic guaranteed-delivery event store.
 *
 * Unlike uce_outbox (which is CID-keyed and UCE-specific), this collection
 * handles all UCRS domain events: schedule created/cancelled, enrolment
 * created/cancelled, and any future UCRS actions.
 *
 * Lifecycle: pending → processing → processed
 *                              ↘ pending  (retry if attempts < MAX_ATTEMPTS)
 *                              ↘ failed   (permanent, requires manual review)
 *
 * Every entry carries a correlationId (the HTTP requestId from Phase 3) for
 * full distributed trace continuity: HTTP request → service call → outbox →
 * Redis Stream → downstream consumer.
 *
 * Design: no MongoDB transactions required. Atomic claim via findOneAndUpdate
 * prevents double-processing across multiple Node.js workers.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const UCRS_OUTBOX_EVENT_TYPES = Object.freeze([
  'SCHEDULE_CREATED',
  'SCHEDULE_CANCELLED',
  'ENROLMENT_CREATED',
  'ENROLMENT_CANCELLED',
  'CONTENT_LINKED',         // future: content CID linked to a schedule
  'CAPABILITY_GRANTED',     // future: capability-based gate events
]);

const ucrsOutboxSchema = new Schema(
  {
    // Stable unique identifier for this outbox entry (UUID).
    // Included in the dispatched payload so downstream consumers can deduplicate.
    eventId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // Distributed trace: the HTTP requestId threaded in from the originating request.
    correlationId: { type: String, default: null, index: true },

    // CB-prefixed UCRS citizen ID of the actor who caused this event.
    actorId:       { type: String, required: true, index: true },

    // Domain event type (closed vocabulary).
    eventType:     { type: String, enum: UCRS_OUTBOX_EVENT_TYPES, required: true, index: true },

    // The UCRS domain type of the primary entity (used for routing and replay).
    entityType:    { type: String, required: true },

    // The primary entity reference (scheduleId, 'citizenId::scheduleId', etc.).
    entityId:      { type: String, required: true, index: true },

    // If the event is related to UCE content — cross-references uce_outbox/uce_content.
    contentCid:    { type: String, default: null, index: true },

    // Full event payload snapshotted at creation time.
    payload:       { type: Schema.Types.Mixed, required: true },

    // Delivery state.
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'processed', 'failed'],
      default: 'pending',
      index:   true,
    },

    // How many dispatch attempts have been made.
    attempts:      { type: Number, default: 0 },

    // When the last dispatch attempt started (for stale-entry recovery).
    lastAttemptAt: { type: Date, default: null },

    // Set when status transitions to 'processed'.
    processedAt:   { type: Date, default: null },

    // Wall-clock ms from createdAt to processedAt — populated by the dispatcher.
    processingLatencyMs: { type: Number, default: null },

    // Last error message (observability).
    errorMessage:  { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'ucrs_outbox',
  }
);

// Worker primary query: oldest pending entries first
ucrsOutboxSchema.index({ status: 1, createdAt: 1 });

// Stale-entry reclaim: find stuck 'processing' entries
ucrsOutboxSchema.index({ status: 1, lastAttemptAt: 1 });

// Retry gate
ucrsOutboxSchema.index({ status: 1, attempts: 1 });

// Observability: latency per eventType
ucrsOutboxSchema.index({ eventType: 1, status: 1, processedAt: 1 });

module.exports = mongoose.model('UCRSOutbox', ucrsOutboxSchema);
module.exports.UCRS_OUTBOX_EVENT_TYPES = UCRS_OUTBOX_EVENT_TYPES;
