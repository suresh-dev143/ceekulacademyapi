const mongoose = require('mongoose');

const preferencesSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  userRole: {
    type: String,
    enum: ['teacher', 'student'],
    required: true
  },

  // ==================== AD CATEGORY PREFERENCES ====================
  preferredCategories: [{
    type: String,
    trim: true
  }],
  blockedCategories: [{
    type: String,
    trim: true
  }],

  // ==================== RATE PREFERENCES (Student only) ====================
  minimumAdRate: {
    type: Number,
    default: 0,
    min: 0
  }, // Student wants ads that pay at least X Neurons/sec

  // ==================== TEACHER PREFERENCES ====================
  allowStudentAdControl: {
    type: Boolean,
    default: false
  }, // If true, student preferences override teacher preferences

  // ==================== CONTENT FILTERS ====================
  allowedContentRatings: [{
    type: String,
    enum: ['G', 'PG', 'PG-13', 'R'],
    default: ['G', 'PG']
  }],
  preferredLanguages: [{
    type: String,
    default: ['en', 'hi']
  }],

  // ==================== NOTIFICATION PREFERENCES ====================
  notifyOnEarnings: {
    type: Boolean,
    default: true
  },
  notifyOnSettlement: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'preferences'
});

const Preferences = mongoose.model('Preferences', preferencesSchema);
module.exports = Preferences;
