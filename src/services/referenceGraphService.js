'use strict';

/**
 * Reference Graph Service
 *
 * Manages the directed semantic dependency graph between UCE content CIDs.
 *
 * Public API:
 *   addEdge({ fromCid, toCid, edgeType, ownerId, metadata })
 *   getOutEdges(cid, edgeType?)     → edges where fromCid = cid
 *   getInEdges(cid, edgeType?)      → edges where toCid = cid
 *   getAffectedContent(cid, depth?) → BFS inbound: all CIDs that depend on cid
 */

const UceReferenceGraph        = require('../models/uceReferenceGraphModel');
const { EDGE_TYPES }           = require('../models/uceReferenceGraphModel');

const DEFAULT_MAX_DEPTH = 3;
const BFS_BATCH_LIMIT   = 200; // max edges fetched per BFS level

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a directed edge between two CIDs.
 * Idempotent — duplicate (fromCid, toCid, edgeType) triples are silently ignored.
 */
async function addEdge({ fromCid, toCid, edgeType, ownerId, metadata = {} }) {
  if (!EDGE_TYPES.includes(edgeType)) {
    throw Object.assign(
      new Error(`Invalid edgeType "${edgeType}". Valid: ${EDGE_TYPES.join(', ')}`),
      { status: 400 }
    );
  }
  if (!fromCid || !toCid) {
    throw Object.assign(new Error('fromCid and toCid are required'), { status: 400 });
  }
  if (fromCid === toCid) {
    throw Object.assign(new Error('Self-referencing edges are not allowed'), { status: 400 });
  }

  try {
    return await UceReferenceGraph.create({ fromCid, toCid, edgeType, ownerId, metadata });
  } catch (err) {
    if (err.code === 11000) return null; // duplicate — idempotent
    throw err;
  }
}

/**
 * Outbound edges: what content does `cid` reference or derive from?
 *
 * @param {string}  cid
 * @param {string} [edgeType]  — filter to a specific edge type
 * @returns {Promise<object[]>}
 */
async function getOutEdges(cid, edgeType = null) {
  const q = { fromCid: cid };
  if (edgeType) q.edgeType = edgeType;
  return UceReferenceGraph.find(q).sort({ createdAt: -1 }).lean();
}

/**
 * Inbound edges: what content references or derives from `cid`?
 *
 * @param {string}  cid
 * @param {string} [edgeType]
 * @returns {Promise<object[]>}
 */
async function getInEdges(cid, edgeType = null) {
  const q = { toCid: cid };
  if (edgeType) q.edgeType = edgeType;
  return UceReferenceGraph.find(q).sort({ createdAt: -1 }).lean();
}

/**
 * BFS impact analysis: starting from `cid`, traverse all inbound edges to
 * discover every piece of content that directly or transitively depends on it.
 *
 * Use case: "If this lecture CID changes, which session summaries, research
 * items, and derived content are affected?"
 *
 * @param {string} cid        — the CID whose dependents you want to find
 * @param {number} [maxDepth] — how many hops to traverse (default 3)
 * @returns {Promise<Array<{ cid, depth, edgeType, via }>>}
 */
async function getAffectedContent(cid, maxDepth = DEFAULT_MAX_DEPTH) {
  const visited  = new Set([cid]);
  const affected = [];
  let   frontier = [cid];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const edges = await UceReferenceGraph
      .find({ toCid: { $in: frontier } })
      .limit(BFS_BATCH_LIMIT)
      .lean();

    frontier = [];

    for (const edge of edges) {
      if (!visited.has(edge.fromCid)) {
        visited.add(edge.fromCid);
        frontier.push(edge.fromCid);
        affected.push({
          cid:      edge.fromCid,
          depth,
          edgeType: edge.edgeType,
          via:      edge.toCid,
        });
      }
    }
  }

  return affected;
}

module.exports = { addEdge, getOutEdges, getInEdges, getAffectedContent, EDGE_TYPES };
