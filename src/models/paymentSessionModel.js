const mongoose = require('mongoose');

const paymentSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type:      String,
      required:  true,
      unique:    true,
      immutable: true,
    },

    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    amountINR: {
      type:     Number,
      required: true,
      min:      [1, 'Minimum contribution is ₹1'],
    },
    currency: {
      type:    String,
      default: 'INR',
      enum:    ['INR'],
    },

    entityType: {
      type:     String,
      enum:     ['Trust', 'Section8', 'PvtLtd'],
      required: true,
    },
    entityName: {
      type:     String,
      required: true,
      trim:     true,
    },
    notes: {
      type:      String,
      trim:      true,
      maxlength: 1000,
    },

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['pending', 'completed', 'failed', 'expired'],
      default: 'pending',
    },

    // ── Filled in on return from Cramib/Razorpay ───────────────────────────────
    razorpayOrderId:   { type: String, trim: true },
    razorpayPaymentId: { type: String, trim: true },

    // ── Filled in on successful verification ──────────────────────────────────
    neuronsIssued:  { type: Number, default: 0 },
    neuronTxId:     { type: String },
    contributionId: { type: mongoose.Schema.Types.ObjectId, ref: 'NeuronContribution' },

    expiresAt:     { type: Date, required: true },
    completedAt:   { type: Date },
    failureReason: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: 'payment_sessions',
  }
);

paymentSessionSchema.index({ userId: 1, createdAt: -1 });
paymentSessionSchema.index({ status: 1 });

paymentSessionSchema.statics.generateSessionId = function () {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `SESS-${ts}-${rnd}`;
};

module.exports = mongoose.model('PaymentSession', paymentSessionSchema);
