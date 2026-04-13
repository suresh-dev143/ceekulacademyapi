'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/contentAtomController');

router.post  ('/',                    ctrl.createAtom);
router.get   ('/topic/:topicId',      ctrl.getAtomsByTopic);
router.get   ('/:atomId',             ctrl.getAtom);
router.patch ('/:atomId',             ctrl.updateAtom);
router.post  ('/:atomId/view',        ctrl.recordView);
router.post  ('/:atomId/complete',    ctrl.recordComplete);
router.delete('/:atomId',             ctrl.deactivateAtom);

module.exports = router;
