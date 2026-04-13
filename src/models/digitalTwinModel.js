'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * DigitalTwin — a live, evolving model of each learner.
 * Updated after every session, quiz, and AI interaction.
 */

const skillSchema = new Schema({
  topic:      { type: String, required: true },
  category:   { type: String },
  mastery:    { type: Number, min: 0, max: 100, default: 0 },
  lastUpdated: Date,
  evidences:  [{
    source:    String,   // 'quiz', 'session_watch', 'co_teacher', 'self_report'
    delta:     Number,
    timestamp: Date
  }]
}, { _id: false });

const digitalTwinSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    unique: true,
    required: true,
    index: true
  },

  // ── Skill graph ────────────────────────────────────────────────────────────
  skills: [skillSchema],

  // ── Cognitive profile (inferred from behavior) ────────────────────────────
  cognitiveProfile: {
    level: {
      type: String,
      enum: ['beginner','intermediate','advanced','expert'],
      default: 'beginner'
    },
    learningPace:    { type: String, enum: ['slow','medium','fast'], default: 'medium' },
    attentionSpan:   { type: Number, default: 25 },   // minutes before drop-off
    preferredDepth:  { type: String, enum: ['simplified','visual','mathematical','research'], default: 'simplified' },
    strongCategories:  [String],
    weakCategories:    [String],
    lastRecalculatedAt: Date
  },

  // ── Learning preferences ───────────────────────────────────────────────────
  preferences: {
    preferredContentTypes:  { type: [String], default: ['video'] },
    optimalSessionLength:   { type: Number, default: 30 },   // minutes
    bestTimeOfDay:          { type: String, enum: ['morning','afternoon','evening','night'], default: 'morning' },
  },

  // ── Engagement stats (denormalised) ───────────────────────────────────────
  totalWatchMinutes:  { type: Number, default: 0 },
  totalQuizzesTaken:  { type: Number, default: 0 },
  avgQuizScore:       { type: Number, default: 0 },
  streakDays:         { type: Number, default: 0 },
  lastActiveAt:       Date,

  // ── Innovation activity ────────────────────────────────────────────────────
  ideasSubmitted:    { type: Number, default: 0 },
  prototypesBuilt:   { type: Number, default: 0 },

  // ── AI-generated summary (refreshed by Claude periodically) ───────────────
  aiSummary: {
    strengths:       [String],
    gaps:            [String],
    nextRecommended: [String],   // topic slugs
    learningStyle:   String,
    encouragement:   String,
    generatedAt:     Date
  },

  // ── Research directions suggested by AI ───────────────────────────────────
  researchDirections: [{
    topic:       String,
    question:    String,
    difficulty:  { type: String, enum: ['entry','mid','advanced'] },
    suggestedAt: Date
  }]

}, { timestamps: true, collection: 'digital_twins' });

digitalTwinSchema.index({ 'cognitiveProfile.level': 1 });

module.exports = mongoose.model('DigitalTwin', digitalTwinSchema);
