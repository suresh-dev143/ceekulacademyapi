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
  threeHourPlan: {
    hour1: {
      title: { type: String, required: [true, 'Hour 1 title is required'] },
      description: { type: String, required: [true, 'Hour 1 description is required'] },
      expertAllowed: { type: Boolean, default: true },
      instructorAllowed: { type: Boolean, default: false }
    },
    hour2: {
      title: { type: String, default: 'Hands On' },
      description: { type: String, required: [true, 'Hour 2 description is required'] },
      expertAllowed: { type: Boolean, default: true },
      instructorAllowed: { type: Boolean, default: true }
    },
    hour3: {
      title: { type: String, default: 'Project Discussion' },
      description: { type: String, required: [true, 'Hour 3 description is required'] },
      expertAllowed: { type: Boolean, default: true },
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
  }
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
