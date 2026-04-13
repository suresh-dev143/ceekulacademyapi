'use strict';

/**
 * Scheduler Service — server-authoritative 50+10 minute cycle engine.
 *
 * Responsibilities:
 *  • Maintain a per-session state machine (CONTENT → ADVERTISEMENT → CONTENT…)
 *  • Fire phase-change events via Socket.io so all clients stay in sync
 *  • Pre-compute the ad slot schedule using matchAdsMultiCriteria() before
 *    the ad phase begins (so there is zero delay at transition time)
 *  • Clean up timers and sessions on explicit end or server shutdown
 *
 * Design decisions:
 *  • Server-side timers are authoritative — the browser clock is display-only
 *  • Sessions are in-memory; a Redis adapter can be added later for multi-node
 *  • Pre-fetch ads 30 s before the ad break to hide any DB latency
 */

const { getIO }              = require('../socket');
const { matchAdsMultiCriteria } = require('./adMatchingService');
const Page                   = require('../models/pageModel');

const CONTENT_MS    = 50 * 60 * 1000;   // 3 000 000 ms  (50 minutes)
const AD_MS         = 10 * 60 * 1000;   //   600 000 ms  (10 minutes)
const PREFETCH_LEAD = 30 * 1000;        //    30 000 ms  (pre-fetch ads this early)

// In-memory session store: sessionId → SessionState
const sessions = new Map();

// Timer handles: `${sessionId}:phase` → NodeJS.Timeout
const timers   = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a new hourly session for a learner on a given page.
 *
 * @param {string} sessionId   - Unique session identifier (generated client-side)
 * @param {string} pageId      - Mongo ObjectId of the linked Page document
 * @param {string} studentId   - Mongo ObjectId of the learner
 * @param {Object} learnerProfile - { engagementScore, behavioralSignals, interests, preferredLanguage }
 */
async function startSession(sessionId, pageId, studentId, learnerProfile = {}) {
  if (sessions.has(sessionId)) return; // idempotent

  // Resolve page context (mandatory + optional criteria) from DB
  const pageContext = await resolvePageContext(pageId, learnerProfile);

  const state = {
    sessionId,
    pageId,
    studentId,
    learnerProfile,
    pageContext,
    phase:          'CONTENT',
    cycleStartMs:   Date.now(),
    currentSlots:   [],
    cycleCount:     0
  };

  sessions.set(sessionId, state);

  // Announce content phase to the client immediately
  emitPhaseChange(state);

  // Arm the timers for this cycle
  armContentTimer(sessionId);

  console.log(`[Scheduler] Session started: ${sessionId} (page: ${pageId})`);
}

/**
 * Return the current state of a session (for REST polling fallback).
 */
function getSessionStatus(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return null;

  const elapsed    = Date.now() - state.cycleStartMs;
  const totalPhaseMs = state.phase === 'CONTENT' ? CONTENT_MS : AD_MS;
  const remainingMs  = Math.max(0, totalPhaseMs - elapsed);

  return {
    sessionId:   state.sessionId,
    phase:       state.phase,
    cycleCount:  state.cycleCount,
    elapsedMs:   elapsed,
    remainingMs,
    adSlots:     state.currentSlots
  };
}

/**
 * Explicitly end a session and release all resources.
 */
function endSession(sessionId) {
  clearSessionTimers(sessionId);
  sessions.delete(sessionId);
  console.log(`[Scheduler] Session ended: ${sessionId}`);
}

/**
 * Called by the advertiser service when ad metadata changes so the next
 * pre-fetch picks up fresh data.
 */
function invalidateSession(sessionId) {
  const state = sessions.get(sessionId);
  if (state) state.currentSlots = [];
}

// ── Internal cycle engine ─────────────────────────────────────────────────────

function armContentTimer(sessionId) {
  // Pre-fetch ads 30 s before content phase ends
  const prefetchTimer = setTimeout(
    () => prefetchAds(sessionId),
    CONTENT_MS - PREFETCH_LEAD
  );
  timers.set(`${sessionId}:prefetch`, prefetchTimer);

  // Transition to ad phase after 50 minutes
  const contentTimer = setTimeout(
    () => transitionToAds(sessionId),
    CONTENT_MS
  );
  timers.set(`${sessionId}:content`, contentTimer);
}

function armAdTimer(sessionId) {
  const adTimer = setTimeout(
    () => transitionToContent(sessionId),
    AD_MS
  );
  timers.set(`${sessionId}:ad`, adTimer);
}

async function prefetchAds(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;

  try {
    const result = await matchAdsMultiCriteria(state.pageContext, state.learnerProfile);
    state.currentSlots = result.slots;
    console.log(`[Scheduler] Pre-fetched ${result.slots.length} ad slots for ${sessionId}`);
  } catch (err) {
    console.error(`[Scheduler] Ad pre-fetch failed for ${sessionId}:`, err.message);
    state.currentSlots = [];
  }
}

async function transitionToAds(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;

  // If pre-fetch didn't run or failed, fetch now (blocks briefly)
  if (!state.currentSlots.length) {
    await prefetchAds(sessionId);
  }

  state.phase        = 'ADVERTISEMENT';
  state.cycleStartMs = Date.now();

  emitPhaseChange(state);
  armAdTimer(sessionId);

  console.log(`[Scheduler] → AD phase: ${sessionId} (${state.currentSlots.length} slots)`);
}

function transitionToContent(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;

  state.phase        = 'CONTENT';
  state.cycleStartMs = Date.now();
  state.currentSlots = [];
  state.cycleCount  += 1;

  emitPhaseChange(state);
  armContentTimer(sessionId);

  console.log(`[Scheduler] → CONTENT phase: ${sessionId} (cycle ${state.cycleCount})`);
}

// ── Socket.io emission ────────────────────────────────────────────────────────

function emitPhaseChange(state) {
  try {
    const io = getIO();
    io.to(`session:${state.sessionId}`).emit('phase:change', {
      phase:        state.phase,
      durationMs:   state.phase === 'CONTENT' ? CONTENT_MS : AD_MS,
      cycleStartsAt: state.cycleStartMs,
      cycleCount:   state.cycleCount,
      adSlots:      state.phase === 'ADVERTISEMENT' ? state.currentSlots : []
    });
  } catch (err) {
    // Socket not yet initialised (e.g. during unit tests) — safe to ignore
    console.warn('[Scheduler] Socket emit skipped:', err.message);
  }
}

// ── Page context resolution ───────────────────────────────────────────────────

async function resolvePageContext(pageId, learnerProfile) {
  if (!pageId) return buildDefaultContext(learnerProfile);

  try {
    const page = await Page.findById(pageId).lean();
    if (!page) return buildDefaultContext(learnerProfile);

    return {
      pageId:            page._id.toString(),
      mandatoryCriteria: page.mandatoryCriteria || {},
      optionalCriteria:  page.optionalCriteria  || {}
    };
  } catch {
    return buildDefaultContext(learnerProfile);
  }
}

function buildDefaultContext(learnerProfile) {
  return {
    pageId:            null,
    mandatoryCriteria: {},
    optionalCriteria:  {
      preferredLanguage: learnerProfile.preferredLanguage
    }
  };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function clearSessionTimers(sessionId) {
  for (const suffix of ['prefetch', 'content', 'ad']) {
    const key = `${sessionId}:${suffix}`;
    const t   = timers.get(key);
    if (t) { clearTimeout(t); timers.delete(key); }
  }
}

// On process shutdown, clear all timers
process.on('SIGTERM', () => sessions.forEach((_, id) => clearSessionTimers(id)));
process.on('SIGINT',  () => sessions.forEach((_, id) => clearSessionTimers(id)));

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  startSession,
  getSessionStatus,
  endSession,
  invalidateSession
};
