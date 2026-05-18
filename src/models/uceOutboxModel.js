'use strict';

/**
 * UCE Outbox — Guaranteed Semantic Event Continuity
 *
 * Every CONTENT_COMMITTED event is written here before reaching Redis Streams.
 * A background worker (outboxWorkerService) drains pending entries to Redis,
 * retrying on failure until delivered or permanently failed.
 *
 * Lifecycle: pending → processing → processed
 *                               ↘ pending  (retry if attempt < MAX_ATTEMPTS)
 *                               ↘ failed   (permanent after MAX_ATTEMPTS)
 *
 * Designed to work without MongoDB replica sets — no transactions required.
 * The trade-off: if the process crashes between UceContent.create and
 * UceOutbox.create, the event is lost (same as today). All other failure
 * modes (Redis down, network partition, process restart) are fully covered.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const uceOutboxSchema = new Schema(
  {
    // The UCE content CID this event is for — enables cross-reference queries
    cid:       { type: String, required: true, index: true },

    // Event type — matches EVENT_TYPES in eventService.js
    eventType: { type: String, required: true },

    // Full event payload as recorded at commit time
    payload:   { type: Schema.Types.Mixed, required: true },

    // Delivery state
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'processed', 'failed'],
      default: 'pending',
      index:   true,
    },

    // How many delivery attempts have been made
    attempts:      { type: Number, default: 0 },

    // When the last delivery attempt started (used to reclaim stale 'processing' entries)
    lastAttemptAt: { type: Date, default: null },

    // Set when status → 'processed'
    processedAt:   { type: Date, default: null },

    // Last error message for observability
    errorMessage:  { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'uce_outbox',
  }
);

// Worker primary query: oldest pending entries first
uceOutboxSchema.index({ status: 1, createdAt: 1 });

// Stale-entry reclaim: find stuck 'processing' entries by lastAttemptAt
uceOutboxSchema.index({ status: 1, lastAttemptAt: 1 });

// Retry gate: pending entries that haven't exceeded max attempts
uceOutboxSchema.index({ status: 1, attempts: 1 });

module.exports = mongoose.model('UceOutbox', uceOutboxSchema);
