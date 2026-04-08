const mongoose = require('mongoose');

// 1 Neuron = 1 INR
const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  userRole: {
    type: String,
    enum: ['teacher', 'student', 'advertiser', 'platform', 'researcher', 'entrepreneur', 'partner', 'volunteer', 'manager', 'instructor', 'admin', 'director'],
    required: true
  },

  // ==================== BALANCES ====================
  balance: {
    type: Number,
    default: 0,
    min: 0
  }, // Available Neurons
  pendingBalance: {
    type: Number,
    default: 0,
    min: 0
  }, // Neurons earned but not yet settled
  lockedBalance: {
    type: Number,
    default: 0,
    min: 0
  }, // Advertiser budget locked for active campaigns
  totalEarned: {
    type: Number,
    default: 0
  }, // Cumulative earnings (teachers/students)
  totalSpent: {
    type: Number,
    default: 0
  }, // Cumulative spend (advertisers)
  totalWithdrawn: {
    type: Number,
    default: 0
  },

  // ==================== SETTLEMENT ====================
  lastSettledAt: {
    type: Date
  },
  nextSettlementDate: {
    type: Date
  },

  // ==================== PAYMENT INFO ====================
  razorpayContactId: {
    type: String,
    trim: true
  },
  razorpayFundAccountId: {
    type: String,
    trim: true
  },
  bankAccountVerified: {
    type: Boolean,
    default: false
  },

  // ==================== STATUS ====================
  isActive: {
    type: Boolean,
    default: true
  },
  isFrozen: {
    type: Boolean,
    default: false
  }, // Frozen due to fraud

  // ==================== VERSION FOR OPTIMISTIC LOCKING ====================
  version: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  collection: 'wallets'
});

// ==================== INDEXES ====================
walletSchema.index({ userId: 1, userRole: 1 });
walletSchema.index({ nextSettlementDate: 1 });

// ==================== METHODS ====================
walletSchema.methods.canDebit = function (amount) {
  return !this.isFrozen && this.balance >= amount;
};

walletSchema.methods.canDebitLocked = function (amount) {
  return !this.isFrozen && this.lockedBalance >= amount;
};

// ==================== STATICS ====================
walletSchema.statics.getOrCreate = async function (userId, userRole) {
  let wallet = await this.findOne({ userId });
  if (!wallet) {
    wallet = await this.create({ userId, userRole });
  }
  return wallet;
};

const Wallet = mongoose.model('Wallet', walletSchema);
module.exports = Wallet;
