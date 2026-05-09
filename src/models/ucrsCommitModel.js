'use strict';

const mongoose = require('mongoose');

const ucrsCommitSchema = new mongoose.Schema({
  commitId:     { type: String, required: true, unique: true, index: true },
  type:         { type: String, required: true },
  sessionRef:   { type: String, required: true, index: true },
  speakerId:    { type: String, required: true },
  speakerName:  { type: String, required: true },
  content:      { type: String, default: '' },
  semanticTags: [String],
  parentCommit: { type: String, default: null },
  reference:    { type: String, required: true },
  metadata:     { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('UCRSCommit', ucrsCommitSchema);
