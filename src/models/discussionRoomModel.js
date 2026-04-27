'use strict';

const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId:   { type: String, required: true },
  userName: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const discussionRoomSchema = new mongoose.Schema({
  type:          { type: String, enum: ['public', 'private', 'group', 'contextual'], required: true },
  title:         { type: String, required: true, maxlength: 120 },
  topic:         { type: String, maxlength: 300 },
  participants:  { type: [participantSchema], default: [] },
  contextId:     { type: String, default: null },
  contextType:   { type: String, enum: ['course', 'workshop', 'research', 'page', null], default: null },
  createdBy:     { userId: String, userName: String },
  isActive:      { type: Boolean, default: true },
  lastMessageAt: { type: Date, default: null },
  messageCount:  { type: Number, default: 0 }
}, { timestamps: true });

discussionRoomSchema.index({ type: 1, isActive: 1, lastMessageAt: -1 });
discussionRoomSchema.index({ contextId: 1, contextType: 1 });

module.exports = mongoose.model('DiscussionRoom', discussionRoomSchema);
