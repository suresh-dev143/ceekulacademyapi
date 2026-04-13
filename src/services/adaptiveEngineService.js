'use strict';

/**
 * Adaptive Experience Engine — mode switching decision logic.
 *
 * Mode priority (highest to lowest):
 *   TRIGGER     → attention critically low OR motivation below threshold
 *   XR          → peak engagement + high proficiency + high attention
 *   RESEARCH    → high research orientation + good motivation + proficiency
 *   SIMULATION  → good attention + moderate-high motivation + proficiency ≥ 20
 *   CINEMATIC   → moderate engagement or high cognitive load (passive input)
 *   IDLE        → session not started
 *
 * Transition rules:
 *   - Minimum dwell time in current mode before switching (except critical trigger).
 *   - Smooth transition payloads include animation hints.
 */

const userStateService = require('./userStateService');

// Minimum seconds to stay in each mode before switching
const MIN_MODE_DWELL = {
  idle:       0,
  trigger:    5,
  cinematic:  30,
  simulation: 45,
  research:   60,
  xr:         60
};

// ── Decision engine ────────────────────────────────────────────────────────────

/**
 * Given a UserState document, compute the optimal mode.
 * Returns { mode, reason, transition } or null if no change needed.
 */
function decideMode(userStateDoc) {
  const { state, currentMode, modeStartedAt } = userStateDoc;
  const {
    attention, cognitiveLoad, motivation,
    researchOrientation, proficiency
  } = state;

  const secInMode = modeStartedAt
    ? Math.round((Date.now() - new Date(modeStartedAt).getTime()) / 1000)
    : 9999;

  const minDwell = MIN_MODE_DWELL[currentMode] || 0;

  // ── CRITICAL TRIGGER: override any mode ───────────────────────────────────
  const criticallyLowAttention = attention < 20;
  const noticeablyDisengaged   = attention < 35 && motivation < 30;

  if (criticallyLowAttention || noticeablyDisengaged) {
    if (currentMode === 'trigger') return null;  // already in trigger
    return { mode: 'trigger', reason: 'attention_critical', transition: 'flash' };
  }

  // ── Below minimum dwell: stay in current mode ─────────────────────────────
  if (secInMode < minDwell && currentMode !== 'idle') {
    return null;
  }

  // ── XR: peak engagement ───────────────────────────────────────────────────
  if (motivation >= 75 && proficiency >= 60 && attention >= 70 && cognitiveLoad <= 65) {
    if (currentMode !== 'xr') {
      return { mode: 'xr', reason: 'peak_engagement', transition: 'zoom' };
    }
    return null;
  }

  // ── RESEARCH: high orientation ────────────────────────────────────────────
  if (researchOrientation >= 55 && motivation >= 55 && proficiency >= 35) {
    if (currentMode !== 'research') {
      return { mode: 'research', reason: 'research_orientation_high', transition: 'slide' };
    }
    return null;
  }

  // ── SIMULATION: active engagement ─────────────────────────────────────────
  if (attention >= 50 && motivation >= 45 && proficiency >= 20 && cognitiveLoad <= 72) {
    if (!['simulation', 'xr'].includes(currentMode)) {
      return { mode: 'simulation', reason: 'engagement_sufficient', transition: 'fade' };
    }
    return null;
  }

  // ── TRIGGER: low attention (not critical) ─────────────────────────────────
  if (attention < 40 && motivation < 45) {
    if (currentMode !== 'trigger') {
      return { mode: 'trigger', reason: 'attention_low', transition: 'pulse' };
    }
    return null;
  }

  // ── CINEMATIC: default for moderate engagement or high load ───────────────
  if (cognitiveLoad > 70 || (attention >= 35 && motivation < 55)) {
    if (!['cinematic', 'trigger'].includes(currentMode)) {
      return { mode: 'cinematic', reason: 'moderate_engagement', transition: 'dissolve' };
    }
    return null;
  }

  // ── CINEMATIC: starting from idle ─────────────────────────────────────────
  if (currentMode === 'idle') {
    return { mode: 'cinematic', reason: 'session_start', transition: 'fade' };
  }

  return null;  // no change
}

/**
 * Full update cycle:
 *   1. Merge incoming signals → new state
 *   2. Decide optimal mode
 *   3. If mode changes, record it
 *   4. Return { state, modeDecision }
 */
async function processSignals(userId, sessionId, incomingSignals, topicId) {
  // Step 1: compute new state
  const updated = await userStateService.updateState(userId, sessionId, incomingSignals, topicId);

  // Step 2: decide mode
  const modeDecision = decideMode(updated);

  // Step 3: record mode change if needed
  let finalState = updated;
  if (modeDecision) {
    finalState = await userStateService.recordModeChange(userId, sessionId, modeDecision.mode);
  }

  return { state: finalState, modeDecision };
}

/**
 * Force a manual mode change (teacher override or user preference).
 */
async function forceMode(userId, sessionId, mode) {
  const VALID = ['trigger', 'cinematic', 'simulation', 'research', 'xr', 'idle'];
  if (!VALID.includes(mode)) throw new Error(`Invalid mode: ${mode}`);

  const updated = await userStateService.recordModeChange(userId, sessionId, mode);
  return { state: updated, modeDecision: { mode, reason: 'manual_override', transition: 'fade' } };
}

/**
 * Compute animation profile based on state for frontend rendering hints.
 */
function computeAnimationProfile(state) {
  const { attention, motivation, cognitiveLoad } = state;

  // Low attention → minimal, non-distracting animations
  if (attention < 30) {
    return { intensity: 'minimal', particleCount: 0, transitionSpeed: 'slow', haptics: false };
  }
  // Moderate → standard
  if (attention < 60 || motivation < 50) {
    return { intensity: 'standard', particleCount: 15, transitionSpeed: 'medium', haptics: false };
  }
  // Engaged → cinematic
  if (motivation >= 50 && cognitiveLoad < 70) {
    return { intensity: 'cinematic', particleCount: 40, transitionSpeed: 'fast', haptics: true };
  }
  // Peak → immersive
  return { intensity: 'immersive', particleCount: 80, transitionSpeed: 'instant', haptics: true };
}

module.exports = {
  decideMode,
  processSignals,
  forceMode,
  computeAnimationProfile
};
