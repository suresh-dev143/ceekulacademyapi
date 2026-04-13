'use strict';

const adaptiveSvc  = require('../services/adaptiveEngineService');
const userStateSvc = require('../services/userStateService');
const atomSvc      = require('../services/contentAtomService');

// POST /api/adaptive/engine/:userId/:sessionId/process
// Process a signal batch → compute new state + mode decision
async function processSignals(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const { signals, topicId }  = req.body;
    const result = await adaptiveSvc.processSignals(userId, sessionId, signals, topicId);
    const animProfile = adaptiveSvc.computeAnimationProfile(result.state.state);
    res.json({ status: true, data: { ...result, animationProfile: animProfile } });
  } catch (err) { next(err); }
}

// POST /api/adaptive/engine/:userId/:sessionId/force-mode
async function forceMode(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const { mode } = req.body;
    const result = await adaptiveSvc.forceMode(userId, sessionId, mode);
    res.json({ status: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/adaptive/engine/:userId/:sessionId/next-atom
// Recommend next ContentAtom based on proficiency + topic
async function getNextAtom(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const state = await userStateSvc.getState(userId, sessionId);
    if (!state) return res.status(404).json({ status: false, message: 'Session not found' });

    const proficiency = state.state?.proficiency || 0;
    const topicId     = state.topicId || req.query.topicId;
    if (!topicId) return res.status(400).json({ status: false, message: 'topicId required' });

    // Map proficiency 0-100 → difficulty 1-5
    const targetDiff = Math.max(1, Math.min(5, Math.ceil((proficiency / 100) * 5)));
    const atom       = await atomSvc.getAtomByDifficulty(topicId, targetDiff);

    if (!atom) return res.status(404).json({ status: false, message: 'No atom found for this topic/difficulty' });

    const animProfile = adaptiveSvc.computeAnimationProfile(state.state);
    res.json({ status: true, data: { atom, mode: state.currentMode, animationProfile: animProfile } });
  } catch (err) { next(err); }
}

// GET /api/adaptive/engine/:userId/:sessionId/animation-profile
async function getAnimationProfile(req, res, next) {
  try {
    const { userId, sessionId } = req.params;
    const state = await userStateSvc.getState(userId, sessionId);
    if (!state) return res.status(404).json({ status: false, message: 'Session not found' });
    const profile = adaptiveSvc.computeAnimationProfile(state.state);
    res.json({ status: true, data: profile });
  } catch (err) { next(err); }
}

module.exports = { processSignals, forceMode, getNextAtom, getAnimationProfile };
