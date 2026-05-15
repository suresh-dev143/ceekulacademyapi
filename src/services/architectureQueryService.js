'use strict';

/**
 * Architecture Query Service
 *
 * Cost-effective Opus 4.6 querying for Ceekul Mission architecture design.
 *
 * Three-stage cost strategy:
 *
 *   Stage 1 — UCRS dedup gate (free)
 *     Check if an architecture.response for this query CID already exists.
 *     If yes → return stored response. Zero Opus cost. O(1).
 *
 *   Stage 2 — Anthropic prompt caching (90% input cost reduction on cache hit)
 *     Static KB (committed to UCRS once via seedArchitectureKb.js) goes in
 *     the cached system block with cache_control: { type: 'ephemeral' }.
 *     Only the unique query (typically ~200 tokens) is the non-cached input.
 *     Cached prefix tokens cost 10% of normal input price.
 *
 *   Stage 3 — Commit response to UCRS (future dedup)
 *     After Opus runs, commit the response via UCE as architecture.response.
 *     Next time the IDENTICAL query is submitted, Stage 1 catches it.
 *
 * Result: first call pays full Opus cost; every repeat call is O(1) free.
 *
 * Public API:
 *   query({ promptId, title, queryText, specRefs, parentCid, ownerId })
 *     → { response, queryCid, responseCid, fromCache, usage }
 *
 *   buildCachedSystem(specBodies)
 *     → Anthropic system array with cache_control block
 */

const Anthropic = require('@anthropic-ai/sdk');
const { commit }       = require('./universalCommitService');
const { generateCid }  = require('./cidGeneratorService');
const { normalize }    = require('./normalizerService');
const UceContent       = require('../models/uceContentModel');
const AgentTask        = require('../models/agentTaskModel');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OPUS_MODEL      = 'claude-opus-4-6';
const SYSTEM_OWNER_ID = process.env.SYSTEM_OWNER_ID || 'system';

// ── Cached static system block ────────────────────────────────────────────────
// This is the shared architectural context that NEVER changes between queries.
// It maps 1:1 to the spec bodies committed via seedArchitectureKb.js.
// Anthropic caches this block for 5 minutes (ephemeral TTL).
// On cache hit: billed at 10% of normal input token price.

const CEEKUL_ARCHITECTURE_SYSTEM = `You are simultaneously:
- a distributed systems architect who has built planet-scale infrastructure,
- a governance futurist who has designed post-bureaucratic institutions,
- an AI civilization designer who thinks in decades not quarters,
- a grassroots systems designer who has lived in Indian villages,
- and a UX architect who believes interfaces are governance made visible.

You are designing Ceekul Mission — a Section 8 platform evolving into a
decentralized civilizational operating system.`;

// ── Spec body store (fetched once per process, keyed by specId) ───────────────
// Avoids repeated DB reads for the same spec within a server process lifetime.
const _specCache = new Map();

async function _fetchSpec(specId) {
  if (_specCache.has(specId)) return _specCache.get(specId);

  // Reconstruct the CID for this spec and look it up in UceContent
  const normalized = normalize('architecture.spec', {
    specId,
    title:    '',
    version:  '1.0.0',
    body:     '',
    keywords: [],
    domain:   'governance',
  });
  // We can't regenerate the CID without the original body, so we query by payload.specId
  const doc = await UceContent.findOne({ 'payload.specId': specId }).lean();
  if (!doc) return null;

  const body = doc.payload.body || '';
  _specCache.set(specId, body);
  return body;
}

// ── Build the Anthropic system array with prompt caching ─────────────────────
// The static KB goes in the first block marked cache_control: ephemeral.
// Anthropic caches everything UP TO AND INCLUDING the last cache_control block.
// The second block (query instructions) is NOT cached — it changes per query.

async function buildCachedSystem(specRefs = []) {
  const specBodies = await Promise.all(specRefs.map(_fetchSpec));
  const knowledgeBase = specBodies.filter(Boolean).join('\n\n---\n\n');

  const cachedBlock = knowledgeBase
    ? `${CEEKUL_ARCHITECTURE_SYSTEM}\n\n` +
      `═══ CEEKUL MISSION ARCHITECTURE KNOWLEDGE BASE ═══\n\n` +
      knowledgeBase
    : CEEKUL_ARCHITECTURE_SYSTEM;

  return [
    // Block 1 — CACHED (static KB, billed at 10% on cache hit)
    {
      type: 'text',
      text: cachedBlock,
      cache_control: { type: 'ephemeral' },
    },
    // Block 2 — NOT cached (query-specific instructions)
    {
      type: 'text',
      text: `RESPONSE REQUIREMENTS:
- For each architectural dimension: core concept → structured design → implementation logic → future evolution
- Be technically precise and implementation-ready
- Think at civilizational scale
- Structure your response with clear headers
- No generic suggestions — every recommendation must be grounded in the Ceekul context above`,
    },
  ];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run an architecture query with full cost optimization.
 *
 * @param {object} p
 * @param {string}   p.promptId    e.g. 'prompt-01-governance'
 * @param {string}   p.title       short human-readable title
 * @param {string}   p.queryText   the unique architectural question (keep concise)
 * @param {string[]} p.specRefs    specIds to include in cached context
 *                                 e.g. ['governance-roles', 'cg-page-architecture']
 * @param {string}  [p.parentCid]  CID of previous query in the chain
 * @param {string}  [p.ownerId]    CB ID of requester
 * @param {number}  [p.maxTokens]  default 8192
 */
async function query({
  promptId,
  title,
  queryText,
  specRefs = [],
  parentCid = null,
  ownerId = SYSTEM_OWNER_ID,
  maxTokens = 8192,
}) {

  // ── Stage 1: Check UCRS for existing response ─────────────────────────────
  // Normalize the query to get its deterministic CID
  const queryNormalized = normalize('architecture.query', {
    promptId,
    title,
    query:     queryText,
    specRefs,
    parentCid: parentCid || '',
    model:     OPUS_MODEL,
  });
  const queryCid = generateCid(queryNormalized);

  // Look for a committed response to this exact query
  const existingResponse = await UceContent.findOne({
    contentType: 'architecture.response',
    'payload.queryCid': queryCid,
    status: 'approved',
  }).lean();

  if (existingResponse) {
    return {
      response:    existingResponse.payload.response,
      queryCid,
      responseCid: existingResponse.cid,
      fromCache:   true,
      usage:       { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    };
  }

  // ── Stage 2: Commit the query itself via UCE ──────────────────────────────
  await commit({
    source:      'architecture.query',
    contentType: 'architecture.query',
    payload:     { promptId, title, query: queryText, specRefs, parentCid: parentCid || '', model: OPUS_MODEL },
    ownerId,
    parentCid,
    trusted:     true,
  }).catch(() => { /* non-blocking — query record is informational */ });

  // ── Stage 3: Build cached system and call Opus ────────────────────────────
  const systemBlocks = await buildCachedSystem(specRefs);

  const t0   = Date.now();
  const task = await AgentTask.create({
    agentType: 'architecture_query',
    userId:    ownerId,
    sessionId: `arch_${promptId}_${Date.now()}`,
    prompt:    queryText,
    context:   { promptId, specRefs, parentCid },
    status:    'running',
  });

  let opusResponse, usage;

  try {
    const msg = await client.messages.create({
      model:      OPUS_MODEL,
      max_tokens: maxTokens,
      system:     systemBlocks,
      messages:   [{ role: 'user', content: queryText }],
    });

    opusResponse = msg.content.find(b => b.type === 'text')?.text?.trim() ?? '';
    usage = {
      inputTokens:      msg.usage.input_tokens,
      outputTokens:     msg.usage.output_tokens,
      cacheCreatedTokens: msg.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens:  msg.usage.cache_read_input_tokens ?? 0,
    };

    const latencyMs = Date.now() - t0;
    const cost = (usage.inputTokens + usage.outputTokens) * 0.000009;

    await AgentTask.findByIdAndUpdate(task._id, {
      response:    opusResponse.slice(0, 500),
      tokensIn:    usage.inputTokens,
      tokensOut:   usage.outputTokens,
      latencyMs,
      costNeurons: cost,
      status:      'done',
    });

  } catch (err) {
    await AgentTask.findByIdAndUpdate(task._id, { status: 'failed', error: err.message });
    throw err;
  }

  // ── Stage 4: Commit response to UCRS (dedup future identical queries) ─────
  const { cid: responseCid } = await commit({
    source:      'architecture.response',
    contentType: 'architecture.response',
    payload: {
      queryCid,
      title,
      response:    opusResponse,
      model:       OPUS_MODEL,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      keywords:    _extractKeywords(title + ' ' + queryText),
    },
    ownerId,
    parentCid: queryCid,
    trusted:   true,
  });

  return {
    response:    opusResponse,
    queryCid,
    responseCid,
    fromCache:   false,
    usage,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function _extractKeywords(text) {
  const stop = new Set(['that','this','with','from','have','will','been','were','they','their',
    'what','when','your','more','about','than','would','could','should','which','there',
    'these','those','then','design','system','architecture','ceekul','mission']);
  return [...new Set((text.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? []))
    .filter(w => !stop.has(w))].slice(0, 8);
}

module.exports = { query, buildCachedSystem };
