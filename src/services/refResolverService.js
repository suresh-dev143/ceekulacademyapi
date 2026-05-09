'use strict';

/**
 * Reference Resolver Service
 *
 * Resolves a { contentRef: CID-or-logicalId, version? } pointer to full content.
 *
 * Cache layers:
 *   L1 — In-process LRU  (Map capped at 500 entries, ~zero latency)
 *   L2 — Redis           (TTL 1hr; optional — degrades gracefully if unavailable)
 *   L3 — MongoDB         (authoritative source)
 *
 * Content is immutable so cache entries are always correct — TTL is a memory
 * management tool, not a correctness mechanism.
 */

const UceContent         = require('../models/uceContentModel');
const UceVersionRegistry = require('../models/uceVersionRegistryModel');

// ── L1: In-process LRU (capped Map) ──────────────────────────────────────────

const L1_MAX = 500;
const _l1    = new Map(); // key → value; insertion order = LRU order

function _l1Get(key) { return _l1.get(key) ?? null; }

function _l1Set(key, value) {
  if (_l1.has(key)) _l1.delete(key); // refresh position
  _l1.set(key, value);
  if (_l1.size > L1_MAX) _l1.delete(_l1.keys().next().value); // evict oldest
}

// ── L2: Redis (lazy connect, optional) ───────────────────────────────────────

let _redis = null;
let _redisConnecting = false;

async function _getRedis() {
  if (_redis?.isReady) return _redis;
  if (_redisConnecting || !process.env.REDIS_URL) return null;

  try {
    _redisConnecting = true;
    const { createClient } = require('redis');
    _redis = createClient({ url: process.env.REDIS_URL });
    _redis.on('error', () => { _redis = null; _redisConnecting = false; });
    await _redis.connect();
    _redisConnecting = false;
    return _redis;
  } catch (_) {
    _redis = null;
    _redisConnecting = false;
    return null;
  }
}

// ── L3: MongoDB fetch ─────────────────────────────────────────────────────────

async function _fromMongo(contentRef, version) {
  let cid = contentRef;

  if (version) {
    // Resolve a specific version by logicalId or direct CID lookup
    const entry =
      await UceVersionRegistry.findOne({ logicalId: contentRef, version }).lean() ??
      await UceVersionRegistry.findOne({ cid: contentRef,       version }).lean();

    if (!entry) throw Object.assign(new Error('Content version not found'), { status: 404 });
    cid = entry.cid;
  } else {
    // Resolve latest: try direct CID first, then logicalId latest
    const directEntry = await UceVersionRegistry.findOne({ cid: contentRef }).lean();
    if (!directEntry) {
      const latestEntry = await UceVersionRegistry
        .findOne({ logicalId: contentRef })
        .sort({ version: -1 })
        .lean();
      if (!latestEntry) throw Object.assign(new Error('Content not found'), { status: 404 });
      cid = latestEntry.cid;
    }
    // else: cid is already correct
  }

  const doc = await UceContent.findOne({ cid }).lean();
  if (!doc) throw Object.assign(new Error('Content not found'), { status: 404 });
  if (doc.status === 'blocked') throw Object.assign(new Error('Content not available'), { status: 403 });

  return {
    cid:         doc.cid,
    contentType: doc.contentType,
    payload:     doc.payload,
    status:      doc.status,
    aiFlags:     doc.aiFlags,
    createdAt:   doc.createdAt,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

async function resolve({ contentRef, version } = {}) {
  if (!contentRef) throw Object.assign(new Error('contentRef is required'), { status: 400 });

  const cacheKey = `uce:${contentRef}:${version ?? 'latest'}`;

  // L1
  const l1hit = _l1Get(cacheKey);
  if (l1hit) return l1hit;

  // L2
  const r = await _getRedis();
  if (r) {
    try {
      const raw = await r.get(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        _l1Set(cacheKey, parsed);
        return parsed;
      }
    } catch (_) { /* Redis read failure — fall through to MongoDB */ }
  }

  // L3
  const result = await _fromMongo(contentRef, version);

  // Populate caches
  _l1Set(cacheKey, result);
  if (r) {
    try { await r.setEx(cacheKey, 3600, JSON.stringify(result)); } catch (_) {}
  }

  return result;
}

// Resolve an array of refs in parallel; errors per-ref are captured, not thrown
async function resolveMany(refs) {
  return Promise.all(
    refs.map(ref => resolve(ref).catch(err => ({ error: err.message, ref })))
  );
}

module.exports = { resolve, resolveMany };
