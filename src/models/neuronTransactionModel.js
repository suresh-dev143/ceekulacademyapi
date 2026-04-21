/**
 * NEURON TRANSACTION MODEL — Immutable Audit Ledger
 * =====================================================================
 * Every neuron movement is recorded here as an append-only entry.
 * Entries are NEVER deleted or modified after creation.
 * This provides a complete, auditable history of the ecosystem.
 * =====================================================================
 */
const mongoose = require('mongoose');

const BUCKETS = ['my_neurons', 'fun', 'cun', 'sun', 'locked_pool', 'group_neurons', 'ceegroup1', 'external'];

const TX_TYPES = [
  'contribution_conversion', // External money confirmed → FUN (1 INR = 1 Neuron)
  'bucket_transfer',         // User moves neurons between FUN/CUN/SUN (rules enforced)
  'investment_lock',         // Source bucket → locked pool (project investment)
  'investment_release',      // Locked pool → source bucket (project failed/cancelled)
  'project_reward',          // Project outcome reward → My Neurons
  'work_reward',             // Work/task completion → My Neurons
  'monthly_allocation_user', // My Neurons → FUN/CUN/SUN (user's 99% share)
  'monthly_allocation_ceekul', // My Neurons → Ceekul's 1% share
  'support_borrow',          // Support neurons credited (debt created)
  'support_repay',           // Support debt repaid
  'sponsorship',             // FUN or SUN used to sponsor another user
  'service_consume',         // FUN used for platform services
  'service_payment',         // CEEBRAIN/CEEGROUP sends FUN/CUN/SUN for a service (sender side)
  'service_receive',         // CEEBRAIN receives neurons into MY NEURONS from a service payment
  'group_deposit',           // Member transfers personal FUN/CUN/SUN → CEEGROUP bucket
  'expiry',                  // Unused neurons transferred to Ceegroup1 after 6 months
];

const neuronTransactionSchema = new mongoose.Schema(
  {
    txId: {
      type: String,
      unique: true,
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    txType: {
      type: String,
      enum: TX_TYPES,
      required: true,
    },

    fromBucket: {
      type: String,
      enum: BUCKETS,
      required: true,
    },

    toBucket: {
      type: String,
      enum: BUCKETS,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Transaction amount must be positive'],
    },

    // Full balance snapshot AFTER this transaction (audit trail)
    balanceAfter: {
      myNeurons:  { type: Number, default: 0 },
      fun:        { type: Number, default: 0 },
      cun:        { type: Number, default: 0 },
      sun:        { type: Number, default: 0 },
      lockedPool: { type: Number, default: 0 },
    },

    // Optional references linking the transaction to platform activities
    referenceId:   { type: String },
    referenceType: {
      type: String,
      enum: [
        'contribution', 'investment', 'project', 'task', 'work',
        'sponsorship', 'service', 'monthly_allocation', 'support',
        'expiry', 'system', 'ceebrain', 'ceegroup',
      ],
    },

    description: {
      type: String,
      required: true,
      maxlength: 500,
    },

    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: 'neuron_transactions',
  }
);

// Prevent modification of committed transactions
neuronTransactionSchema.pre('save', async function () {
  if (!this.isNew) {
    throw new Error('Neuron transactions are immutable and cannot be modified.');
  }
});

neuronTransactionSchema.index({ userId: 1, createdAt: -1 });
neuronTransactionSchema.index({ txId: 1 });
neuronTransactionSchema.index({ txType: 1 });
neuronTransactionSchema.index({ referenceId: 1 });

/**
 * Generates a unique, readable transaction ID.
 * Format: NTX-<timestamp>-<random>
 */
neuronTransactionSchema.statics.generateTxId = function () {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `NTX-${ts}-${rand}`;
};

const NeuronTransaction = mongoose.model('NeuronTransaction', neuronTransactionSchema);
module.exports = NeuronTransaction;
