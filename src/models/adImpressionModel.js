const mongoose = require('mongoose');

// Per-second ad impression tracking
const adImpressionSchema = new mongoose.Schema({
  // ==================== REFERENCES ====================
  adId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Advertisement',
    required: true,
    index: true
  },
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },

  // ==================== TIMING ====================
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  secondsWatched: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAdDuration: {
    type: Number, // Total ad duration in seconds
    required: true
  },
  completionRate: {
    type: Number, // 0-100%
    default: 0
  },

  // ==================== REVENUE ====================
  ratePerSecond: {
    type: Number,
    required: true
  },
  effectiveRate: {
    type: Number, // After multiplier (live vs recorded)
    required: true
  },
  totalRevenue: {
    type: Number, // Total revenue generated in Neurons
    default: 0
  },
  teacherShare: {
    type: Number,
    default: 0
  },
  studentShare: {
    type: Number,
    default: 0
  },
  platformShare: {
    type: Number,
    default: 0
  },

  // ==================== CONTEXT ====================
  isLive: {
    type: Boolean,
    default: false
  },
  multiplier: {
    type: Number,
    default: 1.0
  },

  // ==================== FRAUD DETECTION ====================
  fraudScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  isFraudulent: {
    type: Boolean,
    default: false,
    index: true
  },
  fraudReasons: [{
    type: String
  }],
  deviceFingerprint: {
    type: String
  },
  ipAddress: {
    type: String
  },

  // ==================== STATUS ====================
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'fraud'],
    default: 'active',
    index: true
  },
  settled: {
    type: Boolean,
    default: false,
    index: true
  },
  settledAt: {
    type: Date
  }
}, {
  timestamps: true,
  collection: 'ad_impressions'
});

// ==================== COMPOUND INDEXES ====================
adImpressionSchema.index({ adId: 1, studentId: 1, startTime: -1 });
adImpressionSchema.index({ lectureId: 1, startTime: -1 });
adImpressionSchema.index({ studentId: 1, startTime: -1 });
adImpressionSchema.index({ settled: 1, status: 1 });
adImpressionSchema.index({ createdAt: -1 });

// ==================== STATICS ====================
adImpressionSchema.statics.getRevenueByPeriod = function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        startTime: { $gte: startDate, $lte: endDate },
        status: 'completed',
        isFraudulent: false
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalRevenue' },
        teacherTotal: { $sum: '$teacherShare' },
        studentTotal: { $sum: '$studentShare' },
        platformTotal: { $sum: '$platformShare' },
        totalImpressions: { $sum: 1 }
      }
    }
  ]);
};

const AdImpression = mongoose.model('AdImpression', adImpressionSchema);
module.exports = AdImpression;
