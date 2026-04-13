'use strict';

const {
  startSession,
  getSessionStatus,
  endSession
} = require('../services/schedulerService');

/**
 * POST /api/scheduler/session
 * Body: { sessionId, pageId, learnerProfile? }
 * Starts a server-side 50+10 min cycle for this learner session.
 */
async function startSchedulerSession(req, res, next) {
  try {
    const studentId     = req.user._id.toString();
    const { sessionId, pageId, learnerProfile = {} } = req.body;

    if (!sessionId) {
      return res.status(400).json({ status: false, message: 'sessionId is required' });
    }

    await startSession(sessionId, pageId, studentId, learnerProfile);

    return res.status(201).json({
      status:    true,
      message:   'Session started',
      sessionId,
      contentDurationMs:     50 * 60 * 1000,
      advertisementDurationMs: 10 * 60 * 1000
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/scheduler/session/:sessionId
 * REST polling fallback — returns current phase + remaining time.
 */
function getSchedulerStatus(req, res) {
  const { sessionId } = req.params;
  const status = getSessionStatus(sessionId);

  if (!status) {
    return res.status(404).json({ status: false, message: 'Session not found' });
  }

  return res.json({ status: true, data: status });
}

/**
 * DELETE /api/scheduler/session/:sessionId
 * Terminates a session and clears all timers.
 */
function endSchedulerSession(req, res) {
  const { sessionId } = req.params;
  endSession(sessionId);
  return res.json({ status: true, message: 'Session ended', sessionId });
}

module.exports = {
  startSchedulerSession,
  getSchedulerStatus,
  endSchedulerSession
};
