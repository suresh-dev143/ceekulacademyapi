'use strict';

/**
 * Enrolment Router
 *
 * POST   /api/enrolments/:scheduleId   — enrol
 * DELETE /api/enrolments/:scheduleId   — cancel enrolment
 * GET    /api/enrolments/mine          — citizen's active enrolments
 * GET    /api/enrolments/:scheduleId/check — O(1) enrolment check
 */

const express  = require('express');
const router   = express.Router();
const svc      = require('../services/enrolmentService');
const { authenticateUser } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); } catch (err) { next(err); }
  };
}

function actorId(req) {
  const u = req.user;
  const raw = u?.ceebrainId ?? u?.id?.toString() ?? '';
  return raw.startsWith('CB') ? raw : `CB${raw}`;
}

// My enrolments (must be before /:scheduleId)
router.get('/mine', authenticateUser, h(async (req, res) => {
  const { limit, page } = req.query;
  const data = await svc.myEnrolments(actorId(req), {
    limit: parseInt(limit) || 20,
    page:  parseInt(page)  || 0,
  });
  res.json({ status: true, data });
}));

// Enrolment check — O(1) via policy tuple + Redis
router.get('/:scheduleId/check', authenticateUser, h(async (req, res) => {
  const enrolled = await svc.isEnrolled(actorId(req), req.params.scheduleId);
  res.json({ status: true, enrolled });
}));

// Enrol
router.post('/:scheduleId', authenticateUser, h(async (req, res) => {
  const { enrolment, isDuplicate } = await svc.enrol(
    actorId(req),
    req.params.scheduleId,
    { selfCbId: req.body.selfCbId ?? null }
  );
  res.status(isDuplicate ? 200 : 201).json({ status: true, data: enrolment, isDuplicate });
}));

// Cancel
router.delete('/:scheduleId', authenticateUser, h(async (req, res) => {
  const enrolment = await svc.cancel(actorId(req), req.params.scheduleId);
  res.json({ status: true, data: enrolment });
}));

module.exports = router;
