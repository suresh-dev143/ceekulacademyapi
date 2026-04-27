'use strict';

const router             = require('express').Router();
const { authenticateUser } = require('../middlewares');
const { validateStoryContent } = require('../controllers/contentValidationController');

// POST /api/validate/content — AI content check before submission
router.post('/content', authenticateUser, validateStoryContent);

module.exports = router;
