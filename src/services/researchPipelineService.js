'use strict';

/**
 * Research Pipeline Service — ingest, extract, map, and enrich.
 *
 * Pipeline stages:
 *   1. ingest(source, items[])    → create ResearchItem docs (status: pending)
 *   2. extractInsights(itemId)    → Claude agent extracts questions/hypotheses
 *   3. mapToAtoms(itemId)         → find matching ContentAtoms by tags/keywords
 *   4. enrichAtoms(itemId)        → push extracted insights into matched atoms
 *   5. runFullPipeline()          → batch process all pending items
 */

const ResearchItem  = require('../models/researchItemModel');
const ContentAtom   = require('../models/contentAtomModel');
const atomService   = require('./contentAtomService');
const claude        = require('./claudeService');

// ── 1. Ingest ─────────────────────────────────────────────────────────────────

/**
 * Bulk-insert research items (idempotent via externalId + source unique index).
 */
async function ingestItems(items) {
  const ops = items.map(item => ({
    updateOne: {
      filter: {
        externalId: item.externalId || `manual_${Date.now()}`,
        source:     item.source || 'manual'
      },
      update:   { $setOnInsert: { ...item, processingStatus: 'pending' } },
      upsert:   true
    }
  }));

  const result = await ResearchItem.bulkWrite(ops);
  return result;
}

/**
 * Add a single manual research item.
 */
async function addManualItem({ title, abstract, authors = [], topicTags = [], doi, url }) {
  return ResearchItem.create({
    source:      'manual',
    externalId:  `manual_${Date.now()}`,
    title, abstract, authors, topicTags, doi, url,
    processingStatus: 'pending'
  });
}

// ── 2. Extract insights via Claude ────────────────────────────────────────────

async function extractInsights(itemId) {
  const item = await ResearchItem.findById(itemId);
  if (!item) throw new Error(`ResearchItem not found: ${itemId}`);

  await ResearchItem.findByIdAndUpdate(itemId, { processingStatus: 'extracting' });

  try {
    const result = await claude.runResearchMapper({
      title:    item.title,
      abstract: item.abstract || item.title,
      topicTags: item.topicTags
    });

    await ResearchItem.findByIdAndUpdate(itemId, {
      aiSummary:           result.summary           || '',
      extractedQuestions:  result.openQuestions      || [],
      extractedHypotheses: result.hypotheses         || [],
      futureDirections:    result.futureDirections   || [],
      topicTags:           [...new Set([...item.topicTags, ...(result.tags || [])])],
      processingStatus:    'mapping'
    });

    return await ResearchItem.findById(itemId).lean();
  } catch (err) {
    await ResearchItem.findByIdAndUpdate(itemId, {
      processingStatus: 'failed',
      processingError:  err.message
    });
    throw err;
  }
}

// ── 3. Map to ContentAtoms ────────────────────────────────────────────────────

async function mapToAtoms(itemId) {
  const item = await ResearchItem.findById(itemId);
  if (!item || item.processingStatus !== 'mapping') {
    throw new Error(`Item ${itemId} not ready for mapping`);
  }

  // Find atoms matching any of the item's topic tags
  const matchedAtoms = await ContentAtom.find({
    isActive: true,
    $or: [
      { tags:             { $in: item.topicTags } },
      { 'coreConcept.keywords': { $in: item.topicTags } },
      { topicId:          { $in: item.topicTags } }
    ]
  }).select('atomId').lean();

  const atomIds = matchedAtoms.map(a => a.atomId);

  await ResearchItem.findByIdAndUpdate(itemId, {
    mappedAtoms:      atomIds,
    processingStatus: 'enriching'
  });

  return atomIds;
}

// ── 4. Enrich atoms ───────────────────────────────────────────────────────────

async function enrichAtoms(itemId) {
  const item = await ResearchItem.findById(itemId);
  if (!item || item.processingStatus !== 'enriching') {
    throw new Error(`Item ${itemId} not ready for enrichment`);
  }

  let enrichedCount = 0;

  for (const atomId of item.mappedAtoms) {
    try {
      await atomService.enrichResearchExtension(atomId, {
        openQuestions:    item.extractedQuestions,
        hypotheses:       item.extractedHypotheses,
        futureDirections: item.futureDirections,
        relatedPapers: [{
          title:   item.title,
          authors: item.authors,
          year:    item.publishedDate ? new Date(item.publishedDate).getFullYear() : null,
          doi:     item.doi,
          url:     item.url,
          summary: item.aiSummary,
          tags:    item.topicTags
        }]
      }, itemId.toString());

      await atomService.recomputeQuality(atomId);
      enrichedCount++;
    } catch (err) {
      console.error(`[research-pipeline] Failed to enrich atom ${atomId}:`, err.message);
    }
  }

  await ResearchItem.findByIdAndUpdate(itemId, {
    processingStatus: 'done',
    processedAt:      new Date(),
    enrichedAtoms:    enrichedCount
  });

  return { enrichedCount };
}

// ── 5. Full pipeline batch ────────────────────────────────────────────────────

/**
 * Process up to `batchSize` pending items through the full pipeline.
 * Safe to call on a cron job or queue trigger.
 */
async function runFullPipeline(batchSize = 5) {
  const pending = await ResearchItem.find({ processingStatus: { $in: ['pending', 'mapping', 'enriching'] } })
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .lean();

  const results = [];

  for (const item of pending) {
    try {
      if (item.processingStatus === 'pending') {
        await extractInsights(item._id);
        await mapToAtoms(item._id);
        const r = await enrichAtoms(item._id);
        results.push({ itemId: item._id, status: 'done', ...r });
      } else if (item.processingStatus === 'mapping') {
        await mapToAtoms(item._id);
        const r = await enrichAtoms(item._id);
        results.push({ itemId: item._id, status: 'done', ...r });
      } else if (item.processingStatus === 'enriching') {
        const r = await enrichAtoms(item._id);
        results.push({ itemId: item._id, status: 'done', ...r });
      }
    } catch (err) {
      results.push({ itemId: item._id, status: 'failed', error: err.message });
    }
  }

  return results;
}

// ── Queries ────────────────────────────────────────────────────────────────────

async function getByStatus(status, limit = 20) {
  return ResearchItem.find({ processingStatus: status })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getForAtom(atomId) {
  return ResearchItem.find({ mappedAtoms: atomId, processingStatus: 'done' })
    .sort({ createdAt: -1 })
    .lean();
}

module.exports = {
  ingestItems,
  addManualItem,
  extractInsights,
  mapToAtoms,
  enrichAtoms,
  runFullPipeline,
  getByStatus,
  getForAtom
};
