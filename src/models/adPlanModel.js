'use strict';

/**
 * Ad Plan — precomputed, CID-based 600-second ad schedule for a session.
 *
 * Plans are computed BEFORE runtime by the adPreSchedulerService.
 * At the 50-minute mark, adDeliveryService fetches the plan in O(1) —
 * no matching, no DB scanning, no compute.
 *
 * sessionKey format:
 *   "page:{pageId}"                — teacher_global page
 *   "session:{pageId}:{userId}"    — personalized per student
 *
 * Cache: Redis "adplan:{sessionKey}" TTL=3600s (same as plan.expiresAt)
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const adSlotSchema = new Schema(
  {
    contentRef:  { type: String, required: true }, // UCE CID: "ck_..."
    adId:        { type: Schema.Types.ObjectId, ref: 'Advertisement' },
    startTime:   { type: Number, required: true }, // seconds offset in the 600s window
    endTime:     { type: Number, required: true },
    duration:    { type: Number, required: true },
    matchScore:  { type: Number, default: 0 },     // soft-score from optional criteria
    ratePerSec:  { type: Number, default: 0 },
    category:    { type: String },
  },
  { _id: false }
);

const adPlanSchema = new Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    sessionKey:  { type: String, required: true, unique: true, index: true },
    pageId:      { type: Schema.Types.ObjectId, ref: 'Page', index: true },
    userId:      { type: Schema.Types.ObjectId, ref: 'User', index: true }, // null = shared plan

    // ── Precomputed slot array ─────────────────────────────────────────────────
    slots:         { type: [adSlotSchema], default: [] },
    totalDuration: { type: Number, default: 0 }, // sum of slot durations

    // ── Context snapshot used during computation ──────────────────────────────
    criteriaSnapshot: { type: Schema.Types.Mixed, default: null },

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    computedAt:  { type: Date, default: Date.now },
    expiresAt:   { type: Date, required: true, index: true },
    deliveryCount: { type: Number, default: 0 },
  },
  {
    timestamps: false,
    collection: 'ad_plans',
  }
);

// TTL index — MongoDB auto-deletes expired plans
adPlanSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdPlan', adPlanSchema);
