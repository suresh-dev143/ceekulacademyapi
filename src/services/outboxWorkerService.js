'use strict';

/**
 * Outbox Worker — Guaranteed Semantic Event Continuity
 *
 * Polls uce_outbox for pending events and delivers them to Redis Streams.
 * Retries up to MAX_ATTEMPTS times with a fixed polling interval.
 * Permanently failed entries (status='failed') require manual inspection.
 *
 * Concurrency: safe for multiple Node.js processes — each entry is claimed
 * atomically via findOneAndUpdate before processing. Only one worker will
 * ever process a given entry.
 *
 * Stale recovery: if a worker claims an entry (status='processing') and then
 * crashes, the entry is reclaimed after STALE_AFTER_MS and retried.
 *
 * Start: call start() once after database is connected.
 */

const UceOutbox              = require('../models/uceOutboxModel');
const UceContent             = require('../models/uceContentModel');
const { publishEventToStream } = require('./eventService');

const POLL_INTERVAL_MS = 2_000;   // how often to drain the queue
const MAX_ATTEMPTS     = 5;       // permanent failure threshold
const BATCH_SIZE       = 50;      // entries per drain cycle
const STALE_AFTER_MS   = 30_000;  // reclaim 'processing' entries stuck longer than this

// ── Core drain cycle ──────────────────────────────────────────────────────────

async function drain() {
  // Reclaim entries left in 'processing' by a crashed worker
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS);
  await UceOutbox.updateMany(
    { status: 'processing', lastAttemptAt: { $lt: staleThreshold } },
    { $set: { status: 'pending' } }
  ).catch(() => {});

  // Fetch a batch of deliverable pending entries, oldest first
  const entries = await UceOutbox.find({
    status:   'pending',
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  for (const entry of entries) {
    // Atomic claim: move pending → processing, increment attempt counter.
    // If another worker instance already claimed it, findOneAndUpdate returns null.
    const claimed = await UceOutbox.findOneAndUpdate(
      { _id: entry._id, status: 'pending' },
      {
        $set: { status: 'processing', lastAttemptAt: new Date() },
        $inc: { attempts: 1 },
      },
      { new: true }
    );
    if (!claimed) continue;

    try {
      // Guard against orphaned entries: if the process crashed after the outbox
      // write but before UceContent.create, the CID will not exist. Publishing
      // an event for missing content would mislead downstream consumers.
      const contentExists = await UceContent.exists({ cid: claimed.cid });
      if (!contentExists) {
        await UceOutbox.updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', errorMessage: 'Orphaned — cid not found in uce_content' } }
        ).catch(() => {});
        console.warn(`[OutboxWorker] Orphaned entry ${claimed._id}: cid ${claimed.cid} not in uce_content`);
        continue;
      }

      await publishEventToStream(claimed.eventType, claimed.payload);

      await UceOutbox.updateOne(
        { _id: claimed._id },
        { $set: { status: 'processed', processedAt: new Date(), errorMessage: null } }
      );
    } catch (err) {
      const isFinal = claimed.attempts >= MAX_ATTEMPTS;

      await UceOutbox.updateOne(
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
          `[OutboxWorker] Permanently failed — cid: ${claimed.cid}, ` +
          `eventType: ${claimed.eventType}, error: ${err.message}`
        );
      }
    }
  }
}

// ── Public: start ─────────────────────────────────────────────────────────────

function start() {
  console.log(`[OutboxWorker] Started — polling every ${POLL_INTERVAL_MS}ms, max ${MAX_ATTEMPTS} attempts`);

  const tick = async () => {
    try {
      await drain();
    } catch (err) {
      // Non-fatal: log and keep running
      console.error('[OutboxWorker] Unexpected drain error:', err.message);
    }
    setTimeout(tick, POLL_INTERVAL_MS);
  };

  tick();
}

module.exports = { start };
