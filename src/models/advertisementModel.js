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
    type: Number, // Duration in seconds — MUST be a multiple of 10
    required: [true, 'Ad duration is required'],
    min: [10, 'Ad duration must be at least 10 seconds'],
    max: [600, 'Ad duration cannot exceed 600 seconds'],
    validate: {
      validator: v => v % 10 === 0,
      message: 'Ad duration must be a multiple of 10 seconds'
    }
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

  // ==================== MULTI-CRITERIA MATCHING ====================
  // mandatoryCriteria — ALL fields present here must match (hard filter).
  // An ad is excluded entirely if any mandatory field mismatches.
  mandatoryCriteria: {
    categories: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    ageGroup: {
      type: String,
      enum: ['children', 'teen', 'adult', 'all'],
      default: 'all'
    },
    contentTypes: [{
      // e.g. 'theory', 'practice', 'project', 'workshop'
      type: String,
      trim: true,
      lowercase: true
    }],
    themes: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  },

  // optionalCriteria — present only when advertiser explicitly defines them.
  // Each defined field contributes a weighted score; absent fields are skipped.
  optionalCriteria: {
    // Target learner engagement band (0–100). Ads score higher when the
    // learner's current engagement is close to this value.
    engagementScoreTarget: {
      type: Number,
      min: 0,
      max: 100
    },
    // Behavioural signals the learner should exhibit for a strong match.
    // e.g. ['video-paused', 'note-taken', 'quiz-attempted']
    behavioralSignals: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    // Interest tags the learner profile should contain.
    interestTags: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    // ISO 639-1 language code. Binary match (exact or no score).
    preferredLanguage: {
      type: String,
      trim: true,
      lowercase: true
    }
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
advertisementSchema.pre('save', async function () {
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
