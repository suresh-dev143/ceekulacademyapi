'use strict';

/**
 * Pedagogy Signal Service
 *
 * Analyzes the UCE reference graph to detect content vitality.
 * Vitality = a content node's ability to generate connections:
 *   - High vitality: many inbound/outbound edges, recent engagement
 *   - Dead end: exists in graph but has no outbound edges and few inbound
 *
 * This powers the living pedagogy loop: the curriculum learns from learners.
 * Teachers receive semantic signals, not engagement metrics.
 */

const UceReferenceGraph = require('../models/uceReferenceGraphModel');
const UceContent        = require('../models/uceContentModel');

const VITALITY_WINDOW_DAYS = 30;

/**
 * Compute vitality score for a set of CIDs.
 * Returns an array of { cid, label, outDegree, inDegree, vitality, signal }
 * where vitality is 0–1 and signal is 'thriving' | 'growing' | 'dormant' | 'isolated'
 */
async function computeVitality(cids) {
  if (!cids?.length) return [];

  const since = new Date(Date.now() - VITALITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Count outbound edges per CID
  const outEdges = await UceReferenceGraph.aggregate([
    { $match: { fromCid: { $in: cids }, createdAt: { $gte: since } } },
    { $group: { _id: '$fromCid', count: { $sum: 1 } } },
  ]);
  const outMap = Object.fromEntries(outEdges.map(e => [e._id, e.count]));

  // Count inbound edges per CID
  const inEdges = await UceReferenceGraph.aggregate([
    { $match: { toCid: { $in: cids }, createdAt: { $gte: since } } },
    { $group: { _id: '$toCid', count: { $sum: 1 } } },
  ]);
  const inMap = Object.fromEntries(inEdges.map(e => [e._id, e.count]));

  // Fetch content labels
  const contents = await UceContent.find({ cid: { $in: cids } })
    .select('cid contentType payload')
    .lean();
  const labelMap = Object.fromEntries(
    contents.map(c => [c.cid, c.payload?.context || c.payload?.title || c.contentType])
  );

  const maxOut = Math.max(...Object.values(outMap), 1);
  const maxIn  = Math.max(...Object.values(inMap), 1);

  return cids.map(cid => {
    const out      = outMap[cid] || 0;
    const inn      = inMap[cid]  || 0;
    const vitality = ((out / maxOut) * 0.6 + (inn / maxIn) * 0.4);
    const signal   = out > 2 ? 'thriving' : out > 0 ? 'growing' : inn > 0 ? 'dormant' : 'isolated';
    return { cid, label: labelMap[cid] || cid.slice(0, 12), outDegree: out, inDegree: inn, vitality, signal };
  });
}

/**
 * Find isolated content: nodes with zero outbound edges in recent window.
 * These are dead ends in the knowledge graph — curriculum intervention points.
 */
async function findIsolatedContent(limit = 20) {
  const since = new Date(Date.now() - VITALITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Find CIDs that appear as toCid (someone linked to them) but never as fromCid (they link nowhere)
  const hasSomeIn = await UceReferenceGraph.distinct('toCid', { createdAt: { $gte: since } });
  if (!hasSomeIn.length) return [];

  const hasOut = await UceReferenceGraph.distinct('fromCid', { createdAt: { $gte: since } });
  const hasOutSet = new Set(hasOut);

  const isolated = hasSomeIn.filter(cid => !hasOutSet.has(cid)).slice(0, limit);
  return computeVitality(isolated);
}

module.exports = { computeVitality, findIsolatedContent };
