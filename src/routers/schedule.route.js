'use strict';

/**
 * Schedule Router
 *
 * POST   /api/schedules            — create (AI pipeline inside service)
 * GET    /api/schedules            — list creator's schedules
 * GET    /api/schedules/search     — search available sessions (Enrol page)
 * GET    /api/schedules/:id        — get one schedule
 * DELETE /api/schedules/:id        — cancel a schedule
 */

const express  = require('express');
const router   = express.Router();
const svc      = require('../services/scheduleService');
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

// Search — public read (no auth required so Enrol page can search freely)
router.get('/search', h(async (req, res) => {
  const { category, programTitle, sectionTitle, contentTitle, limit, page } = req.query;
  const results = await svc.searchSchedules({
    category, programTitle, sectionTitle, contentTitle,
    limit: parseInt(limit) || 20,
    page:  parseInt(page)  || 0,
  });
  res.json({ status: true, data: results });
}));

// Create
router.post('/', authenticateUser, h(async (req, res) => {
  const { schedule, isDuplicate } = await svc.createSchedule(actorId(req), req.body);
  res.status(isDuplicate ? 200 : 201).json({ status: true, data: schedule, isDuplicate });
}));

// List creator's schedules
router.get('/', authenticateUser, h(async (req, res) => {
  const { limit, page } = req.query;
  const data = await svc.listByCreator(actorId(req), {
    limit: parseInt(limit) || 20,
    page:  parseInt(page)  || 0,
  });
  res.json({ status: true, data });
}));

// Get one
router.get('/:scheduleId', h(async (req, res) => {
  const schedule = await svc.getSchedule(req.params.scheduleId);
  if (!schedule) return res.status(404).json({ status: false, message: 'Schedule not found' });
  res.json({ status: true, data: schedule });
}));

// Cancel
router.delete('/:scheduleId', authenticateUser, h(async (req, res) => {
  const schedule = await svc.cancelSchedule(req.params.scheduleId, actorId(req));
  res.json({ status: true, data: schedule });
}));

module.exports = router;
