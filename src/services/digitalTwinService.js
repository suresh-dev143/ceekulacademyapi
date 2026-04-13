'use strict';

const DigitalTwin = require('../models/digitalTwinModel');
const { runTwinSummary } = require('./claudeService');

// ── Get or create twin ────────────────────────────────────────────────────────

async function getOrCreateTwin(userId) {
  let twin = await DigitalTwin.findOne({ userId }).lean();
  if (!twin) {
    twin = await DigitalTwin.create({ userId });
    twin = twin.toObject();
  }
  return twin;
}

// ── Skill mastery update (called after quiz/session) ─────────────────────────

async function updateSkillMastery(userId, { topic, category, delta, source }) {
  const evidence = { source, delta, timestamp: new Date() };

  // Try to update existing skill first
  const updated = await DigitalTwin.findOneAndUpdate(
    { userId, 'skills.topic': topic },
    {
      $inc:  { 'skills.$.mastery': delta },
      $push: { 'skills.$.evidences': evidence },
      $set:  { 'skills.$.lastUpdated': new Date() }
    },
    { new: true }
  );

  // Skill not found — push a new one
  if (!updated) {
    await DigitalTwin.findOneAndUpdate(
      { userId },
      {
        $push: {
          skills: {
            topic, category,
            mastery:     Math.min(100, Math.max(0, delta)),
            lastUpdated: new Date(),
            evidences:   [evidence]
          }
        }
      },
      { upsert: true }
    );
  }

  // Recalculate cognitive level
  await _recalculateCognitiveProfile(userId);
}

// ── Refresh AI summary via Claude ─────────────────────────────────────────────

async function refreshAiSummary(userId) {
  const twin = await DigitalTwin.findOne({ userId }).lean();
  if (!twin) throw new Error('Digital twin not found');

  const summary = await runTwinSummary({ twin });

  await DigitalTwin.findOneAndUpdate(
    { userId },
    { $set: { aiSummary: { ...summary, generatedAt: new Date() } } }
  );

  return summary;
}

// ── Get personalised recommendations ─────────────────────────────────────────

async function getRecommendations(userId) {
  const twin = await DigitalTwin.findOne({ userId }).lean();
  if (!twin) return { topics: [], researchDirections: [] };

  return {
    topics:             twin.aiSummary?.nextRecommended ?? [],
    researchDirections: twin.researchDirections?.slice(0, 3) ?? [],
    cognitiveLevel:     twin.cognitiveProfile?.level ?? 'beginner',
    preferredDepth:     twin.cognitiveProfile?.preferredDepth ?? 'simplified'
  };
}

// ── Record session watch event ────────────────────────────────────────────────

async function recordSessionWatch(userId, { watchMinutes, lectureCategory }) {
  await DigitalTwin.findOneAndUpdate(
    { userId },
    {
      $inc: { totalWatchMinutes: watchMinutes },
      $set: { lastActiveAt: new Date() }
    },
    { upsert: true }
  );

  // Infer preferred content type
  if (watchMinutes > 20) {
    await DigitalTwin.findOneAndUpdate(
      { userId },
      { $addToSet: { 'preferences.preferredContentTypes': 'video' } }
    );
  }
}

// ── Record quiz completion ────────────────────────────────────────────────────

async function recordQuizResult(userId, { topic, category, score, maxScore }) {
  const normalised = Math.round((score / maxScore) * 100);
  const delta      = normalised >= 70 ? 10 : normalised >= 50 ? 5 : -3;

  await DigitalTwin.findOneAndUpdate(
    { userId },
    { $inc: { totalQuizzesTaken: 1 } },
    { upsert: true }
  );

  // Recalculate running average
  const twin = await DigitalTwin.findOne({ userId }).lean();
  if (twin) {
    const total = twin.totalQuizzesTaken ?? 1;
    const prev  = twin.avgQuizScore ?? 0;
    const newAvg = ((prev * (total - 1)) + normalised) / total;
    await DigitalTwin.findOneAndUpdate({ userId }, { $set: { avgQuizScore: Math.round(newAvg) } });
  }

  await updateSkillMastery(userId, { topic, category, delta, source: 'quiz' });
}

// ── Private: recalculate cognitive level from skills ─────────────────────────

async function _recalculateCognitiveProfile(userId) {
  const twin = await DigitalTwin.findOne({ userId }).lean();
  if (!twin?.skills?.length) return;

  const avg = twin.skills.reduce((s, sk) => s + sk.mastery, 0) / twin.skills.length;

  const level =
    avg >= 80 ? 'expert' :
    avg >= 60 ? 'advanced' :
    avg >= 35 ? 'intermediate' : 'beginner';

  const strong = twin.skills.filter(s => s.mastery >= 70).map(s => s.category).filter(Boolean);
  const weak   = twin.skills.filter(s => s.mastery < 35).map(s => s.category).filter(Boolean);

  const preferredDepth =
    level === 'expert'       ? 'research' :
    level === 'advanced'     ? 'mathematical' :
    level === 'intermediate' ? 'visual' : 'simplified';

  await DigitalTwin.findOneAndUpdate(
    { userId },
    {
      $set: {
        'cognitiveProfile.level':            level,
        'cognitiveProfile.preferredDepth':   preferredDepth,
        'cognitiveProfile.strongCategories': [...new Set(strong)],
        'cognitiveProfile.weakCategories':   [...new Set(weak)],
        'cognitiveProfile.lastRecalculatedAt': new Date()
      }
    }
  );
}

module.exports = {
  getOrCreateTwin,
  updateSkillMastery,
  refreshAiSummary,
  getRecommendations,
  recordSessionWatch,
  recordQuizResult
};
