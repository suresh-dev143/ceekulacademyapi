'use strict';

/**
 * Universal Commit Engine (UCE)
 *
 * The single write path for all content in the UCRS system.
 * No content reaches the store without passing through this pipeline:
 *
 *   1. Validate contentType
 *   2. Normalize  → deterministic canonical form
 *   3. Dedup gate → if CID already exists, return immediately (zero AI cost)
 *   4. AI Filter  → runContentEvaluator (Haiku, one call per unique content)
 *   5. Hard block → throw 422 if status = 'blocked'
 *   6. Version    → resolve logicalId + version number
 *   7. Store      → write to uce_version_registry + uce_content (atomic-ish)
 *
 * Returns: { cid, version, logicalId, status, aiFlags, fromDedupe }
 */

const { v4: uuidv4 }        = require('uuid');
const { normalize, CONTENT_TYPES } = require('./normalizerService');
const { generateCid }       = require('./cidGeneratorService');
const { runContentEvaluator } = require('./claudeService');
const UceContent            = require('../models/uceContentModel');
const UceVersionRegistry    = require('../models/uceVersionRegistryModel');
const ledger                = require('./ucrsLedgerService');

// ── Public API ────────────────────────────────────────────────────────────────

async function commit({ source, contentType, payload, ownerId, parentCid = null, trusted = false }) {

  // ── Step 1: Validate content type ─────────────────────────────────────────
  if (!CONTENT_TYPES.includes(contentType)) {
    throw Object.assign(
      new Error(`Invalid contentType "${contentType}". Valid: ${CONTENT_TYPES.join(', ')}`),
      { status: 400 }
    );
  }
  if (!ownerId) throw Object.assign(new Error('ownerId is required'), { status: 400 });

  // ── Step 2: Normalize ─────────────────────────────────────────────────────
  const normalized = normalize(contentType, payload);

  // ── Step 3: Deduplication gate ────────────────────────────────────────────
  const cid = generateCid(normalized);

  const existing = await UceContent.findOne({ cid }).lean();
  if (existing) {
    const versionEntry = await UceVersionRegistry.findOne({ cid }).lean();
    // Fire-and-forget — dedup hit still recorded in ledger
    ledger.emit({
      eventType:  'CONTENT_COMMITTED',
      actorId:    String(ownerId),
      actorType:  'citizen',
      resourceId: cid,
      payload:    { fromDedupe: true, contentType, logicalId: versionEntry?.logicalId ?? null },
    }).catch(() => {});
    return {
      cid,
      version:   versionEntry?.version   ?? 1,
      logicalId: versionEntry?.logicalId ?? null,
      status:    existing.status,
      aiFlags:   existing.aiFlags,
      fromDedupe: true,
    };
  }

  // ── Step 4: AI Filter (runs once per unique content) ──────────────────────
  // trusted=true skips AI evaluation for internally-generated system events
  let aiFlags = null;
  let status  = 'pending_review';

  if (trusted) {
    status = 'approved';
  } else {
    try {
      aiFlags = await runContentEvaluator({
        userId:   String(ownerId),
        title:    normalized.title,
        subtitle: normalized.subtitle,
        snippet:  (normalized.body || '').slice(0, 1000),
      });

      status = aiFlags.status === 'allow'    ? 'approved'
             : aiFlags.status === 'restrict' ? 'blocked'
             :                                 'pending_review';
    } catch (_err) {
      // AI unavailable — queue for human moderation, never crash the commit
      status  = 'pending_review';
      aiFlags = null;
    }

    // ── Step 5: Hard block ──────────────────────────────────────────────────
    if (status === 'blocked') {
      throw Object.assign(
        new Error('Content blocked: ' + (aiFlags?.routing?.reason || 'policy violation')),
        { status: 422, aiFlags }
      );
    }
  }

  // ── Step 6: Version chain ─────────────────────────────────────────────────
  let version   = 1;
  let logicalId;

  if (parentCid) {
    const parentEntry = await UceVersionRegistry.findOne({ cid: parentCid }).lean();
    if (!parentEntry) {
      throw Object.assign(new Error(`parentCid "${parentCid}" not found in registry`), { status: 404 });
    }
    version   = parentEntry.version + 1;
    logicalId = parentEntry.logicalId;
  } else {
    logicalId = uuidv4();
  }

  // ── Step 7: Persist (registry first, then content) ────────────────────────
  await UceVersionRegistry.create({
    cid,
    logicalId,
    parentCid: parentCid || null,
    version,
    contentType,
    ownerId,
  });

  const sizeBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');

  await UceContent.create({
    cid,
    contentType,
    payload: normalized,
    aiFlags,
    status,
    ownerId,
    sizeBytes,
  });

  // Fire-and-forget ledger entry for new unique content
  ledger.emit({
    eventType:  'CONTENT_COMMITTED',
    actorId:    String(ownerId),
    actorType:  'citizen',
    resourceId: cid,
    payload:    { fromDedupe: false, contentType, logicalId, version, status },
  }).catch(() => {});

  return { cid, version, logicalId, status, aiFlags, fromDedupe: false };
}

// Full version history for a logicalId, newest first
async function getHistory(logicalId) {
  return UceVersionRegistry
    .find({ logicalId })
    .sort({ version: -1 })
    .lean();
}

module.exports = { commit, getHistory, CONTENT_TYPES };
