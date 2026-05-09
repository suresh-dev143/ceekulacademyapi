'use strict';
const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;
const agentTaskSchema = new Schema({
  agentType: {
    type: String,
    enum: ['co_teacher','content_optimizer','ad_generator',
           'innovation_coach','twin_summary','research_mapper','workshop_generator',
           'live_edit_assistant','multimedia_enricher','quality_checker',
           'chat_moderator','chat_summarizer','insight_extractor',
           'micro_hook_generator','cinematic_writer','hypothesis_generator','atom_quality_writer',
           'overlay_summarizer','personalized_explainer',
           'content_validator','content_evaluator',
           'dqrg'],
    required: true,
    index: true
  },
  userId:    { type: Schema.Types.ObjectId, ref: 'User', index: true },
  sessionId: { type: String, index: true },   // groups multi-turn conversation

  // Input
  prompt:    { type: String, required: true },
  context:   { type: Schema.Types.Mixed },

  // Output
  response:  { type: String },
  tokensIn:  { type: Number, default: 0 },
  tokensOut: { type: Number, default: 0 },
  latencyMs: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['pending','running','done','failed'],
    default: 'pending',
    index: true
  },

  // Maps to Neuron wallet deduction for API cost
  costNeurons: { type: Number, default: 0 },

  error: { type: String }   // stores error message on failure

}, { timestamps: true, collection: 'agent_tasks' });

agentTaskSchema.index({ userId: 1, agentType: 1, createdAt: -1 });
agentTaskSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = mongoose.model('AgentTask', agentTaskSchema);
