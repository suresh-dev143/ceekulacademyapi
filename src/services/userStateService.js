'use strict';

/**
 * UserState Service — real-time cognitive state tracking + scoring.
 *
 * Core algorithms:
 *   computeAttention(signals)          → 0–100
 *   computeCognitiveLoad(signals)      → 0–100
 *   computeMotivation(signals, prev)   → 0–100  (exponential smoothing)
 *   computeResearchOri(signals, prev)  → 0–100
 *   computeProgressionTier(state)      → tier string
 *   updateState(userId, sessionId, signals) → { state, modeChange }
 */

const UserState = require('../models/userStateModel');

const clamp   = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const smooth  = (prev, next, alpha)    => alpha * next + (1 - alpha) * prev;

// ── Scoring ────────────────────────────────────────────────────────────────────

/**
 * Attention (0–100).
 * Weights: interaction rate, dwell time, trigger response speed, scroll depth.
 */
function computeAttention(signals) {
  const { interactionRate, scrollDepth, dwellTime, responseTime } = signals;
  let score = 50;

  // Interaction rate: 1–5/min = optimal
  if (interactionRate >= 1 && interactionRate <= 5)       score += 20;
  else if (interactionRate > 5 && interactionRate <= 10)  score += 10;
  else if (interactionRate > 10)                          score += 3;   // frantic
  else if (interactionRate < 0.5)                         score -= 18;  // passive

  // Dwell time: 15–90 s = engaged reading
  if (dwellTime >= 15 && dwellTime <= 90)       score += 15;
  else if (dwellTime > 90 && dwellTime <= 180)  score += 7;
  else if (dwellTime < 8)                        score -= 20;  // bouncing

  // Response time to trigger (0 = no trigger shown)
  if (responseTime > 0) {
    if (responseTime < 2000)        score += 15;
    else if (responseTime < 5000)   score += 5;
    else                            score -= 8;
  }

  // Scroll depth
  if (scrollDepth > 70)        score += 10;
  else if (scrollDepth > 40)   score += 5;
  else if (scrollDepth < 10)   score -= 10;

  return clamp(Math.round(score));
}

/**
 * Cognitive Load (0–100).
 * Optimal range: 40–65. Below → under-stimulated. Above → overwhelmed.
 */
function computeCognitiveLoad(signals) {
  const { interactionRate, dwellTime, questionCount, errorCount } = signals;
  let score = 40;

  // Errors indicate struggle (high load)
  score += clamp(errorCount * 5, 0, 30);

  // Very fast completion → underloaded
  if (dwellTime < 10)       score -= 20;
  else if (dwellTime < 20)  score -= 10;

  // Many questions → possible confusion
  if (questionCount > 3)   score += Math.min(questionCount * 2, 20);

  // High interaction → active processing
  if (interactionRate > 8)  score += 12;

  return clamp(Math.round(score));
}

/**
 * Motivation (0–100) with exponential smoothing (α = 0.3).
 * passive: 0–33 | curious: 34–66 | engaged: 67–100
 */
function computeMotivation(signals, prevMotivation) {
  const { interactionRate, questionCount, simulationAttempts, contentCompletions } = signals;
  let delta = 0;

  if (contentCompletions > 0)    delta += 10 * contentCompletions;
  if (simulationAttempts > 0)    delta +=  6 * simulationAttempts;
  if (questionCount > 0)         delta +=  4 * questionCount;
  if (interactionRate >= 0.5)    delta +=  5;
  if (interactionRate < 0.3)     delta -= 12;  // disengaged

  const target = clamp(prevMotivation + delta);
  return clamp(Math.round(smooth(prevMotivation, target, 0.3)));
}

/**
 * Research orientation (0–100) with slow smoothing (α = 0.15).
 * learning: 0–33 | exploration: 34–66 | innovation: 67–100
 */
function computeResearchOrientation(signals, prevOrientation, currentMode) {
  const { questionCount, contentCompletions } = signals;
  let delta = 0;

  if (questionCount > 2)         delta += 8 * (questionCount - 2);
  if (currentMode === 'research') delta += 10;
  if (contentCompletions > 2)    delta +=  5;

  const target = clamp(prevOrientation + delta);
  return clamp(Math.round(smooth(prevOrientation, target, 0.15)));
}

/**
 * Proficiency update (increases with completions, decays slightly if idle).
 */
function updateProficiency(signals, prevProficiency) {
  const { contentCompletions, simulationAttempts, errorCount } = signals;
  let delta = 0;

  delta += contentCompletions * 3;
  delta += simulationAttempts * 1;
  delta -= Math.min(errorCount, 3);   // errors can show gaps in knowledge

  return clamp(Math.round(prevProficiency + delta));
}

/**
 * Progression tier from composite state.
 */
function computeProgressionTier(state) {
  const { motivation, researchOrientation } = state;

  if (motivation > 60 && researchOrientation > 50) return 'research-focused';
  if (motivation > 50 && state.proficiency > 20)    return 'interactive';
  if (motivation > 33)                               return 'curious';
  return 'passive';
}

// ── State update ───────────────────────────────────────────────────────────────

/**
 * Merge incoming signals and recompute full cognitive state.
 * Returns the updated UserState document.
 */
async function updateState(userId, sessionId, incomingSignals, topicId) {
  let doc = await UserState.findOne({ userId, sessionId });

  if (!doc) {
    doc = await UserState.create({ userId, sessionId, topicId });
  }

  // Merge signals (accumulate questionCount, completions, attempts; replace rates)
  const sig = doc.signals.toObject ? doc.signals.toObject() : { ...doc.signals };
  const merged = {
    interactionRate:    incomingSignals.interactionRate    ?? sig.interactionRate,
    scrollDepth:        incomingSignals.scrollDepth        ?? sig.scrollDepth,
    dwellTime:          incomingSignals.dwellTime          ?? sig.dwellTime,
    responseTime:       incomingSignals.responseTime       ?? sig.responseTime,
    questionCount:      (sig.questionCount      || 0) + (incomingSignals.questionCountDelta      || 0),
    simulationAttempts: (sig.simulationAttempts || 0) + (incomingSignals.simulationAttemptsDelta || 0),
    contentCompletions: (sig.contentCompletions || 0) + (incomingSignals.contentCompletionsDelta || 0),
    errorCount:         (sig.errorCount         || 0) + (incomingSignals.errorCountDelta         || 0),
    keystrokes:         incomingSignals.keystrokes ?? sig.keystrokes
  };

  const prev = doc.state.toObject ? doc.state.toObject() : { ...doc.state };

  const attention           = computeAttention(merged);
  const cognitiveLoad       = computeCognitiveLoad(merged);
  const motivation          = computeMotivation(merged, prev.motivation);
  const researchOrientation = computeResearchOrientation(merged, prev.researchOrientation, doc.currentMode);
  const proficiency         = updateProficiency(merged, prev.proficiency);

  const newState = { attention, cognitiveLoad, motivation, researchOrientation, proficiency };
  const tier     = computeProgressionTier(newState);

  // Append attention snapshot (keep last 50)
  const snapshot = { ts: new Date(), attention, mode: doc.currentMode, trigger: incomingSignals.trigger || null };
  const history  = [...(doc.attentionHistory || []).slice(-49), snapshot];

  await UserState.findByIdAndUpdate(doc._id, {
    signals:          merged,
    state:            newState,
    attentionHistory: history,
    progressionTier:  tier,
    lastActive:       new Date(),
    ...(topicId && { topicId })
  });

  doc = await UserState.findById(doc._id).lean();
  return doc;
}

/**
 * Record a mode change, updating modeHistory with duration of previous mode.
 */
async function recordModeChange(userId, sessionId, newMode) {
  const doc = await UserState.findOne({ userId, sessionId });
  if (!doc) return null;

  const now          = new Date();
  const prevMode     = doc.currentMode;
  const prevStart    = doc.modeStartedAt || now;
  const durationSec  = Math.round((now - prevStart) / 1000);

  const entry = { mode: prevMode, startedAt: prevStart, endedAt: now, durationSec };

  await UserState.findByIdAndUpdate(doc._id, {
    currentMode:    newMode,
    modeStartedAt:  now,
    $push: { modeHistory: { $each: [entry], $slice: -100 } }
  });

  return await UserState.findById(doc._id).lean();
}

/**
 * Fetch current state snapshot.
 */
async function getState(userId, sessionId) {
  return UserState.findOne({ userId, sessionId }).lean();
}

/**
 * Reset signals for a new signal window (called every sampling interval).
 */
async function resetWindowSignals(userId, sessionId) {
  return UserState.findOneAndUpdate(
    { userId, sessionId },
    {
      'signals.questionCountDelta':      0,
      'signals.simulationAttemptsDelta': 0,
      'signals.contentCompletionsDelta': 0,
      'signals.errorCountDelta':         0
    }
  );
}

module.exports = {
  updateState,
  recordModeChange,
  getState,
  resetWindowSignals,
  // expose scoring functions for testing
  computeAttention,
  computeCognitiveLoad,
  computeMotivation,
  computeResearchOrientation,
  computeProgressionTier
};
