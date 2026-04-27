'use strict';

const mongoose = require('mongoose');

const discussionMessageSchema = new mongoose.Schema({
  roomId:      { type: mongoose.Schema.Types.ObjectId, ref: 'DiscussionRoom', required: true, index: true },
  senderId:    { type: String, required: true },
  senderName:  { type: String, required: true },
  senderRole:  { type: String, default: 'member' },
  messageType: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
  content:     { type: String, required: true, maxlength: 2000 },
  replyTo:     { type: mongoose.Schema.Types.ObjectId, ref: 'DiscussionMessage', default: null },
  status:      { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' }
}, { timestamps: true });

discussionMessageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model('DiscussionMessage', discussionMessageSchema);
