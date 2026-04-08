const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  // ==================== OWNERSHIP ====================
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher ID is required'],
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    index: true
  },

  // ==================== IDENTITY ====================
  title: {
    type: String,
    required: [true, 'Lecture title is required'],
    trim: true,
    maxlength: [300, 'Title cannot exceed 300 characters']
  },
  description: {
    type: String,
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  category: {
    type: String,
    required: [true, 'Lecture category is required'],
    trim: true,
    index: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  // ==================== CONTENT ====================
  type: {
    type: String,
    enum: ['live', 'recorded'],
    required: true,
    index: true
  },
  videoUrl: {
    type: String,
    trim: true
  },
  hlsPlaylistUrl: {
    type: String,
    trim: true
  },
  thumbnailUrl: {
    type: String
  },
  duration: {
    type: Number, // Duration in minutes (should be ~50)
    required: true,
    min: 1
  },
  adSlotDuration: {
    type: Number, // Duration of ad slot in minutes (should be ~10)
    default: 10
  },

  // ==================== LIVE STREAMING ====================
  streamKey: {
    type: String,
    trim: true
  },
  streamUrl: {
    type: String,
    trim: true
  },
  scheduledAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  endedAt: {
    type: Date
  },
  isLive: {
    type: Boolean,
    default: false,
    index: true
  },

  // ==================== AD PREFERENCES ====================
  adControl: {
    type: String,
    enum: ['teacher', 'student'], // Who controls ad preferences
    default: 'teacher'
  },
  preferredAdCategories: [{
    type: String,
    trim: true
  }],
  blockedAdCategories: [{
    type: String,
    trim: true
  }],
  minimumAdRate: {
    type: Number, // Minimum rate per second in Neurons
    default: 0
  },

  // ==================== STATUS & VISIBILITY ====================
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'live', 'processing', 'published', 'archived'],
    default: 'draft',
    index: true
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  publishedAt: {
    type: Date
  },

  // ==================== ANALYTICS ====================
  viewCount: {
    type: Number,
    default: 0
  },
  liveViewerCount: {
    type: Number,
    default: 0
  },
  peakViewerCount: {
    type: Number,
    default: 0
  },
  totalRevenue: {
    type: Number, // In Neurons
    default: 0
  },

  // ==================== PRICING MULTIPLIER ====================
  liveMultiplier: {
    type: Number,
    default: 2.0 // Live streams charge 2x
  }
}, {
  timestamps: true,
  collection: 'lectures'
});

// ==================== INDEXES ====================
lectureSchema.index({ teacherId: 1, status: 1 });
lectureSchema.index({ type: 1, isLive: 1 });
lectureSchema.index({ scheduledAt: 1 });
lectureSchema.index({ category: 1, status: 1 });
lectureSchema.index({ title: 'text', description: 'text', tags: 'text' });

const Lecture = mongoose.model('Lecture', lectureSchema);
module.exports = Lecture;
