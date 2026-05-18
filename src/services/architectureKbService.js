'use strict';

/**
 * Architecture Knowledge Base Service
 *
 * Activates the architecture.spec / architecture.query / architecture.response
 * content types defined in the normalizer. All three pass through UCE so
 * dedup, versioning, and reference graph apply automatically.
 *
 * Cache economics:
 *   - architecture.spec  — committed once, referenced forever by CID.
 *   - architecture.query — same normalized question always produces the same
 *     CID (UCE dedup). Submitting an identical question twice hits the dedup
 *     gate at step 3 — zero Opus cost, same queryCid returned.
 *   - architecture.response — looked up by queryCid. If a response already
 *     exists for this queryCid, return it immediately — O(1), zero Opus cost.
 *     Only the first submission of a unique question reaches Opus.
 *
 * Public API:
 *   commitSpec(spec, ownerId)                  → { cid, version, fromDedupe }
 *   query({ promptId, title, queryText,
 *            specRefs, parentCid, ownerId,
 *            model })                           → { queryCid, responseCid, response,
 *                                                   fromCache, model, inputTokens, outputTokens }
 *   getSpecs({ domain })                       → [UceContent lean docs]
 *   getResponseForQuery(queryCid)              → UceContent lean doc | null
 *   listQueries({ limit, offset })             → [UceContent lean docs]
 */

const commitSvc   = require('./universalCommitService');
const UceContent  = require('../models/uceContentModel');
const AgentTask   = require('../models/agentTaskModel');
const { runArchitectureQuery } = require('./claudeService');

// ── Spec operations ───────────────────────────────────────────────────────────

async function commitSpec(spec, ownerId) {
  return commitSvc.commit({
    source:      'architecture-kb',
    contentType: 'architecture.spec',
    payload:     spec,
    ownerId,
    trusted:     true,
  });
}

async function getSpecs({ domain, limit = 20, offset = 0 } = {}) {
  const filter = { contentType: 'architecture.spec', status: 'approved' };
  if (domain) filter['payload.domain'] = domain.toLowerCase();

  const safeLimit  = Math.min(Math.max(1, parseInt(limit)  || 20), 100);
  const safeOffset = Math.max(0, parseInt(offset) || 0);

  const [specs, total] = await Promise.all([
    UceContent
      .find(filter, { cid: 1, 'payload.specId': 1, 'payload.title': 1, 'payload.domain': 1, 'payload.tags': 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .skip(safeOffset)
      .limit(safeLimit)
      .lean(),
    UceContent.countDocuments(filter),
  ]);

  return { specs, total, limit: safeLimit, offset: safeOffset };
}

async function getSpec(cid) {
  return UceContent.findOne(
    { cid, contentType: 'architecture.spec' },
    { cid: 1, payload: 1, createdAt: 1 }
  ).lean();
}

// ── Query + response ──────────────────────────────────────────────────────────

async function query({ promptId, title, queryText, specRefs = [], parentCid, ownerId, model }) {
  // ── Step 1: Commit the normalised query ──────────────────────────────────
  // Identical question text always produces the same CID via dedup.
  const queryResult = await commitSvc.commit({
    source:      'architecture-kb',
    contentType: 'architecture.query',
    payload: {
      promptId:  promptId || `prompt-${Date.now()}`,
      title:     title    || queryText.slice(0, 80),
      query:     queryText,
      specRefs:  specRefs || [],
      parentCid: parentCid || '',
      model:     model || 'claude-opus-4-7',
    },
    ownerId,
    trusted: true,
  });

  const queryCid = queryResult.cid;

  // ── Step 2: Cache check — O(1) if response already exists ────────────────
  // architecture.response documents store queryCid in their payload.
  // No compound index on payload.queryCid — document volume is low enough
  // that a contentType-filtered scan is fast. Add index if volume grows.
  const cached = await UceContent.findOne(
    { contentType: 'architecture.response', 'payload.queryCid': queryCid, status: 'approved' },
    { cid: 1, payload: 1 }
  ).lean();

  if (cached) {
    return {
      queryCid,
      responseCid:  cached.cid,
      response:     cached.payload.response,
      fromCache:    true,
      model:        cached.payload.model,
      inputTokens:  cached.payload.inputTokens,
      outputTokens: cached.payload.outputTokens,
    };
  }

  // ── Step 3: Fetch spec bodies for context ─────────────────────────────────
  let specContext = '';
  if (specRefs.length > 0) {
    const specs = await UceContent.find(
      { cid: { $in: specRefs }, contentType: 'architecture.spec' },
      { 'payload.title': 1, 'payload.body': 1, 'payload.specId': 1 }
    ).lean();

    specContext = specs
      .map(s => `## ${s.payload.title} (specId: ${s.payload.specId})\n${s.payload.body}`)
      .join('\n\n---\n\n');
  }

  // ── Step 4: Call Opus ─────────────────────────────────────────────────────
  const { taskId, response, inputTokens, outputTokens } = await runArchitectureQuery({
    queryText,
    specContext,
    model: model || 'claude-opus-4-7',
  });

  // ── Step 5: Commit the response ───────────────────────────────────────────
  // parentCid = queryCid so the reference graph auto-registers a derives_from edge.
  const responseResult = await commitSvc.commit({
    source:      'architecture-kb',
    contentType: 'architecture.response',
    payload: {
      queryCid,
      title:        `Response: ${title || queryText.slice(0, 60)}`,
      response,
      model:        model || 'claude-opus-4-7',
      inputTokens,
      outputTokens,
      keywords:     specRefs,
    },
    ownerId,
    parentCid: queryCid,
    trusted:   true,
  });

  // Close the semantic lineage loop: record the UCE CID of the committed response
  // back onto the AgentTask so agent_tasks.outputCid is never null for architecture queries.
  if (taskId) {
    AgentTask.findByIdAndUpdate(taskId, { outputCid: responseResult.cid }).catch(() => {});
  }

  return {
    queryCid,
    responseCid:  responseResult.cid,
    response,
    fromCache:    false,
    model:        model || 'claude-opus-4-7',
    inputTokens,
    outputTokens,
  };
}

async function getResponseForQuery(queryCid) {
  return UceContent.findOne(
    { contentType: 'architecture.response', 'payload.queryCid': queryCid, status: 'approved' },
    { cid: 1, payload: 1, createdAt: 1 }
  ).lean();
}

async function listQueries({ limit = 20, offset = 0 } = {}) {
  return UceContent
    .find({ contentType: 'architecture.query', status: 'approved' }, { cid: 1, payload: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(Math.min(limit, 100))
    .lean();
}

module.exports = { commitSpec, getSpecs, getSpec, query, getResponseForQuery, listQueries };
