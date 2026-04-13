'use strict';

const dtSvc = require('../services/digitalTwinService');

// GET /api/digital-twin/me
async function getMyTwin(req, res) {
  const twin = await dtSvc.getOrCreateTwin(req.user._id);
  res.json({ status: true, data: twin });
}

// GET /api/digital-twin/me/recommendations
async function getRecommendations(req, res) {
  const recs = await dtSvc.getRecommendations(req.user._id);
  res.json({ status: true, data: recs });
}

// POST /api/digital-twin/me/refresh-summary
async function refreshSummary(req, res) {
  const summary = await dtSvc.refreshAiSummary(req.user._id);
  res.json({ status: true, data: summary });
}

// POST /api/digital-twin/me/quiz-result
async function recordQuizResult(req, res) {
  const { topic, category, score, maxScore } = req.body;
  if (score == null || maxScore == null || !topic) {
    return res.status(400).json({ status: false, message: 'topic, score, maxScore required' });
  }
  await dtSvc.recordQuizResult(req.user._id, { topic, category, score, maxScore });
  res.json({ status: true });
}

// POST /api/digital-twin/me/session-watch
async function recordSessionWatch(req, res) {
  const { watchMinutes, lectureCategory } = req.body;
  if (watchMinutes == null) {
    return res.status(400).json({ status: false, message: 'watchMinutes required' });
  }
  await dtSvc.recordSessionWatch(req.user._id, { watchMinutes, lectureCategory });
  res.json({ status: true });
}

// POST /api/digital-twin/me/skill
async function updateSkill(req, res) {
  const { topic, category, delta, source } = req.body;
  if (!topic || delta == null) {
    return res.status(400).json({ status: false, message: 'topic and delta required' });
  }
  await dtSvc.updateSkillMastery(req.user._id, { topic, category, delta, source: source ?? 'self_report' });
  res.json({ status: true });
}

module.exports = { getMyTwin, getRecommendations, refreshSummary, recordQuizResult, recordSessionWatch, updateSkill };
