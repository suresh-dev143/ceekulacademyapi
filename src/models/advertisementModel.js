const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema({
  // ==================== OWNERSHIP ====================
  advertiserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Advertiser ID is required'],
    index: true
  },

  // ==================== IDENTITY ====================
  title: {
    type: String,
    required: [true, 'Ad title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  videoUrl: {
    type: String,
    required: [true, 'Ad video URL is required'],
    trim: true
  },
  thumbnailUrl: {
    type: String,
    trim: true
  },
  duration: {
    type: Number, // Duration in seconds
    required: [true, 'Ad duration is required'],
    min: [1, 'Ad duration must be at least 1 second'],
    max: [600, 'Ad duration cannot exceed 600 seconds']
  },

  // ==================== TARGETING ====================
  category: {
    type: String,
    required: [true, 'Ad category is required'],
    trim: true,
    index: true
  },
  targetAudience: [{
    type: String,
    trim: true
  }],
  targetAgeMin: {
    type: Number,
    min: 0,
    max: 100
  },
  targetAgeMax: {
    type: Number,
    min: 0,
    max: 100
  },

  // ==================== PRICING & BUDGET ====================
  ratePerSecondPerStudent: {
    type: Number, // In Neurons (1 Neuron = 1 INR)
    required: [true, 'Rate per second per student is required'],
    min: [0.001, 'Rate must be greater than 0']
  },
  totalBudget: {
    type: Number, // Total budget in Neurons
    required: [true, 'Total budget is required'],
    min: [1, 'Budget must be at least 1 Neuron']
  },
  remainingBudget: {
    type: Number,
    min: 0
  },
  totalSpent: {
    type: Number,
    default: 0,
    min: 0
  },

  // ==================== SCHEDULING ====================
  expiryDate: {
    type: Date,
    required: [true, 'Expiry date is required'],
    index: true
  },
  startDate: {
    type: Date,
    default: Date.now
  },

  // ==================== STATUS ====================
  status: {
    type: String,
    enum: ['pending_review', 'active', 'paused', 'exhausted', 'expired', 'rejected'],
    default: 'pending_review',
    index: true
  },
  isActive: {
    type: Boolean,
    default: false,
    index: true
  },

  // ==================== ANALYTICS ====================
  totalImpressions: {
    type: Number,
    default: 0
  },
  totalSecondsPlayed: {
    type: Number,
    default: 0
  },
  uniqueStudentsReached: {
    type: Number,
    default: 0
  },
  clickCount: {
    type: Number,
    default: 0
  },

  // ==================== FRAUD PROTECTION ====================
  fraudScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  blockedImpressions: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  collection: 'advertisements'
});

// ==================== INDEXES ====================
advertisementSchema.index({ category: 1, status: 1, isActive: 1 });
advertisementSchema.index({ expiryDate: 1, status: 1 });
advertisementSchema.index({ ratePerSecondPerStudent: -1 });
advertisementSchema.index({ remainingBudget: 1 });
advertisementSchema.index({ advertiserId: 1, createdAt: -1 });

// ==================== PRE-SAVE ====================
advertisementSchema.pre('save', function (next) {
  if (this.isNew) {
    this.remainingBudget = this.totalBudget;
  }
  // Auto-expire
  if (this.remainingBudget <= 0) {
    this.status = 'exhausted';
    this.isActive = false;
  }
  if (this.expiryDate && new Date() > this.expiryDate) {
    this.status = 'expired';
    this.isActive = false;
  }
  next();
});

// ==================== STATICS ====================
advertisementSchema.statics.findEligibleAds = function (categories, minRate = 0) {
  const now = new Date();
  return this.find({
    category: { $in: categories },
    status: 'active',
    isActive: true,
    remainingBudget: { $gt: 0 },
    expiryDate: { $gt: now },
    ratePerSecondPerStudent: { $gte: minRate }
  }).sort({ ratePerSecondPerStudent: -1 });
};

const Advertisement = mongoose.model('Advertisement', advertisementSchema);
module.exports = Advertisement;
