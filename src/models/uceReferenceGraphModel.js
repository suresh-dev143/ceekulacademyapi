'use strict';

/**
 * UCE Reference Graph — Living Semantic Dependency Graph
 *
 * Tracks directed edges between content CIDs, representing how pieces of
 * semantic content derive from, reference, or transform each other.
 *
 * Edge types (closed vocabulary):
 *   derives_from  — created as a version/edit of another CID (auto-added by UCE version chain)
 *   references    — explicitly cites another CID without being derived from it
 *   summarizes    — a condensed semantic extraction of another CID
 *   extends       — adds meaning to another CID without replacing it
 *   cites         — formal citation (research, academic contexts)
 *
 * Key queries enabled:
 *   "What does this content reference?"         → getOutEdges(cid)
 *   "What content references this?"             → getInEdges(cid)
 *   "If this CID changes, what is affected?"    → getAffectedContent(cid) [BFS inbound]
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const EDGE_TYPES = Object.freeze([
  'derives_from',
  'references',
  'summarizes',
  'extends',
  'cites',
]);

const uceReferenceGraphSchema = new Schema(
  {
    fromCid:  { type: String, required: true },  // the content that references/derives
    toCid:    { type: String, required: true },  // the content being referenced
    edgeType: { type: String, enum: EDGE_TYPES, required: true },
    ownerId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'uce_reference_graph',
  }
);

// Prevent duplicate edges of the same type between the same pair of CIDs
uceReferenceGraphSchema.index({ fromCid: 1, toCid: 1, edgeType: 1 }, { unique: true });

// "What does this content reference?" (outbound traversal)
uceReferenceGraphSchema.index({ fromCid: 1, edgeType: 1 });

// "What references this content?" + impact analysis (inbound traversal)
uceReferenceGraphSchema.index({ toCid: 1, edgeType: 1 });

module.exports = mongoose.model('UceReferenceGraph', uceReferenceGraphSchema);
module.exports.EDGE_TYPES = EDGE_TYPES;
