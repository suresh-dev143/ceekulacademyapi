'use strict';

const { getEditorSessionInfo } = require('../services/liveEditService');
const { getActiveVersion }     = require('../services/contentAdaptationService');

/**
 * GET /api/live-edit/:lectureId/session
 * Returns current participants + active version summary.
 * Used by the Angular editor on load to hydrate initial state.
 */
async function getSession(req, res, next) {
  try {
    const info = await getEditorSessionInfo(req.params.lectureId);
    res.json({ status: true, data: info });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/live-edit/:lectureId/content
 * Returns the full active ContentVersion for the editor to populate
 * textarea values before the WebSocket session starts.
 */
async function getContent(req, res, next) {
  try {
    const version = await getActiveVersion(req.params.lectureId);
    if (!version) {
      return res.status(404).json({ status: false, message: 'No active version found' });
    }
    res.json({ status: true, data: version });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSession, getContent };
