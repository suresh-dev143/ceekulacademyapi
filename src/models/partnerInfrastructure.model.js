const mongoose = require('mongoose');

const hourlySlotSchema = new mongoose.Schema({
  time: { 
    type: String, 
    required: [true, 'Slot time is required'],
    match: [/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Slot time must be in HH:mm-HH:mm format']
  },
  status: {
    type: String,
    enum: ['Available', 'Booked', 'Maintenance', 'Closed'],
    default: 'Closed'
  },
  pricing: {
    type: { 
      type: String, 
      enum: ['Free', 'Share', 'Fixed'], 
      default: 'Free' 
    },
    amount: { 
      type: Number, 
      min: 0, 
      default: 0 
    },
    unit: { 
      type: String, 
      enum: ['Hourly', 'Session'], 
      default: 'Hourly' 
    }
  }
}, { _id: false });

const availabilityScheduleSchema = new mongoose.Schema({
  day: {
    type: String,
    required: [true, 'Day is required'],
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },
  startTime: {
    type: String,
    required: false,
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Start time must be in HH:mm format']
  },
  endTime: {
    type: String,
    required: false,
    match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'End time must be in HH:mm format']
  },
  slots: [hourlySlotSchema],
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: ['Available', 'Booked', 'Maintenance', 'Closed'],
    default: 'Available'
  },
  pricing: {
    type: new mongoose.Schema({
      type: {
        type: String,
        enum: ['Free', 'Share', 'Fixed'],
        default: 'Free'
      },
      amount: {
        type: Number,
        min: 0,
        default: 0
      },
      unit: {
        type: String,
        enum: ['Hourly', 'Session'],
        default: 'Hourly'
      }
    }, { _id: false }),
    default: () => ({ type: 'Free', amount: 0 })
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  }
}, { _id: false });


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

const classroomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  id: { type: String, required: true },
  capacity: { type: Number, required: true, min: [1, 'Capacity must be at least 1'] },
  length: { type: Number, min: 0 },
  width: { type: Number, min: 0 },
  area: { type: Number, min: 0 },
  type: { type: String },
  technology: [String],
  furniture: [String],
  lighting: [String],
  ventilation: [String],
  specializedEquipment: { type: String },
  accessibility: [String],
  primaryUsage: { type: String },
  availabilitySchedule: [availabilityScheduleSchema]
}, { _id: true });

const computerLabSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  id: { type: String, required: true },
  workstations: { type: Number, required: true, min: [0, 'Workstations cannot be negative'] },
  capacity: { type: Number, required: true, min: [1, 'Capacity must be at least 1'] },
  softwareAvailable: [String],
  internetSpeed: { type: String },
  availabilitySchedule: [availabilityScheduleSchema]
}, { _id: true });

const facilitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  id: { type: String, required: true },
  type: { type: String, required: true },
  capacity: { type: Number, min: 0 },
  dimensions: { type: String },
  soundSystem: { type: Boolean, default: false },
  lightingSystem: { type: Boolean, default: false },
  projectorScreen: { type: Boolean, default: false },
  availabilitySchedule: [availabilityScheduleSchema]
}, { _id: true });

const PartnerInfrastructureSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Infrastructure title is required'],
    trim: true
  },
  generalInfo: {
    schoolName: { type: String, required: true },
    address: { type: addressSchema, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
    },
    contactName: { type: String },
    contactEmail: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
        },
        message: '{VALUE} is not a valid email'
      }
    },
    contactPhone: { type: String, required: true },
    timeZone: { type: String, required: true }
  },
  classrooms: [classroomSchema],
  computerLabs: [computerLabSchema],
  otherFacilities: [facilitySchema]
}, {
  timestamps: true,
  collection: 'partner_infrastructures'
});

// Indexes
PartnerInfrastructureSchema.index({ partnerId: 1 });
PartnerInfrastructureSchema.index({ 'generalInfo.location': '2dsphere' });
PartnerInfrastructureSchema.index({ 'title': 1 }); // Helpful for searching by title
PartnerInfrastructureSchema.index({ 'classrooms.id': 1 });
PartnerInfrastructureSchema.index({ 'computerLabs.id': 1 });
PartnerInfrastructureSchema.index({ 'address.city': 1 });
PartnerInfrastructureSchema.index({ 'address.pincode': 1 });

const PartnerInfrastructure = mongoose.model('PartnerInfrastructure', PartnerInfrastructureSchema);

module.exports = PartnerInfrastructure;
