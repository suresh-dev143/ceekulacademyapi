'use strict';

/**
 * UCRS Enrolment Service
 *
 * Enrolment = UCRS policy tuple + thin display record.
 *
 * Authorization gate:
 *   policyService.grant({ subject: citizenId, relation: 'member', object: scheduleId })
 *
 * "Is CB001 enrolled?" →
 *   policyService.check({ actorId: 'CB001', action: 'read', resourceId: 'CP-SCHED01' })
 *   → Redis O(1)
 *
 * AI filter: lightweight coherence check on the enrolment context fields.
 */

const UCRSEnrolment   = require('../models/enrolmentModel');
const UCRSSchedule    = require('../models/scheduleModel');
const policyService   = require('./ucrsPolicyService');
const ledger          = require('./ucrsLedgerService');
const { runContentEvaluator } = require('./claudeService');

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enrol a citizen into a schedule.
 *
 * @param {string} citizenId   CB-prefixed UCRS entity ID
 * @param {string} scheduleId  CP-prefixed schedule entity ID
 * @param {object} [opts]
 * @param {string} [opts.selfCbId]  citizen-provided CB ID (optional field on Enrol page)
 */
async function enrol(citizenId, scheduleId, opts = {}) {
  const { selfCbId = null } = opts;

  // ── Validate schedule exists and is active ────────────────────────────────
  const schedule = await UCRSSchedule.findOne({ scheduleId, status: 'ACTIVE' }).lean();
  if (!schedule) throw Object.assign(new Error('Schedule not found or not active'), { status: 404 });

  // ── Capacity check ─────────────────────────────────────────────────────────
  if (schedule.capacity !== null && schedule.enrolmentCount >= schedule.capacity) {
    throw Object.assign(new Error('Schedule is at full capacity'), { status: 409 });
  }

  // ── Duplicate check (idempotent) ───────────────────────────────────────────
  const existing = await UCRSEnrolment.findOne({ citizenId, scheduleId }).lean();
  if (existing && existing.status === 'ACTIVE') {
    return { enrolment: existing, isDuplicate: true };
  }

  // ── AI Filter (lightweight — coherence of intent) ─────────────────────────
  let aiFlags = null;
  try {
    aiFlags = await runContentEvaluator({
      userId:   citizenId,
      title:    schedule.programTitle,
      subtitle: schedule.sectionTitle,
      snippet:  `Enrolment intent for ${schedule.category}: ${schedule.contentTitle}`,
    });
    if (aiFlags?.status === 'restrict') {
      throw Object.assign(new Error('Enrolment blocked by AI filter'), { status: 422, aiFlags });
    }
  } catch (err) {
    if (err.status === 422) throw err;
    aiFlags = null; // AI unavailable — allow
  }

  // ── Create enrolment record ────────────────────────────────────────────────
  const enrolment = await UCRSEnrolment.findOneAndUpdate(
    { citizenId, scheduleId },
    { citizenId, scheduleId, selfCbId, status: 'ACTIVE', aiFlags },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // ── Create UCRS policy tuple (authorization gate) ─────────────────────────
  await policyService.grant({
    subjectId:   citizenId,
    subjectType: 'citizen',
    relation:    'member',
    objectId:    scheduleId,
    objectType:  'process',
    createdBy:   'system',
    metadata:    { selfCbId, scheduleCategory: schedule.category },
  });

  // ── Increment enrolment count (atomic) ────────────────────────────────────
  await UCRSSchedule.updateOne({ scheduleId }, { $inc: { enrolmentCount: 1 } });

  // ── Emit ledger events ────────────────────────────────────────────────────
  ledger.emit({
    eventType:  'RELATIONSHIP_CREATED',
    actorId:    citizenId,
    actorType:  'citizen',
    subjectId:  citizenId,
    resourceId: scheduleId,
    payload:    { relation: 'member', category: schedule.category, selfCbId },
  }).catch(() => {});

  ledger.emit({
    eventType:  'PERMISSION_GRANTED',
    actorId:    'system',
    actorType:  'service',
    subjectId:  citizenId,
    resourceId: scheduleId,
    payload:    { action: 'enrolled', scheduleCategory: schedule.category },
  }).catch(() => {});

  return { enrolment, isDuplicate: false };
}

/**
 * Cancel an enrolment. Removes policy tuple + marks record CANCELLED.
 */
async function cancel(citizenId, scheduleId) {
  const enrolment = await UCRSEnrolment.findOneAndUpdate(
    { citizenId, scheduleId, status: 'ACTIVE' },
    { status: 'CANCELLED', cancelledAt: new Date() },
    { new: true }
  );
  if (!enrolment) throw Object.assign(new Error('Active enrolment not found'), { status: 404 });

  // Remove policy tuple (de-authorizes access)
  await policyService.revoke({
    subjectId: citizenId,
    relation:  'member',
    objectId:  scheduleId,
    createdBy: citizenId,
  });

  await UCRSSchedule.updateOne({ scheduleId }, { $inc: { enrolmentCount: -1 } });

  ledger.emit({
    eventType:  'RELATIONSHIP_REMOVED',
    actorId:    citizenId,
    actorType:  'citizen',
    resourceId: scheduleId,
    payload:    { relation: 'member', reason: 'cancelled' },
  }).catch(() => {});

  return enrolment;
}

/**
 * List all enrolments for the current citizen.
 */
async function myEnrolments(citizenId, { limit = 20, page = 0 } = {}) {
  const enrolments = await UCRSEnrolment
    .find({ citizenId, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .skip(page * limit)
    .limit(limit)
    .lean();

  // Hydrate with schedule details
  const ids = enrolments.map(e => e.scheduleId);
  const schedules = await UCRSSchedule.find({ scheduleId: { $in: ids } }).lean();
  const schedMap  = Object.fromEntries(schedules.map(s => [s.scheduleId, s]));

  return enrolments.map(e => ({ ...e, schedule: schedMap[e.scheduleId] ?? null }));
}

/**
 * Check if a citizen is enrolled (O(1) via policy tuple — Redis cached).
 */
async function isEnrolled(citizenId, scheduleId) {
  return policyService.check({ actorId: citizenId, action: 'read', resourceId: scheduleId });
}

module.exports = { enrol, cancel, myEnrolments, isEnrolled };
