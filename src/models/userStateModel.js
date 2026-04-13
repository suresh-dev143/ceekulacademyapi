'use strict';

/**
 * UserState — real-time cognitive state model.
 *
 * Tracks per-session learner state: attention, cognitive load, proficiency,
 * motivation, and research orientation, along with raw behavioural signals
 * and mode history used by the Adaptive Experience Engine.
 */

const mongoose = require('mongoose');

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const signalSchema = new mongoose.Schema({
  interactionRate:    { type: Number, default: 0 },  // events per minute
  scrollDepth:        { type: Number, default: 0 },  // 0–100 %
  dwellTime:          { type: Number, default: 0 },  // seconds on atom
  responseTime:       { type: Number, default: 0 },  // ms to respond to trigger
  questionCount:      { type: Number, default: 0 },
  simulationAttempts: { type: Number, default: 0 },
  contentCompletions: { type: Number, default: 0 },
  errorCount:         { type: Number, default: 0 },
  keystrokes:         { type: Number, default: 0 }
}, { _id: false });

const cognitiveStateSchema = new mongoose.Schema({
  // 0 = distracted, 100 = fully focused
  attention:           { type: Number, default: 50, min: 0, max: 100 },
  // 0 = underloaded, 100 = overloaded, optimal ≈ 50–65
  cognitiveLoad:       { type: Number, default: 40, min: 0, max: 100 },
  // 0 = novice, 100 = expert (per topic)
  proficiency:         { type: Number, default: 0,  min: 0, max: 100 },
  // passive (0–33) → curious (34–66) → engaged (67–100)
  motivation:          { type: Number, default: 25, min: 0, max: 100 },
  // learning (0–33) → exploration (34–66) → innovation (67–100)
  researchOrientation: { type: Number, default: 10, min: 0, max: 100 }
}, { _id: false });

const attentionSnapshotSchema = new mongoose.Schema({
  ts:        { type: Date, default: Date.now },
  attention: Number,
  mode:      String,
  trigger:   String   // signal that caused this snapshot
}, { _id: false });

const modeDurationSchema = new mongoose.Schema({
  mode:        String,
  startedAt:   Date,
  endedAt:     Date,
  durationSec: Number
}, { _id: false });

// ── Main schema ───────────────────────────────────────────────────────────────

const userStateSchema = new mongoose.Schema({
  userId:    { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  topicId:   { type: String, index: true },

  currentMode: {
    type:    String,
    enum:    ['idle', 'trigger', 'cinematic', 'simulation', 'research', 'xr'],
    default: 'idle'
  },

  // Current mode started at (used for dwell enforcement)
  modeStartedAt: { type: Date, default: Date.now },

  state:            { type: cognitiveStateSchema, default: () => ({}) },
  signals:          { type: signalSchema,         default: () => ({}) },
  attentionHistory: { type: [attentionSnapshotSchema], default: [] },
  modeHistory:      { type: [modeDurationSchema],      default: [] },

  // Engagement progression tier
  progressionTier: {
    type:    String,
    enum:    ['passive', 'curious', 'interactive', 'research-focused'],
    default: 'passive'
  },

  // Reinforcement counters
  triggerResponseCount:   { type: Number, default: 0 },
  consecutiveCompletions: { type: Number, default: 0 },
  streakDays:             { type: Number, default: 0 },
  totalSessions:          { type: Number, default: 0 },

  lastActive:  { type: Date, default: Date.now },
  sessionStart: { type: Date, default: Date.now }
}, { timestamps: true });

userStateSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
userStateSchema.index({ topicId: 1, 'state.attention': 1 });

module.exports = mongoose.model('UserState', userStateSchema);
