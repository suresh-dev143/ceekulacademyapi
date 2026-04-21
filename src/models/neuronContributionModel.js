/**
 * NEURON CONTRIBUTION MODEL
 * =====================================================================
 * Records external money contributions made to registered entities.
 * Once confirmed by the entity, the equivalent neurons (1 INR = 1 Neuron)
 * are credited to the user's FUN bucket.
 *
 * The PORTAL NEVER handles money. All money moves between the user's
 * personal bank account and the selected entity's escrow account —
 * both outside this system.
 * =====================================================================
 */
const mongoose = require('mongoose');

const neuronContributionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Selected Receiving Entity ──────────────────────────────────────
    entityType: {
      type: String,
      enum: ['Trust', 'Section8', 'PvtLtd'],
      required: true,
    },
    entityName: {
      type: String,
      required: true,
      trim: true,
    },
    entityId: {
      type: String, // Reference ID for the external entity registry
      trim: true,
    },

    // ── Money Transfer Details (external, verified externally) ─────────
    amountINR: {
      type: Number,
      required: true,
      min: [1, 'Minimum contribution is ₹1'],
    },
    // User-provided proof of their external bank transfer
    transactionReference: {
      type: String,
      required: true,
      trim: true,
    },

    // ── Neuron Issuance (set upon confirmation) ────────────────────────
    // Rule: 1 INR = 1 Neuron, credited to FUN ONLY
    neuronsIssued: {
      type: Number,
      default: 0,
    },
    neuronTransactionId: {
      type: String, // Links to the NeuronTransaction record
    },

    // ── Lifecycle Status ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rejected'],
      default: 'pending',
    },
    confirmedAt: { type: Date },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true },

    notes: { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,
    collection: 'neuron_contributions',
  }
);

neuronContributionSchema.index({ userId: 1, createdAt: -1 });
neuronContributionSchema.index({ status: 1 });
neuronContributionSchema.index({ transactionReference: 1 });

const NeuronContribution = mongoose.model('NeuronContribution', neuronContributionSchema);
module.exports = NeuronContribution;
