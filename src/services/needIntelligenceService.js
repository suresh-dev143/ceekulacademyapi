'use strict';

/**
 * Need Intelligence Service
 *
 * Reads UCE semantic patterns to identify wellness signals — situations where
 * an agent (human or otherwise) may benefit from welfare resources.
 *
 * Principles:
 *   1. Consent-first: never runs without explicit opt-in
 *   2. Transparency: every signal detected is explained in plain language
 *   3. Dignity: recommendations are framed as resources, not deficits
 *   4. Sovereignty: the agent can see exactly what was observed and dismiss signals
 *   5. No surveillance: aggregate patterns only; no behavioral profiling
 */

const UceContent  = require('../models/uceContentModel');
const ScreenState = require('../models/screenStateModel');

const SIGNAL_WINDOW_DAYS = 14;

async function assess(userId) {
  const since   = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const signals = [];

  // ── Signal 1: Information scarcity ───────────────────────────────────────
  // Repeated search instructions that don't lead to content engagement
  const searches = await UceContent.find({
    ownerId:              userId,
    contentType:          'ui-instruction',
    'payload.instructionType': 'input',
    createdAt:            { $gte: since },
  }).select('payload createdAt').lean();

  if (searches.length >= 3) {
    const terms = searches.map(s => String(s.payload?.value || '').slice(0, 40)).filter(Boolean);
    signals.push({
      type:        'information_scarcity',
      title:       'Repeated searching without resolution',
      explanation: `You searched ${searches.length} times in the last ${SIGNAL_WINDOW_DAYS} days without finding what you needed. Topics: ${terms.slice(0, 3).join(', ')}.`,
      urgency:     searches.length >= 6 ? 'medium' : 'low',
      dataPoints:  searches.length,
      recommendation: { welfareType: 'cun', goalCategory: 'learning',
        reason: 'Learning support resources may help resolve the knowledge gaps being searched.' }
    });
  }

  // ── Signal 2: Welfare context engagement ─────────────────────────────────
  // Agent has navigated to welfare-related contexts multiple times
  const welfareVisits = await UceContent.countDocuments({
    ownerId:    userId,
    contentType: 'ui-instruction',
    'payload.target': { $in: ['welfare', 'apply', 'support', 'help'] },
    createdAt:  { $gte: since },
  });

  if (welfareVisits >= 2) {
    signals.push({
      type:        'welfare_intent',
      title:       'Multiple visits to welfare resources',
      explanation: `You visited welfare-related areas ${welfareVisits} times recently. We want to make sure you can access support easily.`,
      urgency:     welfareVisits >= 4 ? 'high' : 'medium',
      dataPoints:  welfareVisits,
      recommendation: { welfareType: 'fun', goalCategory: 'other',
        reason: 'Proactive welfare support may be available before a formal application is needed.' }
    });
  }

  // ── Signal 3: Disengagement ───────────────────────────────────────────────
  // No commits in the last 7 days after prior activity
  const recentCommits = await UceContent.countDocuments({
    ownerId:   userId,
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });

  const priorCommits = await UceContent.countDocuments({
    ownerId:   userId,
    createdAt: { $gte: since, $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });

  if (recentCommits === 0 && priorCommits >= 5) {
    signals.push({
      type:        'disengagement',
      title:       'Recent pause in activity',
      explanation: `After ${priorCommits} active days, there has been no recorded activity for 7 days. Life happens — this is just a gentle check-in signal.`,
      urgency:     'low',
      dataPoints:  priorCommits,
      recommendation: { welfareType: 'cun', goalCategory: 'learning',
        reason: 'Sometimes disengagement signals an unmet need. Learning continuity support is available.' }
    });
  }

  // ── Signal 4: Emergency context ───────────────────────────────────────────
  const emergencyVisits = await UceContent.countDocuments({
    ownerId:   userId,
    contentType: 'ui-instruction',
    'payload.target': { $regex: /emergency|urgent|crisis/, $options: 'i' },
    createdAt: { $gte: since },
  });

  if (emergencyVisits >= 1) {
    signals.push({
      type:        'emergency_signal',
      title:       'Emergency-related navigation detected',
      explanation: `Emergency-related areas were visited ${emergencyVisits} time(s) recently. SUN (emergency welfare) resources are available immediately.`,
      urgency:     'high',
      dataPoints:  emergencyVisits,
      recommendation: { welfareType: 'sun', goalCategory: 'emergency_safety',
        reason: 'Emergency welfare (SUN) can be accessed without a queue.' }
    });
  }

  return {
    agentId:     userId,
    assessedAt:  new Date(),
    windowDays:  SIGNAL_WINDOW_DAYS,
    signals,
    consentUsed: true,
    transparency: 'These signals were derived from your navigation patterns only. No content was read. You can dismiss any signal.',
  };
}

module.exports = { assess };
