'use strict';

/**
 * UCRS Subscription Model — Phase 7 Semantic Watch System
 *
 * A citizen subscribes to a semantic topic (program title, category, instructor)
 * and receives notification events when matching content or schedules arrive.
 *
 * Notifications are written to ucrs_outbox (CONTENT_LINKED eventType) so they
 * flow through the same guaranteed-delivery pipeline as all other UCRS events.
 *
 * Watch types:
 *   program    — watch for schedules matching a programTitle
 *   category   — watch for any new schedule in a category
 *   instructor — watch for schedules by a specific instructorId
 *   cid        — watch for new versions derived from a specific contentCid
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const WATCH_TYPES = Object.freeze(['program', 'category', 'instructor', 'cid']);

const ucrsSubscriptionSchema = new Schema(
  {
    citizenId:  { type: String, required: true, index: true },
    watchType:  { type: String, enum: WATCH_TYPES, required: true },
    watchValue: { type: String, required: true, trim: true },
    status: {
      type:    String,
      enum:    ['active', 'paused', 'cancelled'],
      default: 'active',
      index:   true,
    },
    lastNotifiedAt: { type: Date, default: null },
    notifyCount:    { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'ucrs_subscriptions',
  }
);

// One citizen, one watch type+value combination
ucrsSubscriptionSchema.index({ citizenId: 1, watchType: 1, watchValue: 1 }, { unique: true });

// Matching query: find active subs for a given watch type + value
ucrsSubscriptionSchema.index({ watchType: 1, watchValue: 1, status: 1 });

module.exports = mongoose.model('UCRSSubscription', ucrsSubscriptionSchema);
module.exports.WATCH_TYPES = WATCH_TYPES;
