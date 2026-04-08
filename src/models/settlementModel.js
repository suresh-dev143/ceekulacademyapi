const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema({
  // ==================== PERIOD ====================
  month: {
    type: Number, // 1-12
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },

  // ==================== USER ====================
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userRole: {
    type: String,
    enum: ['teacher', 'student', 'advertiser'],
    required: true
  },

  // ==================== AMOUNTS ====================
  grossAmount: {
    type: Number,
    required: true,
    min: 0
  }, // Total earned/spent in Neurons
  platformFee: {
    type: Number,
    default: 0
  }, // Platform's cut
  netAmount: {
    type: Number,
    required: true,
    min: 0
  }, // After platform fee
  amountInINR: {
    type: Number
  }, // Converted to INR (1:1 with Neuron)

  // ==================== BREAKDOWN ====================
  totalImpressions: {
    type: Number,
    default: 0
  },
  totalSecondsWatched: {
    type: Number,
    default: 0
  },
  lectureSessions: {
    type: Number,
    default: 0
  },

  // ==================== PAYMENT ====================
  status: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'on_hold'],
    default: 'pending',
    index: true
  },
  razorpayPayoutId: {
    type: String,
    trim: true
  },
  razorpayPaymentId: {
    type: String,
    trim: true
  },
  paymentMode: {
    type: String,
    enum: ['bank_transfer', 'upi', 'wallet'],
    default: 'bank_transfer'
  },
  paidAt: {
    type: Date
  },
  failureReason: {
    type: String
  },
  retryCount: {
    type: Number,
    default: 0
  },

  // ==================== RECONCILIATION ====================
  reconciledTransactionIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }],
  isReconciled: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  collection: 'settlements'
});

// ==================== INDEXES ====================
settlementSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });
settlementSchema.index({ status: 1, periodEnd: 1 });
settlementSchema.index({ year: 1, month: 1 });

const Settlement = mongoose.model('Settlement', settlementSchema);
module.exports = Settlement;
