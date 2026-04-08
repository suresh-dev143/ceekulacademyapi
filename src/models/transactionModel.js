const mongoose = require('mongoose');

// Double-entry ledger system
const transactionSchema = new mongoose.Schema({
  // ==================== TRANSACTION IDENTITY ====================
  transactionId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'ad_revenue',          // Revenue from ad impression
      'budget_lock',         // Advertiser locks budget
      'budget_unlock',       // Unlock unused budget
      'budget_deduct',       // Deduct from locked budget per second
      'teacher_credit',      // Credit teacher's wallet
      'student_credit',      // Credit student's wallet
      'platform_fee',        // Platform's 1% cut
      'settlement_payout',   // Monthly payout
      'refund',              // Refund to advertiser
      'deposit',             // Top up wallet
      'withdrawal'           // Withdraw to bank
    ],
    required: true,
    index: true
  },

  // ==================== PARTIES ====================
  fromUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  toUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  fromWalletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet'
  },
  toWalletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet'
  },

  // ==================== AMOUNT ====================
  amount: {
    type: Number,
    required: true,
    min: [0.001, 'Amount must be greater than 0']
  }, // In Neurons
  currency: {
    type: String,
    default: 'Neuron'
  },

  // ==================== REFERENCES ====================
  adImpressionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdImpression'
  },
  adId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Advertisement'
  },
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture'
  },
  settlementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Settlement'
  },

  // ==================== METADATA ====================
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },

  // ==================== BALANCES (snapshot after transaction) ====================
  fromBalanceBefore: {
    type: Number
  },
  fromBalanceAfter: {
    type: Number
  },
  toBalanceBefore: {
    type: Number
  },
  toBalanceAfter: {
    type: Number
  },

  // ==================== STATUS ====================
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'reversed'],
    default: 'completed',
    index: true
  },
  failureReason: {
    type: String
  },

  // ==================== IMMUTABILITY ====================
  isReversed: {
    type: Boolean,
    default: false
  },
  reversedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }
}, {
  timestamps: true,
  collection: 'transactions'
});

// ==================== INDEXES ====================
transactionSchema.index({ fromUserId: 1, createdAt: -1 });
transactionSchema.index({ toUserId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1, createdAt: -1 });
transactionSchema.index({ adImpressionId: 1 });
transactionSchema.index({ settlementId: 1 });

// Prevent modification of completed transactions
transactionSchema.pre('save', function (next) {
  if (!this.isNew && this.isModified() && this.status === 'completed') {
    const allowedFields = ['isReversed', 'reversedBy', 'status'];
    const modifiedPaths = this.modifiedPaths();
    const illegalMods = modifiedPaths.filter(p => !allowedFields.includes(p));
    if (illegalMods.length > 0) {
      return next(new Error(`Cannot modify completed transaction fields: ${illegalMods.join(', ')}`));
    }
  }
  next();
});

// ==================== STATICS ====================
transactionSchema.statics.generateId = function () {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN-${timestamp}-${random}`;
};

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
