'use strict';

/**
 * Engagement Service — progression system + reinforcement mechanisms.
 *
 * Progression: passive → curious → interactive → research-focused
 *
 * Reinforcement loops:
 *   - Trigger response → curiosity reward
 *   - Simulation completion → mastery reward
 *   - Research question generated → exploration reward
 *   - Streak maintenance → consistency reward
 */

const UserState = require('../models/userStateModel');

const TIERS = ['passive', 'curious', 'interactive', 'research-focused'];

// Reward deltas applied to motivation and researchOrientation
const REWARDS = {
  trigger_responded:        { motivation: +8,  researchOri: +2  },
  cinematic_completed:      { motivation: +6,  researchOri: +3  },
  simulation_passed:        { motivation: +15, researchOri: +5  },
  simulation_failed:        { motivation: +3,  researchOri: +1  },  // effort reward
  research_question_asked:  { motivation: +5,  researchOri: +12 },
  xr_scene_explored:        { motivation: +10, researchOri: +8  },
  session_streak:           { motivation: +5,  researchOri: +2  },
  atom_bookmarked:          { motivation: +3,  researchOri: +5  }
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

// ── Reward ────────────────────────────────────────────────────────────────────

/**
 * Apply a named reward event to a user's cognitive state.
 * Returns { newState, tierChanged, newTier }.
 */
async function applyReward(userId, sessionId, rewardType) {
  const reward = REWARDS[rewardType];
  if (!reward) throw new Error(`Unknown reward: ${rewardType}`);

  const doc = await UserState.findOne({ userId, sessionId });
  if (!doc) throw new Error(`UserState not found for ${userId}/${sessionId}`);

  const prevTier = doc.progressionTier;
  const s        = doc.state;

  const newMotivation  = clamp(s.motivation          + reward.motivation);
  const newResearchOri = clamp(s.researchOrientation + reward.researchOri);

  // Recompute tier
  const newTier = computeTier({ ...s.toObject(), motivation: newMotivation, researchOrientation: newResearchOri });

  await UserState.findByIdAndUpdate(doc._id, {
    'state.motivation':          newMotivation,
    'state.researchOrientation': newResearchOri,
    progressionTier:             newTier,
    ...(rewardType === 'trigger_responded' && {
      $inc: { triggerResponseCount: 1 }
    }),
    ...(rewardType === 'cinematic_completed' && {
      $inc: { consecutiveCompletions: 1 }
    })
  });

  return {
    rewardType,
    motivationDelta:  reward.motivation,
    researchOriDelta: reward.researchOri,
    newMotivation,
    newResearchOri,
    newTier,
    tierChanged:      newTier !== prevTier,
    prevTier
  };
}

// ── Progression ───────────────────────────────────────────────────────────────

function computeTier(state) {
  const { motivation, researchOrientation, proficiency } = state;

  if (motivation > 60 && researchOrientation > 50) return 'research-focused';
  if (motivation > 50 && (proficiency || 0) > 20)  return 'interactive';
  if (motivation > 33)                              return 'curious';
  return 'passive';
}

/**
 * Get the next unlock hint for the user (motivational nudge).
 */
function getProgressionHint(currentTier, state) {
  const { motivation, researchOrientation } = state;

  switch (currentTier) {
    case 'passive':
      return {
        hint: 'Engage with any content to unlock Curious mode — ask a question or complete a section.',
        nextTier: 'curious',
        progressPct: Math.round((motivation / 33) * 100)
      };
    case 'curious':
      return {
        hint: 'Try the interactive simulation to unlock deeper learning modes.',
        nextTier: 'interactive',
        progressPct: Math.round(((motivation - 33) / 17) * 100)
      };
    case 'interactive':
      return {
        hint: 'Ask a research question or explore the Research tab to reach Research-Focused mode.',
        nextTier: 'research-focused',
        progressPct: Math.round((researchOrientation / 50) * 100)
      };
    case 'research-focused':
      return {
        hint: 'You are in Research-Focused mode. Keep exploring hypotheses and new directions.',
        nextTier: null,
        progressPct: 100
      };
    default:
      return null;
  }
}

// ── Streak tracking ───────────────────────────────────────────────────────────

/**
 * Called once per session start. Increments streak if within 26 hours.
 */
async function updateStreak(userId) {
  // Find any state for this user from previous sessions
  const latest = await UserState.findOne({ userId })
    .sort({ lastActive: -1 })
    .lean();

  if (!latest) return { streakDays: 1, streakBroken: false };

  const hoursSinceLast = (Date.now() - new Date(latest.lastActive).getTime()) / (1000 * 3600);
  const streakBroken   = hoursSinceLast > 26;
  const newStreak      = streakBroken ? 1 : (latest.streakDays || 0) + 1;

  await UserState.updateMany({ userId }, { streakDays: newStreak });

  return { streakDays: newStreak, streakBroken };
}

// ── Session summary ───────────────────────────────────────────────────────────

async function getSessionSummary(userId, sessionId) {
  const doc = await UserState.findOne({ userId, sessionId }).lean();
  if (!doc) return null;

  const totalSec     = Math.round((Date.now() - new Date(doc.sessionStart).getTime()) / 1000);
  const modeBreakdown = {};
  for (const entry of doc.modeHistory || []) {
    modeBreakdown[entry.mode] = (modeBreakdown[entry.mode] || 0) + (entry.durationSec || 0);
  }

  const hint = getProgressionHint(doc.progressionTier, doc.state);

  return {
    userId, sessionId,
    duration:       totalSec,
    finalState:     doc.state,
    finalTier:      doc.progressionTier,
    modeBreakdown,
    streakDays:     doc.streakDays,
    completions:    doc.signals?.contentCompletions || 0,
    questions:      doc.signals?.questionCount || 0,
    simAttempts:    doc.signals?.simulationAttempts || 0,
    progressionHint: hint
  };
}

module.exports = {
  applyReward,
  computeTier,
  getProgressionHint,
  updateStreak,
  getSessionSummary,
  REWARDS
};
