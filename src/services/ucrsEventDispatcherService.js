'use strict';

/**
 * UCRS Event Dispatcher — Outbox Worker for UCRS Domain Events
 *
 * Drains ucrs_outbox (schedule/enrolment events) to Redis Streams with the
 * same reliability guarantees as the UCE outbox worker:
 *   - Atomic claim via findOneAndUpdate prevents double-processing
 *   - Stale entry recovery for crashed workers (reset processing → pending)
 *   - Up to MAX_ATTEMPTS retries before permanent failure
 *   - processingLatencyMs recorded per entry for observability
 *
 * Stream naming: stream:schedule_created, stream:enrolment_created, etc.
 * Each eventType maps to its own Redis Stream key (lowercase).
 *
 * Start: call start() once after database is connected.
 */

const UCRSOutbox              = require('../models/ucrsOutboxModel');
const { publishEventToStream } = require('./eventService');

const POLL_INTERVAL_MS = 5_000;   // UCRS events are less latency-sensitive than UCE
const MAX_ATTEMPTS     = 5;
const BATCH_SIZE       = 50;
const STALE_AFTER_MS   = 30_000;  // reclaim processing entries stuck > 30s

// ── Core drain cycle ──────────────────────────────────────────────────────────

async function drain() {
  // Reclaim entries left in 'processing' by a crashed or restarted worker
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS);
  await UCRSOutbox.updateMany(
    { status: 'processing', lastAttemptAt: { $lt: staleThreshold } },
    { $set: { status: 'pending' } }
  ).catch(() => {});

  // Fetch oldest pending deliverable entries
  const entries = await UCRSOutbox.find({
    status:   'pending',
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  for (const entry of entries) {
    // Atomic claim: only one worker instance will ever process a given entry
    const claimed = await UCRSOutbox.findOneAndUpdate(
      { _id: entry._id, status: 'pending' },
      {
        $set: { status: 'processing', lastAttemptAt: new Date() },
        $inc: { attempts: 1 },
      },
      { new: true }
    );
    if (!claimed) continue;

    const startedAt = Date.now();

    try {
      // Stream key mirrors eventType in lowercase: SCHEDULE_CREATED → stream:schedule_created
      const streamKey = claimed.eventType.toLowerCase();

      await publishEventToStream(streamKey, {
        eventId:       claimed.eventId,
        correlationId: claimed.correlationId,
        actorId:       claimed.actorId,
        eventType:     claimed.eventType,
        entityType:    claimed.entityType,
        entityId:      claimed.entityId,
        contentCid:    claimed.contentCid,
        payload:       claimed.payload,
        occurredAt:    claimed.createdAt,
      });

      const latencyMs = Date.now() - startedAt;

      await UCRSOutbox.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status:              'processed',
            processedAt:         new Date(),
            processingLatencyMs: latencyMs,
            errorMessage:        null,
          },
        }
      );
    } catch (err) {
      const isFinal = claimed.attempts >= MAX_ATTEMPTS;

      await UCRSOutbox.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status:        isFinal ? 'failed' : 'pending',
            errorMessage:  err.message,
            lastAttemptAt: new Date(),
          },
        }
      ).catch(() => {});

      if (isFinal) {
        console.error(
          `[UCRSDispatcher] Permanently failed — eventId: ${claimed.eventId}, ` +
          `eventType: ${claimed.eventType}, entityId: ${claimed.entityId}, error: ${err.message}`
        );
      }
    }
  }
}

// ── Public: start ─────────────────────────────────────────────────────────────

function start() {
  console.log(`[UCRSDispatcher] Started — polling every ${POLL_INTERVAL_MS}ms, max ${MAX_ATTEMPTS} attempts`);

  const tick = async () => {
    try {
      await drain();
    } catch (err) {
      console.error('[UCRSDispatcher] Unexpected drain error:', err.message);
    }
    setTimeout(tick, POLL_INTERVAL_MS);
  };

  tick();
}

module.exports = { start };
