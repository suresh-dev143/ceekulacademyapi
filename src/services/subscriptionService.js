'use strict';

/**
 * UCRS Subscription Service — Phase 7 Semantic Watch System
 *
 * Manages citizen subscriptions to semantic topics and matches them against
 * incoming events. Notifications flow through ucrs_outbox for guaranteed delivery.
 *
 * Public API:
 *   subscribe(citizenId, watchType, watchValue)  → subscription doc
 *   unsubscribe(citizenId, subscriptionId)       → void
 *   getSubscriptions(citizenId)                  → subscription[]
 *   matchAndNotify(schedule)                     → { notified: number }
 *   matchAndNotifyCid(cid, parentCid, ownerId)   → { notified: number }
 */

const { v4: uuidv4 }        = require('uuid');
const UCRSSubscription       = require('../models/ucrsSubscriptionModel');
const UCRSOutbox             = require('../models/ucrsOutboxModel');

// ── Public API ────────────────────────────────────────────────────────────────

async function subscribe(citizenId, watchType, watchValue) {
  if (!citizenId || !watchType || !watchValue) {
    throw Object.assign(new Error('citizenId, watchType, watchValue are required'), { status: 400 });
  }

  try {
    return await UCRSSubscription.findOneAndUpdate(
      { citizenId, watchType, watchValue },
      { $setOnInsert: { citizenId, watchType, watchValue, status: 'active' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code === 11000) {
      return UCRSSubscription.findOne({ citizenId, watchType, watchValue }).lean();
    }
    throw err;
  }
}

async function unsubscribe(citizenId, subscriptionId) {
  const sub = await UCRSSubscription.findOneAndUpdate(
    { _id: subscriptionId, citizenId },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!sub) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  return sub;
}

async function getSubscriptions(citizenId) {
  return UCRSSubscription.find({ citizenId, status: { $in: ['active', 'paused'] } })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Match a newly created schedule against all active subscriptions and enqueue
 * notification events in ucrs_outbox for matched watchers.
 *
 * Called fire-and-forget from scheduleService after schedule creation.
 *
 * @param {object} schedule — schedule document (from UCRSSchedule.create)
 * @returns {{ notified: number }}
 */
async function matchAndNotify(schedule) {
  const { scheduleId, programTitle, category, instructorId } = schedule;

  // Find all subscriptions that could match this schedule
  const candidates = await UCRSSubscription.find({
    status: 'active',
    $or: [
      { watchType: 'program',    watchValue: programTitle },
      { watchType: 'category',   watchValue: category },
      ...(instructorId ? [{ watchType: 'instructor', watchValue: instructorId }] : []),
    ],
  }).lean();

  if (!candidates.length) return { notified: 0 };

  const outboxEntries = candidates.map(sub => ({
    eventId:    uuidv4(),
    actorId:    'system',
    eventType:  'CONTENT_LINKED',
    entityType: 'subscription_notification',
    entityId:   `${sub.citizenId}::${scheduleId}`,
    contentCid: schedule.contentRef?.cid || null,
    payload: {
      type:          'schedule_match',
      citizenId:     sub.citizenId,
      subscriptionId: String(sub._id),
      watchType:     sub.watchType,
      watchValue:    sub.watchValue,
      scheduleId,
      programTitle,
      category,
      scheduledDate: schedule.scheduledDate,
    },
  }));

  // Batch insert — individual failures don't block others
  const results = await Promise.allSettled(
    outboxEntries.map(e => UCRSOutbox.create(e))
  );

  const notified = results.filter(r => r.status === 'fulfilled').length;

  // Batch-update lastNotifiedAt for matched subscriptions
  const matchedIds = candidates.map(s => s._id);
  UCRSSubscription.updateMany(
    { _id: { $in: matchedIds } },
    { $set: { lastNotifiedAt: new Date() }, $inc: { notifyCount: 1 } }
  ).catch(() => {});

  return { notified };
}

/**
 * Match a newly committed CID against `cid` watchers.
 * A citizen watching a parentCid gets notified when a new derived version appears.
 *
 * @param {string} cid       — new CID just committed
 * @param {string} parentCid — parent CID (if versioned)
 * @returns {{ notified: number }}
 */
async function matchAndNotifyCid(cid, parentCid, ownerId) {
  if (!parentCid) return { notified: 0 };

  const subs = await UCRSSubscription.find({
    status:    'active',
    watchType: 'cid',
    watchValue: parentCid,
  }).lean();

  if (!subs.length) return { notified: 0 };

  const outboxEntries = subs.map(sub => ({
    eventId:    uuidv4(),
    actorId:    'system',
    eventType:  'CONTENT_LINKED',
    entityType: 'subscription_notification',
    entityId:   `${sub.citizenId}::${cid}`,
    contentCid: cid,
    payload: {
      type:           'new_version',
      citizenId:      sub.citizenId,
      subscriptionId: String(sub._id),
      watchedCid:     parentCid,
      newCid:         cid,
    },
  }));

  await Promise.allSettled(outboxEntries.map(e => UCRSOutbox.create(e)));

  UCRSSubscription.updateMany(
    { _id: { $in: subs.map(s => s._id) } },
    { $set: { lastNotifiedAt: new Date() }, $inc: { notifyCount: 1 } }
  ).catch(() => {});

  return { notified: subs.length };
}

module.exports = { subscribe, unsubscribe, getSubscriptions, matchAndNotify, matchAndNotifyCid };
