'use strict';

const express = require('express');
const { getHistory, getSummary, getStats } = require('../controllers/chatController');

const router = express.Router();

// Paginated message history for a lecture
router.get('/:lectureId/history', getHistory);

// Latest AI-generated summary
router.get('/:lectureId/summary', getSummary);

// Message stats (count, questions, moderation breakdown)
router.get('/:lectureId/stats', getStats);

module.exports = router;
