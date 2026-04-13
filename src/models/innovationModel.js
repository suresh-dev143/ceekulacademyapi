'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

const STAGES = ['idea','validation','research','simulation','prototype','deployed'];

const innovationSchema = new Schema({
  title:       { type: String, required: true, trim: true, maxlength: 300 },
  description: { type: String, required: true, maxlength: 5000 },
  submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  stage: { type: String, enum: STAGES, default: 'idea', index: true },

  // Stage history — append-only log
  stageHistory: [{
    stage:        { type: String, enum: STAGES },
    enteredAt:    Date,
    exitedAt:     Date,
    notes:        String,
    agentOutput:  String    // JSON string of Claude coaching output
  }],

  // Collaborators
  teamMembers: [{ type: Schema.Types.ObjectId, ref: 'User' }],

  // Claude validation results
  validation: {
    feasibility:   { type: Number, min: 0, max: 10 },
    novelty:       { type: Number, min: 0, max: 10 },
    impact:        { type: Number, min: 0, max: 10 },
    risks:         [String],
    suggestions:   [String],
    validatedBy:   { type: String, default: 'claude-opus-4-6' },
    validatedAt:   Date
  },

  // Artifacts produced at each stage
  artifacts: [{
    type:    { type: String, enum: ['research','simulation','prototype','demo','paper'] },
    url:     String,
    title:   String,
    notes:   String,
    addedAt: Date
  }],

  tags:     [{ type: String, lowercase: true, trim: true }],
  isPublic: { type: Boolean, default: false, index: true },

  // Aggregated engagement
  upvotes:    { type: Number, default: 0 },
  viewCount:  { type: Number, default: 0 }

}, { timestamps: true, collection: 'innovations' });

innovationSchema.index({ submittedBy: 1, stage: 1 });
innovationSchema.index({ isPublic: 1, stage: 1, createdAt: -1 });
innovationSchema.index({ tags: 1 });

module.exports = mongoose.model('Innovation', innovationSchema);
