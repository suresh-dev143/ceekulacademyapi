const mongoose = require('mongoose');

// Address sub-schema
const addressSchema = new mongoose.Schema({
  addressLine1: { type: String, trim: true },
  addressLine2: { type: String, trim: true },
  landmark: { type: String, trim: true },
  city: { type: String, trim: true },
  district: { type: String, trim: true },
  state: { type: String, trim: true },
  country: { type: String, trim: true, default: 'India' },
  pincode: {
    type: String,
    trim: true,
    validate: {
      validator: function (v) { return !v || /^[0-9]{6}$/.test(v); },
      message: 'Invalid pincode'
    }
  }
}, { _id: false });

// Schedule sub-schema (formerly Session)
const scheduleSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: [true, 'Schedule date is required']
  },
  startTime: {
    type: String,
    required: [true, 'Start time is required'],
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Start time must be in HH:mm format']
  },
  endTime: {
    type: String,
    required: [true, 'End time is required'],
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'End time must be in HH:mm format']
  },
  activity: {
    type: String,
    trim: true,
    maxlength: [200, 'Activity cannot exceed 200 characters'],
    default: ''
  },
  sessionOrder: {
    type: Number,
    enum: [1, 2, 3],
    required: [true, 'Session order mapping is required']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
    default: ''
  },
  fee: {
    type: Number,
    required: [true, 'Schedule fee is required'],
    min: [0, 'Fee cannot be negative']
  },
  mode: {
    type: String,
    enum: ['online', 'hybrid'],
    required: [true, 'Schedule mode is required']
  },
  streamMode: {
    type: String,
    enum: ['live_broadcast', 'interactive_class'],
    default: null  // Only relevant when mode === 'online'
  },
  location: {
    type: String,
    trim: true,
    default: null
  },
  instructorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Instructor ID is required to track who manages this schedule']
  },
  timezone: {
    type: String,
    required: [true, 'Timezone is required for each schedule']
  }
}, { _id: true });

// Main Workshop Schema
const workshopSchema = new mongoose.Schema({
  workshopTitle: {
    type: String,
    required: [true, 'Workshop title is required'],
    trim: true,
    minlength: [5, 'Title must be at least 5 characters'],
    maxlength: [120, 'Title cannot exceed 120 characters']
  },
  workshopDescription: {
    type: String,
    required: [true, 'Workshop description is required'],
    trim: true,
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  expertDescription: {
    type: String,
    trim: true,
    maxlength: [2000, 'Expert description cannot exceed 2000 characters']
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'cancelled'],
    default: 'draft'
  },
  // threeHourPlan is populated from the CID transform — not edited directly by users
  threeHourPlan: {
    hour1: {
      title:             { type: String, default: '' },
      description:       { type: String, default: '' },
      expertAllowed:     { type: Boolean, default: true },
      instructorAllowed: { type: Boolean, default: false }
    },
    hour2: {
      title:             { type: String, default: 'Hands On' },
      description:       { type: String, default: '' },
      expertAllowed:     { type: Boolean, default: true },
      instructorAllowed: { type: Boolean, default: false }
    },
    hour3: {
      title:             { type: String, default: 'Project Discussion' },
      description:       { type: String, default: '' },
      expertAllowed:     { type: Boolean, default: true },
      instructorAllowed: { type: Boolean, default: true }
    }
  },
  schedules: [scheduleSchema],
  address: {
    type: addressSchema
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  totalRevenuePotential: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // ── Per-hour CID references (link to Create Page content) ──────────────────
  contentRef: {
    hour1: { cid: { type: String, default: null }, version: { type: Number, default: null } },
    hour2: { cid: { type: String, default: null }, version: { type: Number, default: null } },
    hour3: { cid: { type: String, default: null }, version: { type: Number, default: null } },
  },

  // ── Ad Configuration (applies to every hour's ad break) ────────────────────
  // Ads flow after every 50 min of content across all Ceekul content types.
  // Learners may replace the ad break with an activity from breakActivities.
  // An empty breakActivities array means the platform default list is offered.
  adConfig: {
    contentDurationMinutes: { type: Number, default: 50 },
    adBreakMinutes:         { type: Number, default: 10 },
    filters: {
      domains:    { type: [String], default: [] },
      categories: { type: [String], default: [] },
      keywords:   { type: [String], default: [] },
    },
    // Who can override the ad filter at runtime
    overrideBy: { type: String, enum: ['creator', 'instructor', 'learner'], default: 'learner' },
    // Activities learners may substitute for the ad break ([] = platform defaults)
    breakActivities: {
      type: [String],
      enum: ['stretch', 'meditation', 'notes', 'quiz', 'discussion', 'walk', 'custom'],
      default: []
    }
  },

  // ==================== GLOBAL DISPATCHER ====================
  // Linked Atomic Content references (Atomic Identity Engine)
  linkedAtomicContent: [{
    contentId: { type: String, required: true },
    role: { type: String, required: true },
    metadata: mongoose.Schema.Types.Mixed,
    addedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  collection: 'workshops'
});

// ==================== INDEXES ====================
workshopSchema.index({ createdBy: 1 });
workshopSchema.index({ status: 1 });
workshopSchema.index({ location: '2dsphere' });
workshopSchema.index({ 'schedules.date': 1 });
workshopSchema.index({ createdBy: 1, status: 1 });
workshopSchema.index({ 'address.city': 1 });

// ==================== PRE-SAVE ====================
workshopSchema.pre('save', function () {
  if (this.schedules && this.schedules.length > 0) {
    this.totalRevenuePotential = this.schedules.reduce((sum, s) => sum + (s.fee || 0), 0);
  }
});

const Workshop = mongoose.model('Workshop', workshopSchema);
module.exports = Workshop;
