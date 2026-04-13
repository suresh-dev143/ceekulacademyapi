'use strict';

/**
 * Live Edit Service
 *
 * Responsibilities:
 *  1. Listen to editor:suggestion:internal events from the /editor namespace
 *     → call Claude runLiveEditAssistant
 *     → emit editor:suggestion:ready back to the requesting socket
 *
 *  2. Listen to editor:commit:internal events
 *     → debounce per lectureId (2 s)
 *     → apply the committed segment text to a new ContentVersion
 *
 *  3. Expose helpers for the REST controller
 *     → getEditorSessionInfo(lectureId) — active participants + latest version
 *
 * Initialise once after Socket.io is ready:
 *   const { initLiveEditService } = require('./liveEditService');
 *   initLiveEditService();
 */

const { getEditorNS, editorRooms }   = require('../socket');
const { runLiveEditAssistant }        = require('./claudeService');
const { getActiveVersion }            = require('./contentAdaptationService');
const ContentVersion                  = require('../models/contentVersionModel');
const Lecture                         = require('../models/lectureModel');

// Debounce timers per lectureId — prevents a version explosion on every keystroke
const commitTimers = new Map();
const DEBOUNCE_MS  = 2000;

// ── Initialise ────────────────────────────────────────────────────────────────

function initLiveEditService() {
  const editorNS = getEditorNS();

  // ── AI suggestion pipeline ─────────────────────────────────────────────────
  editorNS.on('editor:suggestion:internal', async (payload) => {
    const {
      requestId, requesterId, lectureId,
      segmentOrder, selectedText, suggestionType
    } = payload;

    try {
      const lecture = await Lecture.findById(lectureId).select('title').lean();
      const version = await getActiveVersion(lectureId);
      const seg     = version?.segments.find(s => s.order === segmentOrder);

      if (!seg) {
        editorNS.to(requesterId).emit('editor:suggestion:error', {
          requestId, error: 'Segment not found'
        });
        return;
      }

      const result = await runLiveEditAssistant({
        userId:          payload.userId ?? null,
        lectureTitle:    lecture?.title ?? 'Unknown',
        segmentTitle:    seg.title,
        segmentContent:  seg.content,
        selectedText,
        suggestionType,
        cognitiveTarget: seg.cognitiveTarget
      });

      editorNS.to(requesterId).emit('editor:suggestion:ready', {
        requestId,
        segmentOrder,
        selectedText,
        ...result
      });

    } catch (err) {
      console.error('[LiveEdit] Suggestion error:', err.message);
      editorNS.to(requesterId).emit('editor:suggestion:error', {
        requestId, error: err.message
      });
    }
  });

  // ── Debounced version commit ───────────────────────────────────────────────
  editorNS.on('editor:commit:internal', (data) => {
    const { lectureId, segmentOrder, newContent, userId } = data;
    const key = `${lectureId}:${segmentOrder}`;

    // Clear any pending save for this segment
    if (commitTimers.has(key)) {
      clearTimeout(commitTimers.get(key));
    }

    // Schedule save after DEBOUNCE_MS of no further changes
    const timer = setTimeout(async () => {
      commitTimers.delete(key);
      try {
        await persistSegmentEdit(lectureId, segmentOrder, newContent, userId);
        console.log(`[LiveEdit] Persisted edit — lecture:${lectureId} segment:${segmentOrder}`);
      } catch (err) {
        console.error('[LiveEdit] Persist error:', err.message);
      }
    }, DEBOUNCE_MS);

    commitTimers.set(key, timer);
  });

  console.log('[LiveEdit] Service initialised');
}

// ── Persist segment edit as a new ContentVersion ─────────────────────────────

async function persistSegmentEdit(lectureId, segmentOrder, newContent, editorId) {
  const current = await getActiveVersion(lectureId);
  if (!current) throw new Error('No active version');

  const newSegments = current.segments.map(seg => {
    const base = seg.toObject?.() ?? { ...seg };
    if (seg.order !== segmentOrder) return { ...base, changeFlag: 'unchanged' };
    return {
      ...base,
      content:       newContent,
      changeFlag:    'modified',
      changeSummary: `Live edit by teacher ${editorId} during session`
    };
  });

  await ContentVersion.findByIdAndUpdate(current._id, { isActive: false });

  return ContentVersion.create({
    lectureId,
    version:      (current.version ?? 1) + 1,
    changeType:   'prompt_refined',
    changeReason: 'Live teacher edit',
    segments:     newSegments,
    isActive:     true
  });
}

// ── REST helper ───────────────────────────────────────────────────────────────

async function getEditorSessionInfo(lectureId) {
  const participants = [...(editorRooms.get(lectureId)?.values() ?? [])];
  const version      = await getActiveVersion(lectureId);

  return {
    lectureId,
    participants,
    activeVersion:  version?.version ?? null,
    segmentCount:   version?.segments?.length ?? 0,
    qualityApproved: version?.qualityApproved ?? false
  };
}

module.exports = { initLiveEditService, getEditorSessionInfo, persistSegmentEdit };
