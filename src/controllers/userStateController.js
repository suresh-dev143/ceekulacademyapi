'use strict';

const userStateSvc  = require('../services/userStateService');
const engagementSvc = require('../services/engagementService');

// GET /api/adaptive/state/:userId/:sessionId
async function getState(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const state = await userStateSvc.getState(userId, sessionId);
    if (!state) return res.status(404).json({ status: false, message: 'Session not found' });
    res.json({ status: true, data: state });
  } catch (err) { next(err); }
}

// POST /api/adaptive/state/:userId/:sessionId/signals
async function postSignals(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const { topicId, ...signals } = req.body;
    const updated = await userStateSvc.updateState(userId, sessionId, signals, topicId);
    res.json({ status: true, data: updated });
  } catch (err) { next(err); }
}

// POST /api/adaptive/state/:userId/:sessionId/reward
async function postReward(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const { rewardType } = req.body;
    const result = await engagementSvc.applyReward(userId, sessionId, rewardType);
    res.json({ status: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/adaptive/state/:userId/:sessionId/summary
async function getSessionSummary(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const summary = await engagementSvc.getSessionSummary(userId, sessionId);
    if (!summary) return res.status(404).json({ status: false, message: 'Session not found' });
    res.json({ status: true, data: summary });
  } catch (err) { next(err); }
}

// GET /api/adaptive/state/:userId/:sessionId/hint
async function getProgressionHint(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const state = await userStateSvc.getState(userId, sessionId);
    if (!state) return res.status(404).json({ status: false, message: 'Session not found' });
    const hint = engagementSvc.getProgressionHint(state.progressionTier, state.state);
    res.json({ status: true, data: hint });
  } catch (err) { next(err); }
}

module.exports = { getState, postSignals, postReward, getSessionSummary, getProgressionHint };
