'use strict';

/**
 * Screen Graph Controller
 *
 * Powers GET /api/screen/graph?context=X&deviceId=Y
 *
 * Returns the immediate reference-graph neighbourhood of the user's current
 * screen layout CID — one hop out (outbound edges) and one hop in (inbound
 * edges). Designed for the Angular reference-graph panel.
 *
 * Response shape:
 * {
 *   status: true,
 *   data: {
 *     centerCid: "abc123",
 *     context:   "academy",
 *     nodes: [{ cid, label, edgeType, direction }],
 *     edges: [{ from, to, type }]
 *   }
 * }
 *
 * Returns { nodes: [], edges: [] } when no screen state exists — never 404.
 */

const UceContent        = require('../models/uceContentModel');
const ScreenState       = require('../models/screenStateModel');
const referenceGraphSvc = require('../services/referenceGraphService');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a short human-readable label for a UceContent doc.
 */
function toLabel(doc) {
  if (!doc) return 'unknown';
  const ctx = doc.payload?.context;
  if (ctx) return ctx;
  return doc.contentType || 'content';
}

// ── Controller ────────────────────────────────────────────────────────────────

exports.graphData = async (req, res) => {
  const userId   = req.user._id;
  const deviceId = req.query.deviceId || null;
  const context  = req.query.context  || 'home';

  // 1. Get current screen state to find centerCid
  let screenState = null;
  if (deviceId) {
    screenState = await ScreenState.findOne(
      { userId, deviceId },
      { currentCid: 1, context: 1 }
    ).lean();
  } else {
    // No deviceId — try to find any active state for this user
    screenState = await ScreenState.findOne(
      { userId },
      { currentCid: 1, context: 1 }
    ).sort({ updatedAt: -1 }).lean();
  }

  const centerCid    = screenState?.currentCid || null;
  const activeContext = screenState?.context   || context;

  // 2. Nothing to graph without a centre node
  if (!centerCid) {
    return res.json({
      status: true,
      data: {
        centerCid:  null,
        context:    activeContext,
        nodes:      [],
        edges:      [],
      },
    });
  }

  // 3. Fetch immediate neighbours (both directions, in parallel)
  const [outEdges, inEdges] = await Promise.all([
    referenceGraphSvc.getOutEdges(centerCid),
    referenceGraphSvc.getInEdges(centerCid),
  ]);

  // 4. Collect all unique neighbour CIDs for bulk content resolution
  const neighbourCids = [
    ...new Set([
      ...outEdges.map(e => e.toCid),
      ...inEdges.map(e => e.fromCid),
    ]),
  ];

  let docByCid = {};
  if (neighbourCids.length > 0) {
    const docs = await UceContent
      .find({ cid: { $in: neighbourCids } }, { cid: 1, contentType: 1, payload: 1 })
      .lean();
    docByCid = Object.fromEntries(docs.map(d => [d.cid, d]));
  }

  // 5. Build nodes and edges arrays
  const nodes = [];
  const edges = [];
  const seenCids = new Set();

  for (const edge of outEdges) {
    const cid = edge.toCid;
    if (!seenCids.has(cid)) {
      seenCids.add(cid);
      nodes.push({
        cid,
        label:     toLabel(docByCid[cid]),
        edgeType:  edge.edgeType,
        direction: 'out',
      });
    }
    edges.push({ from: centerCid, to: cid, type: edge.edgeType });
  }

  for (const edge of inEdges) {
    const cid = edge.fromCid;
    if (!seenCids.has(cid)) {
      seenCids.add(cid);
      nodes.push({
        cid,
        label:     toLabel(docByCid[cid]),
        edgeType:  edge.edgeType,
        direction: 'in',
      });
    }
    edges.push({ from: cid, to: centerCid, type: edge.edgeType });
  }

  return res.json({
    status: true,
    data: {
      centerCid,
      context: activeContext,
      nodes,
      edges,
    },
  });
};
