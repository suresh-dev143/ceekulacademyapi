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
const { normalize, CONTENT_TYPES, NORMALIZER_VERSION } = require('./normalizerService');
const { generateCid }       = require('./cidGeneratorService');
const { runContentEvaluator } = require('./claudeService');
const UceContent            = require('../models/uceContentModel');
const UceVersionRegistry    = require('../models/uceVersionRegistryModel');
const UCRSCommit            = require('../models/ucrsCommitModel');
const ledger                = require('./ucrsLedgerService');
const { publishEvent, EVENT_TYPES } = require('./eventService');
const UceOutbox          = require('../models/uceOutboxModel');
const capabilityService  = require('./ucrsCapabilityService');
const referenceGraph     = require('./referenceGraphService');
const { computeDiff }    = require('./semanticDiffService');
const { matchAndNotifyCid } = require('./subscriptionService');

// ── Public API ────────────────────────────────────────────────────────────────

async function commit({ source, contentType, payload, ownerId, parentCid = null, trusted = false, traceId = null }) {

  // ── Step 1: Validate content type + capability membrane ──────────────────
  if (!CONTENT_TYPES.includes(contentType)) {
    throw Object.assign(
      new Error(`Invalid contentType "${contentType}". Valid: ${CONTENT_TYPES.join(', ')}`),
      { status: 400 }
    );
  }
  if (!ownerId) throw Object.assign(new Error('ownerId is required'), { status: 400 });

  // Capability check — UCRS entity IDs use CB prefix over the MongoDB ObjectId.
  // ENFORCE_CAPABILITY_GATE=true → hard 403 block.
  // Default (unset) → fail-open: log PERMISSION_DENIED but allow the write.
  // This lets the system instrument authorization state before enforcing it.
  const ucrsSubjectId = `CB${String(ownerId)}`;
  const cap = await capabilityService.resolveForRequest({
    subjectId:  ucrsSubjectId,
    action:     'write',
    resourceId: contentType,
  }).catch(() => null);

  if (!cap) {
    ledger.emit({
      eventType:  'PERMISSION_DENIED',
      actorId:    ucrsSubjectId,
      actorType:  'citizen',
      resourceId: contentType,
      payload:    { action: 'write', reason: 'no_active_capability', enforced: process.env.ENFORCE_CAPABILITY_GATE === 'true' },
      traceId,
    }).catch(() => {});

    if (process.env.ENFORCE_CAPABILITY_GATE === 'true') {
      throw Object.assign(
        new Error(`Write capability required for contentType "${contentType}"`),
        { status: 403 }
      );
    }
  }

  // ── Step 2: Normalize ─────────────────────────────────────────────────────
  const normalized = normalize(contentType, payload);

  // ── Step 3: Deduplication gate ────────────────────────────────────────────
  const cid = generateCid(normalized);

  const existing = await UceContent.findOne({ cid }).lean();
  if (existing) {
    const versionEntry = await UceVersionRegistry.findOne({ cid }).lean();
    // Fire-and-forget — dedup hit still recorded in ledger and event bus
    const dedupLogicalId = versionEntry?.logicalId ?? null;
    ledger.emit({
      eventType:  'CONTENT_COMMITTED',
      actorId:    String(ownerId),
      actorType:  'citizen',
      resourceId: cid,
      payload:    { fromDedupe: true, contentType, logicalId: dedupLogicalId },
      traceId,
    }).catch(() => {});
    UceOutbox.create({
      cid,
      eventType: EVENT_TYPES.CONTENT_COMMITTED,
      payload:   { cid, contentType, logicalId: dedupLogicalId, fromDedupe: true, status: existing.status, traceId },
    }).catch(() => publishEvent(EVENT_TYPES.CONTENT_COMMITTED, {
      cid, contentType, logicalId: dedupLogicalId, fromDedupe: true, status: existing.status, traceId,
    }).catch(() => {}));
    return {
      cid,
      version:           versionEntry?.version ?? 1,
      logicalId:         dedupLogicalId,
      status:            existing.status,
      aiFlags:           existing.aiFlags,
      fromDedupe:        true,
      capabilityVerified: !!cap,
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

  // ── Step 6: Version chain + semantic diff ────────────────────────────────
  let version   = 1;
  let logicalId;
  let diff      = null;

  if (parentCid) {
    // Fetch parent registry entry and parent payload in parallel — no serial latency.
    const [parentEntry, parentContent] = await Promise.all([
      UceVersionRegistry.findOne({ cid: parentCid }).lean(),
      UceContent.findOne({ cid: parentCid }, { payload: 1 }).lean(),
    ]);

    if (!parentEntry) {
      throw Object.assign(new Error(`parentCid "${parentCid}" not found in registry`), { status: 404 });
    }

    version   = parentEntry.version + 1;
    logicalId = parentEntry.logicalId;

    // Compute semantic diff if parent payload is available.
    // Non-fatal: a missing parent payload (should never happen) leaves diff null.
    if (parentContent?.payload) {
      try {
        diff = computeDiff(parentContent.payload, normalized);
      } catch {
        diff = null;
      }
    }
  } else {
    logicalId = uuidv4();
  }

  // ── Step 7: Persist ───────────────────────────────────────────────────────
  //
  // Outbox is written FIRST so that a process crash between the outbox write
  // and the content writes leaves a recoverable record. The outbox worker
  // verifies content exists before publishing — orphaned entries are marked
  // failed rather than emitting events for content that was never stored.
  //
  // If the outbox write itself fails (very rare transient MongoDB error) we
  // still proceed with content writes and fall back to direct publish.

  let outboxCreated = false;
  try {
    await UceOutbox.create({
      cid,
      eventType: EVENT_TYPES.CONTENT_COMMITTED,
      payload:   { cid, contentType, logicalId, version, fromDedupe: false, status, traceId },
    });
    outboxCreated = true;
  } catch {
    // Non-fatal — content writes proceed; direct publish is the fallback below
  }

  await UceVersionRegistry.create({
    cid,
    logicalId,
    parentCid: parentCid || null,
    version,
    contentType,
    ownerId,
    normalizerVersion: NORMALIZER_VERSION,
    diff,
  });

  const sizeBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');

  // Compensate if content write fails: remove the orphaned version registry entry
  // and mark the outbox entry as failed so the worker does not emit a ghost event.
  try {
    await UceContent.create({
      cid,
      contentType,
      payload: normalized,
      aiFlags,
      status,
      ownerId,
      sizeBytes,
    });
  } catch (contentErr) {
    await UceVersionRegistry.deleteOne({ cid }).catch(() => {});
    await UceOutbox.findOneAndUpdate(
      { cid, status: 'pending' },
      { status: 'failed', errorMessage: `content write failed: ${contentErr.message}` }
    ).catch(() => {});
    throw contentErr;
  }

  // Auto-register semantic lineage edge AFTER content is stored — the fromCid
  // must exist in uce_content before any graph query can resolve it.
  if (parentCid) {
    referenceGraph.addEdge({
      fromCid:  cid,
      toCid:    parentCid,
      edgeType: 'derives_from',
      ownerId,
    }).catch(() => {});

    // Notify citizens watching the parent CID that a new version was committed
    matchAndNotifyCid(cid, parentCid, ownerId).catch(() => {});
  }

  // Auto-bridge: create a thin UCRS commit record so every UCE content has an
  // interaction trace without requiring clients to call POST /api/ucrs manually.
  // commitId is deterministic (cid-based) so this is idempotent on retry.
  UCRSCommit.findOneAndUpdate(
    { commitId: `UCE-${cid}` },
    {
      commitId:    `UCE-${cid}`,
      type:        'content.committed',
      sessionRef:  source || 'uce-pipeline',
      speakerId:   `CB${String(ownerId)}`,
      speakerName: 'system',
      content:     '',
      semanticTags: [contentType],
      reference:   { refType: 'cid', value: cid },
      contentCid:  cid,
      metadata:    { version, logicalId, trusted, normalizerVersion: NORMALIZER_VERSION },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch(() => {});

  // Ledger: fire-and-forget (writes to MongoDB, already durable)
  ledger.emit({
    eventType:  'CONTENT_COMMITTED',
    actorId:    String(ownerId),
    actorType:  'citizen',
    resourceId: cid,
    payload:    { fromDedupe: false, contentType, logicalId, version, status },
    traceId,
  }).catch(() => {});

  // If the outbox write failed above, fall back to direct publish now that
  // content is safely stored.
  if (!outboxCreated) {
    publishEvent(EVENT_TYPES.CONTENT_COMMITTED, {
      cid, contentType, logicalId, version, fromDedupe: false, status, traceId,
    }).catch(() => {});
  }

  return { cid, version, logicalId, status, aiFlags, fromDedupe: false, capabilityVerified: !!cap };
}

// Full version history for a logicalId, newest first
async function getHistory(logicalId) {
  return UceVersionRegistry
    .find({ logicalId })
    .sort({ version: -1 })
    .lean();
}

/**
 * Startup orphan cleanup: finds uce_version_registry entries whose CID has no
 * corresponding uce_content document (caused by a process crash between the two writes).
 *
 * Only considers entries older than 60 seconds to avoid racing with in-flight commits.
 * Deletes orphaned registry entries and marks their outbox entries as failed.
 * Safe to call multiple times (idempotent).
 */
async function cleanupOrphanedRegistryEntries() {
  const cutoff = new Date(Date.now() - 60_000);
  const registryEntries = await UceVersionRegistry
    .find({ committedAt: { $lt: cutoff } }, { cid: 1 })
    .lean();

  if (!registryEntries.length) return { cleaned: 0 };

  const cids = registryEntries.map(e => e.cid);

  // Find which of these CIDs actually exist in uce_content
  const existingContent = await UceContent.find({ cid: { $in: cids } }, { cid: 1 }).lean();
  const existingCids = new Set(existingContent.map(c => c.cid));

  const orphanedCids = cids.filter(c => !existingCids.has(c));
  if (!orphanedCids.length) return { cleaned: 0 };

  console.warn(`[UCE] Orphan cleanup: removing ${orphanedCids.length} registry entries with no content:`, orphanedCids);

  await UceVersionRegistry.deleteMany({ cid: { $in: orphanedCids } });
  await UceOutbox.updateMany(
    { cid: { $in: orphanedCids }, status: { $in: ['pending', 'processing'] } },
    { status: 'failed', errorMessage: 'orphaned: content write never completed' }
  );

  return { cleaned: orphanedCids.length, orphanedCids };
}

module.exports = { commit, getHistory, cleanupOrphanedRegistryEntries, CONTENT_TYPES };
