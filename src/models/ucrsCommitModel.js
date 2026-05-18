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
  reference: {
    refType: { type: String, required: true },  // e.g. 'cid', 'logicalId', 'sessionRef', 'userId'
    value:   { type: String, required: true },
    _id:     false,
  },
  // Direct pointer to the UCE content CID this interaction wraps.
  // Null when the commit is a pure session event (join, leave, ping) with no
  // associated UCE content. When set, enables: "what exact content existed at
  // the time of this interaction?" and full semantic state reconstruction.
  contentCid:   { type: String, default: null, index: true },
  metadata:     { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// Reference graph queries: "find all commits pointing to this CID" or "find all commits of refType X"
ucrsCommitSchema.index({ 'reference.value': 1, 'reference.refType': 1 });
ucrsCommitSchema.index({ 'reference.refType': 1, sessionRef: 1 });

// Bridge query: "all UCRS interactions that wrapped this UCE content CID"
ucrsCommitSchema.index({ contentCid: 1, createdAt: -1 });

module.exports = mongoose.model('UCRSCommit', ucrsCommitSchema);
