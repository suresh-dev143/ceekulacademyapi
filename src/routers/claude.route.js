'use strict';

const { Router }    = require('express');
const ctrl          = require('../controllers/claudeController');
const { authenticateUser } = require('../middlewares');

const router = Router();

router.use(authenticateUser);

router.post('/co-teacher',         ctrl.coTeacher);
router.post('/ad-copy',            ctrl.adCopy);
router.post('/generate-workshop',  ctrl.generateWorkshop);

module.exports = router;
