'use strict';

const mongoose = require('mongoose');

// ── Content sub-schema ────────────────────────────────────────────────────────

const overlayContentSchema = new mongoose.Schema({
  headline:   { type: String, default: '' },
  body:       { type: String, default: '' },
  analogy:    { type: String, default: '' },
  tryThis:    { type: String, default: '' },
  concepts:   [String],
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'intermediate' }
}, { _id: false });

// ── Overlay schema ────────────────────────────────────────────────────────────

const overlaySchema = new mongoose.Schema({
  overlayId:        { type: String, required: true, unique: true, index: true },
  sourceId:         { type: String, required: true, index: true },   // lectureId / recordingId
  sourceType:       { type: String, enum: ['lecture', 'recording'], default: 'lecture' },
  userId:           { type: String, default: null, index: true },    // null = public overlay
  overlayType:      { type: String, enum: ['summary', 'explanation', 'callout', 'qa'], required: true },
  timestamp:        { type: Number, required: true },   // seconds — when overlay triggers
  endTimestamp:     { type: Number, default: null },    // seconds — when it hides (null = manual dismiss)
  content:          { type: overlayContentSchema, default: () => ({}) },
  questionContext:  { type: String, default: '' },      // original question for qa type
  generatedBy:      { type: String, enum: ['claude', 'manual'], default: 'claude' },
  isPublic:         { type: Boolean, default: false },
  isPinned:         { type: Boolean, default: false },
  proficiency:      { type: String, default: 'intermediate' },
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

overlaySchema.index({ sourceId: 1, timestamp: 1 });
overlaySchema.index({ sourceId: 1, userId: 1 });

module.exports = mongoose.model('Overlay', overlaySchema);
