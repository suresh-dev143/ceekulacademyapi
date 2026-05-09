'use strict';

const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Activity id is required']
    },
    startTime: {
      type: String,
      required: [true, 'Start time is required'],
      match: [/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format']
    },
    endTime: {
      type: String,
      required: [true, 'End time is required'],
      match: [/^\d{2}:\d{2}$/, 'End time must be in HH:MM format']
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters']
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters']
    },
    type: {
      type: String,
      required: [true, 'Type is required'],
      enum: ['health', 'learning', 'work', 'personal']
    }
  },
  { _id: false }
);

const myActivitiesSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      unique: true
    },
    ceebrainId: {
      type: String,
      index: true,
      sparse: true
    },
    activities: {
      type: [activitySchema],
      default: []
    },
    // Per-hour customisations keyed by hour (0–23).
    // Each entry: { user_override?: string, custom_content?: CustomContent }
    schedule_overrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    collection: 'myactivities'
  }
);

myActivitiesSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('MyActivities', myActivitiesSchema);
