'use strict';

const pipelineSvc = require('../services/researchPipelineService');

// POST /api/adaptive/research/ingest
async function ingestItems(req, res, next) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ status: false, message: 'items[] required' });
    }
    const result = await pipelineSvc.ingestItems(items);
    res.status(201).json({ status: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/adaptive/research/manual
async function addManual(req, res, next) {
  try {
    const item = await pipelineSvc.addManualItem(req.body);
    res.status(201).json({ status: true, data: item });
  } catch (err) { next(err); }
}

// POST /api/adaptive/research/:itemId/extract
async function extractInsights(req, res, next) {
  try {
    const item = await pipelineSvc.extractInsights(req.params.itemId);
    res.json({ status: true, data: item });
  } catch (err) { next(err); }
}

// POST /api/adaptive/research/:itemId/map
async function mapToAtoms(req, res, next) {
  try {
    const atomIds = await pipelineSvc.mapToAtoms(req.params.itemId);
    res.json({ status: true, data: { mappedAtoms: atomIds } });
  } catch (err) { next(err); }
}

// POST /api/adaptive/research/:itemId/enrich
async function enrichAtoms(req, res, next) {
  try {
    const result = await pipelineSvc.enrichAtoms(req.params.itemId);
    res.json({ status: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/adaptive/research/run-pipeline
async function runPipeline(req, res, next) {
  try {
    const { batchSize = 5 } = req.body;
    const results = await pipelineSvc.runFullPipeline(Number(batchSize));
    res.json({ status: true, data: results });
  } catch (err) { next(err); }
}

// GET /api/adaptive/research?status=pending
async function listItems(req, res, next) {
  try {
    const { status = 'done', limit = 20 } = req.query;
    const items = await pipelineSvc.getByStatus(status, Number(limit));
    res.json({ status: true, data: items });
  } catch (err) { next(err); }
}

// GET /api/adaptive/research/atom/:atomId
async function getForAtom(req, res, next) {
  try {
    const items = await pipelineSvc.getForAtom(req.params.atomId);
    res.json({ status: true, data: items });
  } catch (err) { next(err); }
}

module.exports = {
  ingestItems, addManual, extractInsights, mapToAtoms,
  enrichAtoms, runPipeline, listItems, getForAtom
};
