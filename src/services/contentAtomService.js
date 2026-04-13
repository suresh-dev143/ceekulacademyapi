'use strict';

/**
 * ContentAtom Service — CRUD, retrieval, versioning, and quality scoring.
 */

const { randomUUID } = require('crypto');
const ContentAtom     = require('../models/contentAtomModel');

const uuidv4 = () => randomUUID();

// ── Create ─────────────────────────────────────────────────────────────────────

async function createAtom(payload) {
  const atomId = payload.atomId || `atom_${uuidv4().slice(0, 10)}`;
  const atom   = await ContentAtom.create({ ...payload, atomId });
  return atom;
}

// ── Read ──────────────────────────────────────────────────────────────────────

async function getAtomById(atomId) {
  return ContentAtom.findOne({ atomId, isActive: true }).lean();
}

async function getAtomsByTopic(topicId, { difficulty, limit = 20, skip = 0 } = {}) {
  const filter = { topicId, isActive: true };
  if (difficulty) filter['coreConcept.difficulty'] = difficulty;
  return ContentAtom.find(filter)
    .sort({ qualityScore: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function getAtomByDifficulty(topicId, targetDifficulty) {
  // Find the closest difficulty atom for adaptive delivery
  return ContentAtom.findOne({
    topicId,
    isActive: true,
    'coreConcept.difficulty': { $lte: targetDifficulty + 1, $gte: targetDifficulty - 1 }
  })
    .sort({ 'engagementMetrics.completionRate': -1, qualityScore: -1 })
    .lean();
}

// ── Update ────────────────────────────────────────────────────────────────────

async function updateAtom(atomId, patch, { changedBy = 'system', agent = null, reason = '' } = {}) {
  const existing = await ContentAtom.findOne({ atomId });
  if (!existing) throw new Error(`ContentAtom not found: ${atomId}`);

  const nextVersion = (existing.version || 1) + 1;

  // Store delta in version history
  const entry = {
    version:   nextVersion,
    changedAt: new Date(),
    changedBy,
    agent,
    reason,
    delta:     patch
  };

  await ContentAtom.findByIdAndUpdate(existing._id, {
    ...patch,
    version: nextVersion,
    $push:   { versionHistory: { $each: [entry], $slice: -50 } }
  });

  return ContentAtom.findOne({ atomId }).lean();
}

/**
 * Enrich research extension (open questions, hypotheses, papers) from a research item.
 * Merges, deduplicates, and bumps version.
 */
async function enrichResearchExtension(atomId, { openQuestions = [], hypotheses = [], futureDirections = [], relatedPapers = [] }, sourceResearchId) {
  const atom = await ContentAtom.findOne({ atomId });
  if (!atom) throw new Error(`ContentAtom not found: ${atomId}`);

  const ext = atom.researchExtension.toObject ? atom.researchExtension.toObject() : { ...atom.researchExtension };

  const merged = {
    openQuestions:    [...new Set([...ext.openQuestions,    ...openQuestions])],
    hypotheses:       [...new Set([...ext.hypotheses,       ...hypotheses])],
    futureDirections: [...new Set([...ext.futureDirections, ...futureDirections])],
    relatedPapers:    deduplicatePapers([...ext.relatedPapers, ...relatedPapers]),
    lastEnriched:     new Date()
  };

  return updateAtom(atomId, { researchExtension: merged }, {
    changedBy: 'system',
    agent:     'research_mapper',
    reason:    `Enriched from research item: ${sourceResearchId}`
  });
}

function deduplicatePapers(papers) {
  const seen = new Set();
  return papers.filter(p => {
    const key = p.doi || p.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);  // cap at 20 papers
}

// ── Engagement metrics update ─────────────────────────────────────────────────

async function recordAtomView(atomId, { dwellTime, motivationDelta, triggerResponded }) {
  const atom = await ContentAtom.findOne({ atomId });
  if (!atom) return;

  const m    = atom.engagementMetrics.toObject ? atom.engagementMetrics.toObject() : { ...atom.engagementMetrics };
  const n    = (m.viewCount || 0) + 1;
  const ema  = (v, next) => v ? (v * 0.9 + next * 0.1) : next;

  await ContentAtom.findByIdAndUpdate(atom._id, {
    'engagementMetrics.viewCount':          n,
    'engagementMetrics.avgDwellTime':       ema(m.avgDwellTime, dwellTime || 0),
    'engagementMetrics.avgMotivationDelta': ema(m.avgMotivationDelta, motivationDelta || 0),
    'engagementMetrics.triggerSuccessRate': ema(m.triggerSuccessRate, triggerResponded ? 100 : 0)
  });
}

async function recordAtomCompletion(atomId) {
  const atom = await ContentAtom.findOne({ atomId });
  if (!atom) return;

  const m    = atom.engagementMetrics.toObject ? atom.engagementMetrics.toObject() : { ...atom.engagementMetrics };
  const rate = m.completionRate ? (m.completionRate * 0.9 + 100 * 0.1) : 100;

  await ContentAtom.findByIdAndUpdate(atom._id, {
    'engagementMetrics.completionRate': rate
  });
}

// ── Quality scoring ────────────────────────────────────────────────────────────

/**
 * Recompute quality score based on content completeness + engagement.
 * Called after each AI enrichment cycle.
 */
async function recomputeQuality(atomId) {
  const atom = await ContentAtom.findOne({ atomId }).lean();
  if (!atom) return;

  let score = 0;
  const c   = atom.coreConcept || {};
  const h   = atom.microHook   || {};
  const ci  = atom.cinematicExplanation || {};
  const sim = atom.simulation  || {};
  const xr  = atom.xr          || {};
  const re  = atom.researchExtension || {};

  // Completeness checks (60 points)
  if (c.summary?.length > 50)        score += 10;
  if (h.text?.length > 20)           score += 10;
  if (ci.narrative?.length > 100)    score += 10;
  if (ci.keyFrames?.length > 2)      score +=  5;
  if (sim.config)                     score += 10;
  if (xr.assetUrl || xr.sceneType)   score +=  8;
  if (re.openQuestions?.length >= 3)  score +=  4;
  if (re.relatedPapers?.length >= 2)  score +=  3;

  // Engagement boost (40 points)
  const eng = atom.engagementMetrics || {};
  score += Math.min((eng.completionRate || 0) * 0.2, 20);
  score += Math.min((eng.triggerSuccessRate || 0) * 0.1, 10);
  score += Math.min((eng.avgMotivationDelta || 0) * 0.5, 10);

  await ContentAtom.findOneAndUpdate({ atomId }, { qualityScore: Math.round(Math.min(score, 100)) });
  return Math.round(Math.min(score, 100));
}

// ── Delete / deactivate ───────────────────────────────────────────────────────

async function deactivateAtom(atomId) {
  return ContentAtom.findOneAndUpdate({ atomId }, { isActive: false }, { new: true });
}

// ── Seed / bulk ───────────────────────────────────────────────────────────────

async function bulkUpsert(atoms) {
  const ops = atoms.map(a => ({
    updateOne: {
      filter:    { atomId: a.atomId || `atom_${uuidv4().slice(0, 10)}` },
      update:    { $setOnInsert: a },
      upsert:    true
    }
  }));
  return ContentAtom.bulkWrite(ops);
}

module.exports = {
  createAtom,
  getAtomById,
  getAtomsByTopic,
  getAtomByDifficulty,
  updateAtom,
  enrichResearchExtension,
  recordAtomView,
  recordAtomCompletion,
  recomputeQuality,
  deactivateAtom,
  bulkUpsert
};
