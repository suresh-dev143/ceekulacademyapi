'use strict';

const svc = require('../services/contentAdaptationService');

// POST /api/content/:lectureId/init
async function initVersion(req, res) {
  const { segments } = req.body;
  if (!segments?.length) {
    return res.status(400).json({ status: false, message: 'segments array required' });
  }
  const version = await svc.createInitialVersion(req.params.lectureId, segments);
  res.status(201).json({ status: true, data: version });
}

// GET /api/content/:lectureId/active
async function getActive(req, res) {
  const version = await svc.getActiveVersion(req.params.lectureId);
  if (!version) return res.status(404).json({ status: false, message: 'No active version found' });
  res.json({ status: true, data: version });
}

// GET /api/content/:lectureId/history
async function getHistory(req, res) {
  const history = await svc.getVersionHistory(req.params.lectureId);
  res.json({ status: true, data: history });
}

// POST /api/content/:lectureId/optimise
async function optimise(req, res) {
  const { triggerMetrics } = req.body;
  if (!triggerMetrics) {
    return res.status(400).json({ status: false, message: 'triggerMetrics required' });
  }
  const result = await svc.optimiseContent(req.params.lectureId, triggerMetrics);
  res.json({ status: true, data: result });
}

// POST /api/content/:lectureId/research
async function integrateResearch(req, res) {
  const { researchTitle, researchAbstract } = req.body;
  if (!researchTitle || !researchAbstract) {
    return res.status(400).json({ status: false, message: 'researchTitle and researchAbstract required' });
  }
  const result = await svc.integrateResearch(req.params.lectureId, { researchTitle, researchAbstract });
  res.json({ status: true, data: result });
}

// GET /api/content/:lectureId/segment/:order/depth/:depth
async function getSegmentDepth(req, res) {
  const { lectureId, order, depth } = req.params;
  const validDepths = ['simplified', 'visual', 'mathematical', 'research'];
  if (!validDepths.includes(depth)) {
    return res.status(400).json({ status: false, message: `depth must be one of ${validDepths.join(', ')}` });
  }
  const segment = await svc.getSegmentForDepth(lectureId, parseInt(order, 10), depth);
  if (!segment) return res.status(404).json({ status: false, message: 'Segment not found' });
  res.json({ status: true, data: segment });
}

// POST /api/content/:lectureId/outcome
async function recordOutcome(req, res) {
  const { avgWatchRatioDelta, avgQuizScoreDelta, completionRateDelta } = req.body;
  await svc.recordOutcome(req.params.lectureId, { avgWatchRatioDelta, avgQuizScoreDelta, completionRateDelta });
  res.json({ status: true });
}

// GET /api/content/:lectureId/render?level=beginner&depth=simplified
async function renderContent(req, res) {
  const { level, depth } = req.query;
  const validLevels = ['beginner','intermediate','advanced','expert'];
  const validDepths = ['simplified','visual','mathematical','research'];

  if (level && !validLevels.includes(level)) {
    return res.status(400).json({ status: false, message: `level must be one of ${validLevels.join(', ')}` });
  }
  if (depth && !validDepths.includes(depth)) {
    return res.status(400).json({ status: false, message: `depth must be one of ${validDepths.join(', ')}` });
  }

  const rendered = await svc.renderForLearner(req.params.lectureId, {
    level:          level || req.user?.cognitiveLevel || 'intermediate',
    preferredDepth: depth || null
  });

  res.json({ status: true, data: rendered });
}

// POST /api/content/:lectureId/enrich/:order
async function enrichMedia(req, res) {
  const order = parseInt(req.params.order, 10);
  if (isNaN(order) || order < 1) {
    return res.status(400).json({ status: false, message: 'order must be a positive integer' });
  }
  const result = await svc.enrichSegmentMedia(req.params.lectureId, order);
  res.json({ status: true, data: result });
}

// POST /api/content/:lectureId/quality-check
async function qualityCheck(req, res) {
  const result = await svc.checkQuality(req.params.lectureId);
  res.json({ status: true, data: result });
}

module.exports = {
  initVersion, getActive, getHistory, optimise,
  integrateResearch, getSegmentDepth, recordOutcome,
  renderContent, enrichMedia, qualityCheck
};
