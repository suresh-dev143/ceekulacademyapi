'use strict';

const atomSvc = require('../services/contentAtomService');

// POST /api/adaptive/atoms
async function createAtom(req, res, next) {
  try {
    const atom = await atomSvc.createAtom(req.body);
    res.status(201).json({ status: true, data: atom });
  } catch (err) { next(err); }
}

// GET /api/adaptive/atoms/:atomId
async function getAtom(req, res, next) {
  try {
    const atom = await atomSvc.getAtomById(req.params.atomId);
    if (!atom) return res.status(404).json({ status: false, message: 'Atom not found' });
    res.json({ status: true, data: atom });
  } catch (err) { next(err); }
}

// GET /api/adaptive/atoms/topic/:topicId
async function getAtomsByTopic(req, res, next) {
  try {
    const { topicId }  = req.params;
    const { difficulty, limit, skip } = req.query;
    const atoms = await atomSvc.getAtomsByTopic(topicId, {
      difficulty: difficulty ? Number(difficulty) : undefined,
      limit:      limit  ? Number(limit)  : 20,
      skip:       skip   ? Number(skip)   : 0
    });
    res.json({ status: true, data: atoms });
  } catch (err) { next(err); }
}

// PATCH /api/adaptive/atoms/:atomId
async function updateAtom(req, res, next) {
  try {
    const { reason } = req.body;
    const atom = await atomSvc.updateAtom(req.params.atomId, req.body, {
      changedBy: req.user?.id || 'system',
      reason
    });
    res.json({ status: true, data: atom });
  } catch (err) { next(err); }
}

// POST /api/adaptive/atoms/:atomId/view
async function recordView(req, res, next) {
  try {
    await atomSvc.recordAtomView(req.params.atomId, req.body);
    res.json({ status: true });
  } catch (err) { next(err); }
}

// POST /api/adaptive/atoms/:atomId/complete
async function recordComplete(req, res, next) {
  try {
    await atomSvc.recordAtomCompletion(req.params.atomId);
    await atomSvc.recomputeQuality(req.params.atomId);
    res.json({ status: true });
  } catch (err) { next(err); }
}

// DELETE /api/adaptive/atoms/:atomId
async function deactivateAtom(req, res, next) {
  try {
    await atomSvc.deactivateAtom(req.params.atomId);
    res.json({ status: true });
  } catch (err) { next(err); }
}

module.exports = { createAtom, getAtom, getAtomsByTopic, updateAtom, recordView, recordComplete, deactivateAtom };
