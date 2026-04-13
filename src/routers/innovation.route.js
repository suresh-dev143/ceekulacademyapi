'use strict';

const { Router }  = require('express');
const ctrl        = require('../controllers/innovationController');
const { authenticateUser } = require('../middlewares');

const router = Router();

// Public browsing — no auth needed
router.get('/public', ctrl.getPublicIdeas);

// Everything else requires login
router.use(authenticateUser);

router.post('/',                ctrl.createIdea);
router.get('/mine',             ctrl.getMyIdeas);
router.post('/:id/coach',      ctrl.getCoaching);
router.post('/:id/advance',    ctrl.advanceStage);
router.post('/:id/artifacts',  ctrl.addArtifact);
router.post('/:id/team',       ctrl.addTeamMember);
router.post('/:id/upvote',     ctrl.upvoteIdea);

module.exports = router;
