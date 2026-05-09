'use strict';

/**
 * Session Lifecycle Service
 *
 * Manages the CID-based lifecycle of a live workshop session:
 *
 *   startSession   → issues a 'workshop-session' UCE commit (eventType: 'start')
 *   microCommit    → issues a 'workshop-session' UCE commit (eventType: 'micro') every ~30s
 *   endSession     → issues a 'workshop-session' UCE commit (eventType: 'end'),
 *                    then triggers async AI post-processing
 *   processSessionAsync → runs Haiku summariser, stores result as 'session-summary' UCE commit
 *
 * All commits are marked trusted=true — no AI content moderation for system events.
 * parentCid chains each micro-commit to the previous, forming an immutable audit log.
 */

const { commit }                    = require('./universalCommitService');
const { runSessionPostProcessor }   = require('./claudeService');
const UceContent                    = require('../models/uceContentModel');
const UceVersionRegistry            = require('../models/uceVersionRegistryModel');

// ── startSession ──────────────────────────────────────────────────────────────

async function startSession({ workshopId, scheduleId, title, hostId }) {
  const result = await commit({
    source:      'session_lifecycle',
    contentType: 'workshop-session',
    payload: {
      workshopId,
      scheduleId:       scheduleId || '',
      title,
      startedAt:        new Date().toISOString(),
      elapsedSecs:      0,
      participantCount: 0,
      chatCount:        0,
      eventType:        'start',
    },
    ownerId: hostId,
    trusted: true,
  });

  return { sessionCid: result.cid, version: result.version, logicalId: result.logicalId };
}

// ── microCommit ───────────────────────────────────────────────────────────────

async function microCommit({ sessionCid, logicalId, workshopId, scheduleId, title, startedAt, hostId, participantCount, chatCount, elapsedSecs }) {
  const result = await commit({
    source:      'session_lifecycle',
    contentType: 'workshop-session',
    payload: {
      workshopId,
      scheduleId:  scheduleId || '',
      title,
      startedAt,
      elapsedSecs,
      participantCount,
      chatCount,
      eventType:   'micro',
    },
    ownerId:   hostId,
    parentCid: sessionCid,
    trusted:   true,
  });

  return { cid: result.cid, version: result.version };
}

// ── endSession ────────────────────────────────────────────────────────────────

async function endSession({ sessionCid, workshopId, scheduleId, title, startedAt, hostId, totalSecs, peakParticipants, totalMessages }) {
  const result = await commit({
    source:      'session_lifecycle',
    contentType: 'workshop-session',
    payload: {
      workshopId,
      scheduleId:       scheduleId || '',
      title,
      startedAt,
      elapsedSecs:      totalSecs,
      participantCount: peakParticipants,
      chatCount:        totalMessages,
      eventType:        'end',
    },
    ownerId:   hostId,
    parentCid: sessionCid,
    trusted:   true,
  });

  // Fire-and-forget AI post-processing — never blocks the response
  processSessionAsync(result.cid, title, hostId, totalSecs, peakParticipants, totalMessages)
    .catch(err => console.error('[sessionLifecycle] post-process failed:', err.message));

  return { cid: result.cid, version: result.version };
}

// ── processSessionAsync ───────────────────────────────────────────────────────

async function processSessionAsync(sessionCid, title, hostId, totalSecs, peakParticipants, totalMessages) {
  let aiResult;
  try {
    aiResult = await runSessionPostProcessor({ sessionCid, title, totalSecs, peakParticipants, totalMessages });
  } catch (err) {
    console.error('[sessionLifecycle] AI summariser error:', err.message);
    // Store a minimal summary so callers always get a record
    aiResult = {
      summary:    `Session "${title}" completed. AI summary unavailable.`,
      keyTopics:  [],
      insights:   []
    };
  }

  await commit({
    source:      'session_lifecycle',
    contentType: 'session-summary',
    payload: {
      sessionCid,
      title,
      summary:          aiResult.summary   || '',
      keyTopics:        aiResult.keyTopics  || [],
      insights:         aiResult.insights   || [],
      totalSecs,
      peakParticipants,
      totalMessages,
    },
    ownerId:   hostId,
    parentCid: sessionCid,
    trusted:   true,
  });
}

// ── getSession ────────────────────────────────────────────────────────────────

async function getSession(cid) {
  const content = await UceContent.findOne({ cid }).lean();
  if (!content) return null;

  const registry = await UceVersionRegistry.findOne({ cid }).lean();

  // Look for an associated summary (parentCid = cid, contentType = session-summary)
  const summaryEntry = await UceVersionRegistry.findOne({ parentCid: cid }).lean();
  let summary = null;
  if (summaryEntry) {
    summary = await UceContent.findOne({ cid: summaryEntry.cid, contentType: 'session-summary' }).lean();
  }

  return {
    cid,
    contentType: content.contentType,
    payload:     content.payload,
    status:      content.status,
    version:     registry?.version ?? 1,
    logicalId:   registry?.logicalId ?? null,
    summary:     summary?.payload ?? null,
  };
}

module.exports = { startSession, microCommit, endSession, getSession };
