'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/researchPipelineController');

router.post('/',                  ctrl.ingestItems);
router.post('/manual',            ctrl.addManual);
router.post('/run-pipeline',      ctrl.runPipeline);
router.get ('/',                  ctrl.listItems);
router.get ('/atom/:atomId',      ctrl.getForAtom);
router.post('/:itemId/extract',   ctrl.extractInsights);
router.post('/:itemId/map',       ctrl.mapToAtoms);
router.post('/:itemId/enrich',    ctrl.enrichAtoms);

module.exports = router;
