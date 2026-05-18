'use strict';

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/aiAssistController');
const { authenticateUser } = require('../middlewares');

router.post('/assist', authenticateUser, ctrl.assist);

module.exports = router;
