'use strict';

/**
 * Screen Canvas Controller
 *
 * Powers GET /api/screen/canvas-content?context=X&deviceId=Y&limit=N
 *
 * Returns two sections of UCE content for the Flutter SemanticCanvas:
 *   - "Recent Activity"   — last N UceContent docs for this user in this context
 *   - "Connected Content" — content reachable from the current layout CID via the
 *                           reference graph (outbound edges only)
 *
 * Always returns 200 with empty sections when data is sparse — the Flutter
 * canvas falls back to stub widgets gracefully.
 */

const UceContent        = require('../models/uceContentModel');
const ScreenState       = require('../models/screenStateModel');
const referenceGraphSvc = require('../services/referenceGraphService');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a human-readable title from a UceContent doc.
 * Priority: payload.context > payload.instructionType > contentType
 */
function buildTitle(doc) {
  const ctx = doc.payload?.context;
  if (ctx) return `Layout: ${ctx}`;

  const instrType = doc.payload?.instructionType;
  if (instrType) {
    // e.g. 'navigate_to' → 'Navigate To'
    return instrType
      .split(/[_-]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // Fall back to contentType
  return doc.contentType
    .split(/[_-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Map a single UceContent lean document to a canvas item shape.
 */
function mapToItem(doc) {
  const payload = doc.payload || {};

  const summary =
    Array.isArray(payload.keywords) && payload.keywords.length
      ? payload.keywords.join(', ')
      : (typeof payload.body === 'string' ? payload.body.slice(0, 120) : null) ||
        (typeof payload.subtitle === 'string' ? payload.subtitle.slice(0, 120) : null) ||
        doc.contentType;

  // intensity: 0.5 baseline, scales up with version depth (capped at 10 versions)
  const version   = doc.version ?? 1;
  const intensity = 0.5 + (0.5 * Math.min(version, 10) / 10);

  return {
    id:                doc._id.toString(),
    title:             buildTitle(doc),
    summary,
    tags:              [doc.contentType, doc.source].filter(Boolean),
    intensity:         Math.round(intensity * 100) / 100,
    navigationContext: payload.context || null,
    cid:               doc.cid,
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

exports.canvasContent = async (req, res) => {
  const userId   = req.user._id;
  const context  = req.query.context  || 'home';
  const deviceId = req.query.deviceId || null;
  const limit    = Math.min(parseInt(req.query.limit) || 20, 50);

  try {
    // 1. Get current screen state (best-effort — may not exist)
    let screenState = null;
    if (deviceId) {
      screenState = await ScreenState.findOne(
        { userId, deviceId },
        { currentCid: 1 }
      ).lean();
    }

    const currentCid = screenState?.currentCid || null;

    // 2. Query recent UceContent for this user in this context
    //    Try matching on payload.context; also include docs where keywords
    //    contain the context string.
    const recentDocs = await UceContent
      .find({
        ownerId: userId,
        $or: [
          { 'payload.context': context },
          { 'payload.keywords': context },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // 3. Get outbound reference-graph edges from the current layout CID
    let graphItems = [];
    if (currentCid) {
      const outEdges = await referenceGraphSvc.getOutEdges(currentCid);

      if (outEdges.length > 0) {
        // 4. Resolve up to 10 target CIDs from UceContent
        const targetCids = [...new Set(outEdges.map(e => e.toCid))].slice(0, 10);

        const resolvedDocs = await UceContent
          .find({ cid: { $in: targetCids } })
          .lean();

        // Preserve edge ordering; annotate each item with its edgeType
        const docByCid = Object.fromEntries(resolvedDocs.map(d => [d.cid, d]));
        const seen     = new Set();

        for (const edge of outEdges) {
          if (seen.has(edge.toCid)) continue;
          seen.add(edge.toCid);

          const doc = docByCid[edge.toCid];
          if (doc) {
            const item = mapToItem(doc);
            item.edgeType = edge.edgeType; // extra field useful for Flutter rendering hints
            graphItems.push(item);
          }
        }
      }
    }

    // 5. Build response sections
    const sections = [];

    sections.push({
      title:      'Recent Activity',
      sectionKey: 'recent',
      items:      recentDocs.map(mapToItem),
    });

    if (graphItems.length > 0) {
      sections.push({
        title:      'Connected Content',
        sectionKey: 'graph',
        items:      graphItems,
      });
    }

    return res.json({
      status: true,
      data: {
        context,
        currentCid,
        sections,
      },
    });
  } catch (err) {
    // Degrade gracefully — never 500 the canvas
    console.error('[screenCanvasController] canvasContent error:', err);
    return res.json({
      status: true,
      data: {
        context,
        currentCid: null,
        sections:   [],
        _error:     'content unavailable',
      },
    });
  }
};
