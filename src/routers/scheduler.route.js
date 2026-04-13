'use strict';

const express = require('express');
const router  = express.Router();
const {
  startSchedulerSession,
  getSchedulerStatus,
  endSchedulerSession
} = require('../controllers/schedulerController');
const { authenticateUser } = require('../middlewares');

// Start a new hourly session (arms the 50-min content timer)
router.post('/session', authenticateUser, startSchedulerSession);

// Poll current phase + remaining time (REST fallback for environments without WS)
router.get('/session/:sessionId', authenticateUser, getSchedulerStatus);

// Terminate session explicitly (called on page leave / component destroy)
router.delete('/session/:sessionId', authenticateUser, endSchedulerSession);

module.exports = router;
