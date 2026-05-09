'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/sessionController');
const { authenticateUser } = require('../middlewares');

const router = Router();

router.use(authenticateUser);

router.post('/start',  ctrl.start);
router.post('/commit', ctrl.commit);
router.post('/end',    ctrl.end);
router.get('/:cid',    ctrl.get);

module.exports = router;
