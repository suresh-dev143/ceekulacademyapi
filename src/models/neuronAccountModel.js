/**
 * NEURON ACCOUNT MODEL
 * =====================================================================
 * Tracks per-user neuron state across 4 purpose-specific buckets.
 *
 * Ceekul neurons are NON-MONETARY internal participation units.
 * They cannot be withdrawn, converted to money, or used as currency.
 * All real-money transactions are handled by external legal entities.
 * The platform NEVER acts as a bank, wallet, or financial intermediary.
 * =====================================================================
 */
const mongoose = require('mongoose');

const neuronAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // ── BUCKET: My Neurons (Earning Layer) ─────────────────────────────
    // SOURCE: work rewards, task completion, project outcome rewards
    // NEVER receives: contribution conversions
    // OUTFLOW: monthly allocation to FUN/CUN/SUN (system-driven, not user)
    myNeurons: {
      balance:          { type: Number, default: 0, min: 0 },
      totalEarned:      { type: Number, default: 0 },   // cumulative credits
      totalAllocatedOut:{ type: Number, default: 0 },   // sent to buckets via monthly allocation
    },

    // ── BUCKET: FUN — Family Upgradation Neurons (Primary Gateway) ─────
    // SOURCE: contribution conversions (1 INR = 1 Neuron), monthly allocation
    // OUTFLOW: CUN, SUN — NEVER receives back from CUN or SUN
    // USES: services, sponsorship, invest in ANY project type
    fun: {
      balance:           { type: Number, default: 0, min: 0 },
      totalReceived:     { type: Number, default: 0 },
      totalTransferredOut: { type: Number, default: 0 },
    },

    // ── BUCKET: CUN — Cognitive Upgradation Neurons ────────────────────
    // SOURCE: transfers from FUN or SUN
    // OUTFLOW: SUN only (NEVER back to FUN)
    // USES: research, innovation, knowledge development ONLY
    cun: {
      balance:           { type: Number, default: 0, min: 0 },
      totalReceived:     { type: Number, default: 0 },
      totalTransferredOut: { type: Number, default: 0 },
    },

    // ── BUCKET: SUN — Social Upgradation Neurons ───────────────────────
    // SOURCE: transfers from FUN or CUN
    // OUTFLOW: CUN only (NEVER back to FUN)
    // USES: business projects, infrastructure, societal development ONLY
    sun: {
      balance:           { type: Number, default: 0, min: 0 },
      totalReceived:     { type: Number, default: 0 },
      totalTransferredOut: { type: Number, default: 0 },
    },

    // ── LOCKED POOL (Neurons committed to active project investments) ──
    lockedPool: {
      balance: { type: Number, default: 0, min: 0 },
    },

    // ── SUPPORT (Debt system) ──────────────────────────────────────────
    // Max 100,000 neurons, valid for 6 months
    // Repaid via work rewards or contributions
    support: {
      currentDebt:  { type: Number, default: 0, min: 0, max: 100000 },
      borrowedAt:   { type: Date },
      expiresAt:    { type: Date }, // borrowedAt + 6 months
    },

    // ── CONTRIBUTOR GRADE ──────────────────────────────────────────────
    // Based on participation, contribution, and impact
    contributorGrade: {
      type: String,
      enum: ['A', 'B', 'C'],
      default: null,
    },

    // ── MONTHLY ALLOCATION TRACKING ────────────────────────────────────
    monthlyAllocationLastRun: { type: Date },

    lastActivityAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'neuron_accounts',
  }
);

neuronAccountSchema.index({ userId: 1 });
neuronAccountSchema.index({ contributorGrade: 1 });

/**
 * Returns a snapshot of all bucket balances for ledger entries.
 */
neuronAccountSchema.methods.balanceSnapshot = function () {
  return {
    myNeurons: this.myNeurons.balance,
    fun:       this.fun.balance,
    cun:       this.cun.balance,
    sun:       this.sun.balance,
    lockedPool: this.lockedPool.balance,
  };
};

const NeuronAccount = mongoose.model('NeuronAccount', neuronAccountSchema);
module.exports = NeuronAccount;
