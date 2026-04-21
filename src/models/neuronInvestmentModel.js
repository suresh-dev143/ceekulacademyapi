/**
 * NEURON INVESTMENT MODEL
 * =====================================================================
 * Tracks neuron commitments to projects.
 *
 * Bucket rules (strictly enforced):
 *   FUN → any project type
 *   CUN → research / innovation / knowledge projects ONLY
 *   SUN → business / infrastructure / social projects ONLY
 *
 * Flow:
 *   1. Neurons locked from source bucket → locked pool
 *   2. Portal generates non-financial instruction for entity
 *   3. Entity transfers real money escrow-to-escrow (OUTSIDE portal)
 *   4. Project executes externally
 *   5. Outcome evaluated → rewards credited to My Neurons
 *
 * Returns:
 *   - Variable, outcome-based, NON-GUARANTEED
 *   - NOT fixed return, NOT interest, NOT yield
 * =====================================================================
 */
const mongoose = require('mongoose');

const PROJECT_TYPES = [
  'any',
  'research', 'innovation', 'knowledge',          // CUN eligible
  'business', 'infrastructure', 'social',          // SUN eligible
];

// Which source buckets are allowed per project type
const BUCKET_PROJECT_RULES = {
  fun: PROJECT_TYPES,   // FUN can invest in anything
  cun: ['research', 'innovation', 'knowledge', 'any'],
  sun: ['business', 'infrastructure', 'social', 'any'],
};

const neuronInvestmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Project & Entity ───────────────────────────────────────────────
    projectId:   { type: String, required: true, trim: true },
    projectName: { type: String, required: true, trim: true },
    projectType: {
      type: String,
      enum: PROJECT_TYPES,
      required: true,
    },
    entityType: {
      type: String,
      enum: ['Trust', 'Section8', 'PvtLtd'],
      required: true,
    },
    entityName: { type: String, trim: true },

    // ── Source Bucket & Amount ─────────────────────────────────────────
    sourceBucket: {
      type: String,
      enum: ['fun', 'cun', 'sun'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Minimum investment is 1 neuron'],
    },

    // ── Lock Transaction Reference ─────────────────────────────────────
    lockTxId: { type: String },   // NeuronTransaction._id for the lock
    releaseTxId: { type: String }, // NeuronTransaction._id for any release

    // ── Lifecycle ──────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['locked', 'completed', 'released', 'failed'],
      default: 'locked',
    },

    // ── Outcome Evaluation (set when project is completed) ─────────────
    outcome: {
      revenue:     { type: Number },
      cost:        { type: Number },
      impact:      { type: String, trim: true, maxlength: 2000 },
      evaluatedAt: { type: Date },
    },

    // ── Reward (credited to My Neurons on completion) ──────────────────
    // Variable, outcome-based, non-guaranteed. NOT interest or fixed return.
    rewardAmount: { type: Number, default: 0 },
    rewardTxId:   { type: String },
    rewardedAt:   { type: Date },

    lockedAt:    { type: Date, default: Date.now },
    completedAt: { type: Date },
    notes:       { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,
    collection: 'neuron_investments',
  }
);

neuronInvestmentSchema.index({ userId: 1, createdAt: -1 });
neuronInvestmentSchema.index({ projectId: 1 });
neuronInvestmentSchema.index({ status: 1 });

// Expose rules for use in service layer
neuronInvestmentSchema.statics.BUCKET_PROJECT_RULES = BUCKET_PROJECT_RULES;

const NeuronInvestment = mongoose.model('NeuronInvestment', neuronInvestmentSchema);
module.exports = NeuronInvestment;
