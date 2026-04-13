'use strict';

const { Router }  = require('express');
const ctrl        = require('../controllers/liveEditController');
const { authenticateUser }    = require('../middlewares');
const { authenticateTeacher } = require('../middlewares');

const router = Router();

// Both teachers and students need to load the editor (students observe)
router.get('/:lectureId/session', authenticateUser,    ctrl.getSession);
router.get('/:lectureId/content', authenticateUser,    ctrl.getContent);

module.exports = router;
