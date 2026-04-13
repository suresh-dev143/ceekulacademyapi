'use strict';

/**
 * ContentAtom — the fundamental unit of adaptive educational content.
 *
 * Each atom contains six layers:
 *   1. coreConcept          — the knowledge itself
 *   2. microHook            — 1–2 sentence attention trigger (5–10 s)
 *   3. cinematicExplanation — narrative key-frame explanation
 *   4. simulation           — interactive experience config
 *   5. xr                   — 3-D / spatial representation
 *   6. researchExtension    — open questions, hypotheses, papers
 *
 * Versioned: every AI or manual update stores a delta in versionHistory.
 */

const mongoose = require('mongoose');

// ── Micro-hook (Attention Trigger Layer) ──────────────────────────────────────

const microHookSchema = new mongoose.Schema({
  text:         { type: String, required: true },   // ≤ 2 sentences
  audioUrl:     String,                              // TTS / narration clip
  animationType: {
    type:    String,
    enum:    ['pulse', 'float', 'reveal', 'zoom', 'particle', 'glitch', 'typewriter', 'none'],
    default: 'pulse'
  },
  visualCue:   String,   // CSS animation class or SVG asset id
  colorScheme: { type: String, enum: ['indigo', 'emerald', 'amber', 'rose', 'cyan'], default: 'indigo' },
  durationMs:  { type: Number, default: 7000 }      // 5 000–10 000
}, { _id: false });

// ── Cinematic explanation ─────────────────────────────────────────────────────

const keyFrameSchema = new mongoose.Schema({
  secondsIn:  { type: Number, required: true },
  visual:     String,    // description / asset URL
  narration:  String,
  transition: { type: String, enum: ['fade', 'slide', 'zoom', 'dissolve', 'cut'], default: 'fade' }
}, { _id: false });

const cinematicSchema = new mongoose.Schema({
  narrative:     { type: String },   // full text narration
  keyFrames:     { type: [keyFrameSchema], default: [] },
  totalDuration: Number,             // seconds
  bgMusicUrl:    String,
  narrationUrl:  String,
  textSections: [{
    heading: String,
    body:    String,
    visualHint: String
  }]
}, { _id: false });

// ── Simulation ────────────────────────────────────────────────────────────────

const simulationSchema = new mongoose.Schema({
  simType: {
    type:    String,
    enum:    ['graph', 'drag-drop', 'physics', 'code-sandbox', 'quiz-flow', 'decision-tree', 'slider-params'],
    default: 'graph'
  },
  config:          { type: mongoose.Schema.Types.Mixed },  // renderer-specific JSON
  objective:       String,
  successCriteria: String,
  difficulty:      { type: Number, min: 1, max: 5, default: 2 },
  hints:           { type: [String], default: [] },
  maxAttempts:     { type: Number, default: 5 }
}, { _id: false });

// ── XR ────────────────────────────────────────────────────────────────────────

const xrSchema = new mongoose.Schema({
  sceneType: {
    type:    String,
    enum:    ['3d-model', 'spatial-diagram', 'vr-lab', 'ar-overlay', 'micro-world', 'data-viz'],
    default: '3d-model'
  },
  assetUrl:          String,           // glTF / USDZ / JSON scene
  interactionPoints: { type: [String], default: [] },
  ambientAudioUrl:   String,
  lightingPreset:    { type: String, enum: ['warm', 'cool', 'dramatic', 'neutral', 'neon'], default: 'neutral' },
  cameraStartPos:    { type: mongoose.Schema.Types.Mixed },  // { x, y, z, lookAt }
  annotations: [{
    label:    String,
    position: mongoose.Schema.Types.Mixed,  // { x, y, z }
    content:  String
  }]
}, { _id: false });

// ── Research extension ────────────────────────────────────────────────────────

const relatedPaperSchema = new mongoose.Schema({
  title:   String,
  authors: [String],
  year:    Number,
  doi:     String,
  url:     String,
  summary: String,
  tags:    [String]
}, { _id: false });

const researchExtSchema = new mongoose.Schema({
  openQuestions:    { type: [String], default: [] },
  hypotheses:       { type: [String], default: [] },
  futureDirections: { type: [String], default: [] },
  relatedPapers:    { type: [relatedPaperSchema], default: [] },
  lastEnriched:     { type: Date, default: Date.now }
}, { _id: false });

// ── Version history ───────────────────────────────────────────────────────────

const versionEntrySchema = new mongoose.Schema({
  version:   { type: Number, required: true },
  changedAt: { type: Date, default: Date.now },
  changedBy: String,   // 'system' | userId
  agent:     String,   // which Claude agent made the change
  reason:    String,
  delta:     { type: mongoose.Schema.Types.Mixed }  // JSON-patch or diff summary
}, { _id: false });

// ── Main schema ───────────────────────────────────────────────────────────────

const contentAtomSchema = new mongoose.Schema({
  atomId:  { type: String, required: true, unique: true },
  topicId: { type: String, required: true, index: true },
  title:   { type: String, required: true },

  coreConcept: {
    summary:          String,
    formalDefinition: String,
    keywords:         { type: [String], default: [] },
    difficulty:       { type: Number, min: 1, max: 5, default: 2 },
    domain:           String
  },

  microHook:            { type: microHookSchema,   default: () => ({}) },
  cinematicExplanation: { type: cinematicSchema,   default: () => ({}) },
  simulation:           { type: simulationSchema,  default: () => ({}) },
  xr:                   { type: xrSchema,          default: () => ({}) },
  researchExtension:    { type: researchExtSchema, default: () => ({}) },

  version:        { type: Number, default: 1 },
  versionHistory: { type: [versionEntrySchema], default: [] },

  qualityScore: { type: Number, default: 0, min: 0, max: 100 },

  engagementMetrics: {
    avgDwellTime:       { type: Number, default: 0 },
    completionRate:     { type: Number, default: 0 },
    avgMotivationDelta: { type: Number, default: 0 },
    triggerSuccessRate: { type: Number, default: 0 },
    viewCount:          { type: Number, default: 0 }
  },

  prerequisites: { type: [String], default: [] },  // atomIds
  followUps:     { type: [String], default: [] },
  tags:          { type: [String], default: [] },
  isActive:      { type: Boolean,  default: true }
}, { timestamps: true });

contentAtomSchema.index({ topicId: 1, 'coreConcept.difficulty': 1 });
contentAtomSchema.index({ tags: 1 });
contentAtomSchema.index({ isActive: 1, qualityScore: -1 });

module.exports = mongoose.model('ContentAtom', contentAtomSchema);
