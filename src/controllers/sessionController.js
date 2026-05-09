'use strict';

const {
  startSession,
  microCommit,
  endSession,
  getSession,
} = require('../services/sessionLifecycleService');

// POST /api/sessions/start
async function start(req, res) {
  const { workshopId, scheduleId, title } = req.body;
  const hostId = req.user._id;

  if (!workshopId) return res.status(400).json({ status: false, message: 'workshopId required' });
  if (!title)      return res.status(400).json({ status: false, message: 'title required' });

  const result = await startSession({ workshopId, scheduleId, title, hostId });
  res.status(201).json({ status: true, data: result });
}

// POST /api/sessions/commit
async function commit(req, res) {
  const { sessionCid, logicalId, workshopId, scheduleId, title, startedAt, participantCount, chatCount, elapsedSecs } = req.body;
  const hostId = req.user._id;

  if (!sessionCid)  return res.status(400).json({ status: false, message: 'sessionCid required' });
  if (!workshopId)  return res.status(400).json({ status: false, message: 'workshopId required' });
  if (!elapsedSecs) return res.status(400).json({ status: false, message: 'elapsedSecs required' });

  const result = await microCommit({
    sessionCid, logicalId, workshopId, scheduleId, title,
    startedAt: startedAt || new Date().toISOString(),
    hostId,
    participantCount: participantCount ?? 0,
    chatCount:        chatCount        ?? 0,
    elapsedSecs,
  });

  res.json({ status: true, data: result });
}

// POST /api/sessions/end
async function end(req, res) {
  const { sessionCid, workshopId, scheduleId, title, startedAt, totalSecs, peakParticipants, totalMessages } = req.body;
  const hostId = req.user._id;

  if (!sessionCid) return res.status(400).json({ status: false, message: 'sessionCid required' });
  if (!workshopId) return res.status(400).json({ status: false, message: 'workshopId required' });

  const result = await endSession({
    sessionCid, workshopId, scheduleId, title,
    startedAt: startedAt || new Date().toISOString(),
    hostId,
    totalSecs:        totalSecs        ?? 0,
    peakParticipants: peakParticipants ?? 0,
    totalMessages:    totalMessages    ?? 0,
  });

  res.json({ status: true, data: result });
}

// GET /api/sessions/:cid
async function get(req, res) {
  const { cid } = req.params;
  const session = await getSession(cid);
  if (!session) return res.status(404).json({ status: false, message: 'Session not found' });
  res.json({ status: true, data: session });
}

module.exports = { start, commit, end, get };
