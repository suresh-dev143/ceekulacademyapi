/**
 * WELFARE APPLICATION MODEL
 * =====================================================================
 * Persistent application queue for CG100000000000 welfare support.
 * Covers FUN (basic needs), CUN (cognitive upgradation), SUN (emergency).
 *
 * Key design rules:
 *  - Application stays in queue until fully met — no reapplication
 *  - outstandingNeed is derived from requestedAmount minus all ledger credits
 *  - Neurons disburse only AFTER service provider confirms delivery
 *  - Month-end batch disbursement by default; isEmergency bypasses the wait
 *  - All support must eventually be repaid (auto-deducted when CB balance
 *    crosses EC-set repaymentThreshold)
 * =====================================================================
 */
const mongoose = require('mongoose');

const FUND_TYPES    = ['fun', 'cun', 'sun'];
const GOAL_CATEGORIES = ['starving', 'shelter', 'learning', 'emergency_health', 'emergency_safety', 'other'];
const STATUS_TYPES  = ['pending', 'partially_funded', 'fulfilled', 'closed'];
const SUPPORT_SOURCE_TYPES = ['cg_fund', 'member_sun_donation', 'member_fun_donation', 'in_kind_service', 'cun_subsidy', 'other'];

// ── Support Ledger Entry ──────────────────────────────────────────────────────
// Append-only record of every partial support credited to this application.
// outstandingNeed = requestedAmount - sum(supportLedger[].amount)
const supportLedgerEntrySchema = new mongoose.Schema(
  {
    sourceId:   { type: String, required: true },   // CB/CG ID of provider/donor
    sourceType: { type: String, enum: SUPPORT_SOURCE_TYPES, required: true },
    amount:     { type: Number, required: true, min: 0.01 },
    description:{ type: String, maxlength: 500 },
    confirmedAt:{ type: Date, default: Date.now },
    confirmedBy:{ type: String }, // CB ID or system job that confirmed
  },
  { _id: true }
);

// ── Main Application Schema ───────────────────────────────────────────────────
const welfareApplicationSchema = new mongoose.Schema(
  {
    applicationId: {
      type: String,
      unique: true,
      required: true,
    },

    // ── Applicant ─────────────────────────────────────────────────────────────
    applicantUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    applicantCBId: {
      type: String,
      required: true,
      match: [/^\d{12}$/, 'CB ID must be exactly 12 digits'],
    },

    // ── What they are requesting ───────────────────────────────────────────────
    fundType: {
      type: String,
      enum: FUND_TYPES,
      required: true,
    },
    goalCategory: {
      type: String,
      enum: GOAL_CATEGORIES,
      required: true,
    },
    goalDescription: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    requestedAmount: {
      type: Number,
      required: true,
      min: [1, 'Minimum request is 1 neuron'],
    },

    // ── Live outstanding need (auto-maintained) ────────────────────────────────
    // Equals requestedAmount minus all credited support in supportLedger.
    // The algorithm ranks applicants by this value — NOT requestedAmount.
    outstandingNeed: {
      type: Number,
      required: true,
      min: 0,
    },

    // ── Partial support ledger (append-only) ──────────────────────────────────
    supportLedger: [supportLedgerEntrySchema],

    // ── Service provider ──────────────────────────────────────────────────────
    // Neurons do NOT disburse from CG100000000000 until provider confirms.
    serviceProviderId: { type: String }, // CB or CG ID
    serviceProviderConfirmed: { type: Boolean, default: false },
    serviceProviderConfirmedAt: { type: Date },

    // ── Disbursement ──────────────────────────────────────────────────────────
    isEmergency: { type: Boolean, default: false }, // bypasses month-end wait
    disbursedAmount: { type: Number, default: 0 },
    disbursedAt: { type: Date },

    // ── Repayment tracking ────────────────────────────────────────────────────
    // Set once auto-repayment is triggered by the background job.
    repaidAmount: { type: Number, default: 0 },
    repaidAt: { type: Date },
    fullyRepaidAt: { type: Date },

    // ── Status ────────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: STATUS_TYPES,
      default: 'pending',
    },

    // ── EC cycle tracking ─────────────────────────────────────────────────────
    // Which month-end cycle last processed this application (ISO yyyy-MM)
    lastProcessedCycle: { type: String },
  },
  {
    timestamps: true,
    collection: 'welfare_applications',
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
welfareApplicationSchema.index({ applicantUserId: 1 });
welfareApplicationSchema.index({ applicantCBId: 1 });
welfareApplicationSchema.index({ status: 1 });
welfareApplicationSchema.index({ fundType: 1, status: 1 });
welfareApplicationSchema.index({ isEmergency: 1, status: 1 });
welfareApplicationSchema.index({ outstandingNeed: 1 });
welfareApplicationSchema.index({ applicationId: 1 });

// ── Static helpers ────────────────────────────────────────────────────────────
welfareApplicationSchema.statics.generateApplicationId = function () {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `WAP-${ts}-${rand}`;
};

/**
 * Recalculates outstandingNeed from supportLedger and saves.
 * Call this every time a ledger entry is added.
 */
welfareApplicationSchema.methods.recalculateOutstandingNeed = async function () {
  const totalSupported = this.supportLedger.reduce((sum, e) => sum + e.amount, 0);
  this.outstandingNeed = Math.max(0, this.requestedAmount - totalSupported - this.disbursedAmount);
  if (this.outstandingNeed === 0) {
    this.status = 'fulfilled';
  } else if (this.disbursedAmount > 0 || this.supportLedger.length > 0) {
    this.status = 'partially_funded';
  }
  return this.save();
};

const WelfareApplication = mongoose.model('WelfareApplication', welfareApplicationSchema);
module.exports = WelfareApplication;
