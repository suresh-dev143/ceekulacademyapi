'use strict';

const mongoose = require('mongoose');

const moderationSchema = new mongoose.Schema({
  status:      { type: String, enum: ['pending', 'approved', 'flagged', 'blocked'], default: 'pending' },
  score:       { type: Number, min: 0, max: 1, default: 0 },
  flags:       [String],
  reason:      String,
  moderatedAt: Date
}, { _id: false });

const chatMessageSchema = new mongoose.Schema({
  lectureId:   { type: String, required: true, index: true },
  sessionId:   String,
  authorId:    { type: String, required: true },
  authorName:  { type: String, required: true },
  role:        { type: String, enum: ['teacher', 'student', 'guest'], default: 'student' },
  content:     { type: String, required: true, maxlength: 1000 },
  moderation:  { type: moderationSchema, default: () => ({}) },
  isQuestion:  { type: Boolean, default: false },
  replyTo:     { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  sentiment:   { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
  keywords:    [String]
}, { timestamps: true });

chatMessageSchema.index({ lectureId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
