'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * ContentVersion — tracks every evolution of a lecture's content.
 * Enables the "living knowledge entity" — diff-based updates with
 * research citations, so learners can compare old vs new.
 */
const contentVersionSchema = new Schema({
  lectureId: {
    type: Schema.Types.ObjectId,
    ref: 'Lecture',
    required: true,
    index: true
  },
  version:   { type: Number, default: 1 },

  // What triggered this version
  changeType: {
    type: String,
    enum: ['initial','prompt_refined','segment_reordered',
           'difficulty_adjusted','example_added','research_update',
           'error_corrected','media_enriched','quality_improved'],
    default: 'initial'
  },
  changeReason: String,

  // Engagement metrics that triggered this version (null for initial)
  triggerMetrics: {
    avgWatchRatio:   Number,
    avgQuizScore:    Number,
    dropOffSegment:  Number,
    completionRate:  Number
  },

  // Modular knowledge units — content broken into segments
  segments: [{
    order:      Number,
    type:       { type: String, enum: ['concept','example','case_study','quiz','summary'] },
    title:      String,
    content:    String,           // rich text / markdown (base layer)

    // ── Cognitive target for this segment ─────────────────────────────────────
    // Controls which learners this segment is surfaced to by default.
    // renderForLearner() selects the appropriate layer automatically.
    cognitiveTarget: {
      type:    String,
      enum:    ['beginner', 'intermediate', 'advanced', 'expert'],
      default: 'intermediate'
    },

    // ── Multi-depth layers for cognitive adaptation ────────────────────────────
    layers: {
      simplified:   String,   // plain-language explanation with analogies
      visual:       String,   // markdown with embedded diagram/image descriptions
      mathematical: String,   // formal notation, proofs, derivations
      research:     String    // links to literature, edge-case analysis
    },

    // ── Multimedia assets ─────────────────────────────────────────────────────
    // Generated or curated assets that enrich the base text content.
    // Populated by enrichSegmentMedia() via runMultimediaEnricher Claude agent.
    mediaAssets: {
      images: [{
        url:      String,           // hosted image URL
        alt:      String,           // Claude-generated accessible alt text
        caption:  String,
        order:    Number            // render position within segment
      }],
      videoClips: [{
        url:      String,           // clip URL (short ≤ 120 s)
        startSec: Number,
        endSec:   Number,
        label:    String            // e.g. "Demonstration: sorting step"
      }],
      interactiveElements: [{
        elementType: {
          type: String,
          enum: ['quiz', 'drag-drop', 'simulation', 'code-sandbox', 'poll']
        },
        prompt:  String,            // question or instruction text
        config:  Schema.Types.Mixed // element-specific JSON config
      }],
      animationCues: [{
        triggerWord: String,        // keyword in content that triggers the animation
        cueType:     {
          type: String,
          enum: ['highlight', 'zoom', 'transition', 'tooltip']
        },
        target: String              // CSS selector or element ID
      }]
    },

    // ── Quality metrics ───────────────────────────────────────────────────────
    // Populated by checkQuality() via runQualityChecker Claude agent.
    qualityMetrics: {
      grammarScore:  { type: Number, min: 0, max: 100 },  // 0–100
      clarityScore:  { type: Number, min: 0, max: 100 },  // 0–100
      checkedAt:     Date,
      issues: [{
        issueType:  String,         // e.g. 'grammar', 'ambiguity', 'jargon'
        location:   String,         // excerpt of the problematic text
        suggestion: String          // Claude's fix recommendation
      }]
    },

    // ── Research citations ────────────────────────────────────────────────────
    citations: [{
      title:    String,
      authors:  String,
      url:      String,
      summary:  String,             // Claude-generated summary
      addedAt:  Date
    }],

    // ── Change tracking ───────────────────────────────────────────────────────
    changeFlag: {
      type:    String,
      enum:    ['added', 'modified', 'removed', 'unchanged'],
      default: 'unchanged'
    },
    changeSummary: String
  }],

  // ── Version-level quality gate ────────────────────────────────────────────
  // True once ALL segments have grammarScore ≥ 70 and clarityScore ≥ 70.
  qualityApproved: { type: Boolean, default: false },

  // Claude output that generated this version
  agentTaskId: { type: Schema.Types.ObjectId, ref: 'AgentTask' },

  // Was this version better than previous?
  outcome: {
    avgWatchRatioDelta:  Number,
    avgQuizScoreDelta:   Number,
    completionRateDelta: Number,
    evaluatedAt:         Date
  },

  isActive: { type: Boolean, default: true, index: true }

}, { timestamps: true, collection: 'content_versions' });

contentVersionSchema.index({ lectureId: 1, version: -1 });
contentVersionSchema.index({ lectureId: 1, isActive: 1 });

module.exports = mongoose.model('ContentVersion', contentVersionSchema);
