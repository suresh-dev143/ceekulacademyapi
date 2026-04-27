'use strict';

const router = require('express').Router();
const { getActivities, saveActivities, updateActivities } = require('../controllers/myActivitiesController');
const { authenticateUser } = require('../middlewares');

// All routes require a valid user session
router.use(authenticateUser);

// GET  /api/my-activities       — fetch the calling user's schedule
router.get('/', getActivities);

// POST /api/my-activities       — create or overwrite (upsert by userId)
router.post('/', saveActivities);

// PUT  /api/my-activities/:id   — update by document _id
router.put('/:id', updateActivities);

module.exports = router;
