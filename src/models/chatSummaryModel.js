'use strict';

const mongoose = require('mongoose');

const chatSummarySchema = new mongoose.Schema({
  lectureId:       { type: String, required: true, index: true },
  sessionId:       String,
  messageCount:    { type: Number, default: 0 },
  summary:         String,
  keyQuestions:    [String],
  themes:          [String],
  insights:        [String],
  confusionPoints: [String],
  engagementLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  recommendedActions: [String],
  questionCount:   Number,
  participationRate: Number,
  generatedAt:     { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ChatSummary', chatSummarySchema);
