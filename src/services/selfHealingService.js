'use strict';

/**
 * UCRS Self-Healing Service — Phase 5 Resilience Layer
 *
 * Detects and repairs inconsistencies in the UCRS/UCE system without
 * touching immutable records (ledger events are never modified).
 *
 * Healing operates on:
 *   - Outbox entries stuck in 'processing' (crashed worker recovery)
 *   - Missing UCE→UCRS commit bridge records
 *   - Orphaned enrolments (active enrolment for a REVOKED schedule)
 *
 * Non-destructive rules:
 *   - Never delete ledger (ucrs_events) records — they are immutable by design
 *   - Never delete uce_content or uce_version_registry records
 *   - Only create missing links or reset stuck state — never destroy history
 *   - Orphaned enrolments are reported but NOT auto-cancelled (business decision)
 *
 * Public API:
 *   runFullHeal()               → runs all checks and returns a heal report
 *   healStuckOutboxEntries()    → resets both outbox collections' stuck entries
 *   detectOrphanedEnrolments()  → reports active enrolments for REVOKED schedules
 *   repairMissingCommitBridge() → creates UCRSCommit records for UCE content
 *                                 that has no bridge commit yet
 */

const UCRSOutbox        = require('../models/ucrsOutboxModel');
const UceOutbox         = require('../models/uceOutboxModel');
const UCRSSchedule      = require('../models/scheduleModel');
const UCRSEnrolment     = require('../models/enrolmentModel');
const UceContent        = require('../models/uceContentModel');
const UceVersionRegistry = require('../models/uceVersionRegistryModel');
const UCRSCommit        = require('../models/ucrsCommitModel');

const STALE_THRESHOLD_MS  = 5 * 60 * 1000;  // entries stuck > 5 min are stale
const BRIDGE_BATCH_LIMIT  = 200;             // max bridge repairs per run
const NORMALIZER_VERSION  = require('./normalizerService').NORMALIZER_VERSION;

// ── Task 1: Stuck outbox recovery ─────────────────────────────────────────────

/**
 * Reset outbox entries left in 'processing' by a crashed worker.
 * Applies to both ucrs_outbox (UCRS events) and uce_outbox (UCE commits).
 *
 * @returns {{ ucrsReset: number, uceReset: number }}
 */
async function healStuckOutboxEntries() {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const [ucrsResult, uceResult] = await Promise.all([
    UCRSOutbox.updateMany(
      { status: 'processing', lastAttemptAt: { $lt: staleThreshold } },
      { $set: { status: 'pending', errorMessage: 'reset by self-healer: stale processing entry' } }
    ),
    UceOutbox.updateMany(
      { status: 'processing', lastAttemptAt: { $lt: staleThreshold } },
      { $set: { status: 'pending', errorMessage: 'reset by self-healer: stale processing entry' } }
    ),
  ]);

  return {
    ucrsReset: ucrsResult.modifiedCount,
    uceReset:  uceResult.modifiedCount,
  };
}

// ── Task 2: Orphaned enrolment detection ──────────────────────────────────────

/**
 * Find active enrolments for schedules that are no longer ACTIVE.
 * Returns report only — does NOT auto-cancel (business decision belongs to caller).
 *
 * @returns {{ count: number, sample: object[] }}
 */
async function detectOrphanedEnrolments() {
  // Batch: collect all scheduleIds that have active enrolments
  const activeEnrolments = await UCRSEnrolment.find(
    { status: 'ACTIVE' },
    { citizenId: 1, scheduleId: 1 }
  ).limit(5_000).lean();

  if (!activeEnrolments.length) return { count: 0, sample: [] };

  const scheduleIds = [...new Set(activeEnrolments.map(e => e.scheduleId))];

  // Find which of those schedules are not ACTIVE
  const inactiveSchedules = await UCRSSchedule.find(
    { scheduleId: { $in: scheduleIds }, status: { $ne: 'ACTIVE' } },
    { scheduleId: 1, status: 1, programTitle: 1 }
  ).lean();

  if (!inactiveSchedules.length) return { count: 0, sample: [] };

  const inactiveIds = new Set(inactiveSchedules.map(s => s.scheduleId));
  const orphaned = activeEnrolments.filter(e => inactiveIds.has(e.scheduleId));

  const schedMap = Object.fromEntries(inactiveSchedules.map(s => [s.scheduleId, s]));
  const decorated = orphaned.map(e => ({
    citizenId:     e.citizenId,
    scheduleId:    e.scheduleId,
    scheduleStatus: schedMap[e.scheduleId]?.status,
    programTitle:  schedMap[e.scheduleId]?.programTitle,
  }));

  return {
    count:  orphaned.length,
    sample: decorated.slice(0, 20),
  };
}

// ── Task 3: UCE→UCRS commit bridge repair ────────────────────────────────────

/**
 * Every UCE content commit should have a thin UCRSCommit bridge record
 * (commitId: `UCE-{cid}`). This is normally created by universalCommitService,
 * but if the process crashed after UceContent.create and before the bridge
 * write, the bridge is missing.
 *
 * Repair: create the missing bridge records for content docs that have a
 * version registry entry but no UCRSCommit bridge.
 *
 * Safe: UCRSCommit.findOneAndUpdate with upsert=true is idempotent.
 *
 * @returns {{ checked: number, repaired: number, sample: string[] }}
 */
async function repairMissingCommitBridge() {
  // Only check recent content (last 7 days) to keep this tractable
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const registryEntries = await UceVersionRegistry
    .find({ committedAt: { $gte: since } }, { cid: 1, logicalId: 1, version: 1, contentType: 1, ownerId: 1 })
    .limit(BRIDGE_BATCH_LIMIT)
    .lean();

  if (!registryEntries.length) return { checked: 0, repaired: 0, sample: [] };

  const cids = registryEntries.map(e => e.cid);
  const commitIds = cids.map(c => `UCE-${c}`);

  // Find which bridge commits already exist
  const existingBridges = await UCRSCommit.find(
    { commitId: { $in: commitIds } },
    { commitId: 1 }
  ).lean();

  const existingSet = new Set(existingBridges.map(b => b.commitId));
  const missing = registryEntries.filter(e => !existingSet.has(`UCE-${e.cid}`));

  if (!missing.length) return { checked: registryEntries.length, repaired: 0, sample: [] };

  const repairedCids = [];

  for (const entry of missing) {
    try {
      await UCRSCommit.findOneAndUpdate(
        { commitId: `UCE-${entry.cid}` },
        {
          commitId:    `UCE-${entry.cid}`,
          type:        'content.committed',
          sessionRef:  'uce-pipeline',
          speakerId:   `CB${String(entry.ownerId)}`,
          speakerName: 'system',
          content:     '',
          semanticTags: [entry.contentType || 'unknown'],
          reference:   { refType: 'cid', value: entry.cid },
          contentCid:  entry.cid,
          metadata:    {
            version:           entry.version,
            logicalId:         entry.logicalId,
            trusted:           false,
            normalizerVersion: NORMALIZER_VERSION,
            repairedBy:        'self-healer',
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
      repairedCids.push(entry.cid);
    } catch {
      // Non-fatal: log failure but continue repairing the rest
    }
  }

  return {
    checked:  registryEntries.length,
    repaired: repairedCids.length,
    sample:   repairedCids.slice(0, 10),
  };
}

// ── Outbox observability snapshot ─────────────────────────────────────────────

/**
 * Return current counts and latency stats for both outbox collections.
 * Used by the events health endpoint (Task 6).
 *
 * @returns {Promise<object>}
 */
async function getOutboxStats() {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const [
    ucrsPending, ucrsProcessing, ucrsProcessed, ucrsFailed,
    ucrsStuck,
    ucePending, uceProcessing, uceProcessed, uceFailed,
    uceStuck,
    avgLatency,
  ] = await Promise.all([
    UCRSOutbox.countDocuments({ status: 'pending' }),
    UCRSOutbox.countDocuments({ status: 'processing' }),
    UCRSOutbox.countDocuments({ status: 'processed' }),
    UCRSOutbox.countDocuments({ status: 'failed' }),
    UCRSOutbox.countDocuments({ status: 'processing', lastAttemptAt: { $lt: staleThreshold } }),
    UceOutbox.countDocuments({ status: 'pending' }),
    UceOutbox.countDocuments({ status: 'processing' }),
    UceOutbox.countDocuments({ status: 'processed' }),
    UceOutbox.countDocuments({ status: 'failed' }),
    UceOutbox.countDocuments({ status: 'processing', lastAttemptAt: { $lt: staleThreshold } }),
    UCRSOutbox.aggregate([
      { $match: { status: 'processed', processingLatencyMs: { $ne: null } } },
      { $group: {
        _id:     '$eventType',
        avgMs:   { $avg: '$processingLatencyMs' },
        minMs:   { $min: '$processingLatencyMs' },
        maxMs:   { $max: '$processingLatencyMs' },
        count:   { $sum: 1 },
      }},
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    ucrsOutbox: {
      pending: ucrsPending, processing: ucrsProcessing,
      processed: ucrsProcessed, failed: ucrsFailed, stuck: ucrsStuck,
    },
    uceOutbox: {
      pending: ucePending, processing: uceProcessing,
      processed: uceProcessed, failed: uceFailed, stuck: uceStuck,
    },
    latencyByEventType: avgLatency,
    healthy: ucrsFailed === 0 && uceFailed === 0 && ucrsStuck === 0 && uceStuck === 0,
  };
}

// ── Full healing run ──────────────────────────────────────────────────────────

/**
 * Run all healing checks and return a consolidated report.
 * Safe to call repeatedly — all operations are idempotent.
 *
 * @returns {Promise<object>} heal report
 */
async function runFullHeal() {
  const startedAt = new Date();

  const [stuckResult, orphanResult, bridgeResult] = await Promise.all([
    healStuckOutboxEntries(),
    detectOrphanedEnrolments(),
    repairMissingCommitBridge(),
  ]);

  const durationMs = Date.now() - startedAt.getTime();

  const report = {
    ranAt:     startedAt,
    durationMs,
    stuckOutboxRecovery: stuckResult,
    orphanedEnrolments:  orphanResult,
    commitBridgeRepair:  bridgeResult,
    actionRequired:
      orphanResult.count > 0
        ? `${orphanResult.count} active enrolment(s) exist for non-ACTIVE schedules — manual review recommended`
        : null,
  };

  const hasIssues = stuckResult.ucrsReset > 0 || stuckResult.uceReset > 0 ||
    orphanResult.count > 0 || bridgeResult.repaired > 0;

  if (hasIssues) {
    console.log('[SelfHealer] Heal completed with actions:', JSON.stringify({
      stuckReset: stuckResult,
      orphanedEnrolments: orphanResult.count,
      bridgeRepairs: bridgeResult.repaired,
    }));
  }

  return report;
}

module.exports = {
  runFullHeal,
  healStuckOutboxEntries,
  detectOrphanedEnrolments,
  repairMissingCommitBridge,
  getOutboxStats,
};
