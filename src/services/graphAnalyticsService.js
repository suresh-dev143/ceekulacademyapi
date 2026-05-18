'use strict';

/**
 * UCRS Graph Analytics Service — Phase 7 Advanced Intelligence
 *
 * Aggregate metrics and analytics over the semantic knowledge graph.
 * Integrates with existing pedagogySignalService for content vitality.
 *
 * All queries are read-only. Results are computed on demand from live data.
 * For production at scale, add Redis caching with short TTL (5–15 min).
 *
 * Public API:
 *   getTopPrograms(opts)          — programs ranked by total enrolments
 *   getMostReusedContent(opts)    — CIDs used in the most schedules
 *   getInstructorReach(opts)      — instructors ranked by unique enrolled citizens
 *   getContentVelocity(opts)      — UCE commits per day over a window
 *   getCategoryDistribution()     — schedule + enrolment counts per category
 *   getSemanticDrift(logicalId)   — diff chain analysis across a content version chain
 *   exportCitizenAudit(citizenId) — structured audit timeline for a citizen (admin)
 */

const UCRSSchedule    = require('../models/scheduleModel');
const UCRSEnrolment   = require('../models/enrolmentModel');
const UceVersionRegistry = require('../models/uceVersionRegistryModel');
const UCRSEvent       = require('../models/ucrsEventModel');
const UCRSOutbox      = require('../models/ucrsOutboxModel');
const UceOutbox       = require('../models/uceOutboxModel');
const { computeVitality } = require('./pedagogySignalService');

// ── Top programs ──────────────────────────────────────────────────────────────

/**
 * @param {{ limit, category }} opts
 */
async function getTopPrograms({ limit = 20, category = null } = {}) {
  const match = { status: 'ACTIVE' };
  if (category) match.category = category;

  return UCRSSchedule.aggregate([
    { $match: match },
    { $group: {
      _id:             '$programTitle',
      totalEnrolments: { $sum: '$enrolmentCount' },
      scheduleCount:   { $sum: 1 },
      categories:      { $addToSet: '$category' },
      instructors:     { $addToSet: '$instructorId' },
      uniqueCids:      { $addToSet: '$contentRef.cid' },
    }},
    { $sort: { totalEnrolments: -1 } },
    { $limit: Math.min(limit, 100) },
    { $project: {
      programTitle:    '$_id',
      _id:             0,
      totalEnrolments: 1,
      scheduleCount:   1,
      categories:      1,
      instructorCount: { $size: { $filter: { input: '$instructors', cond: { $ne: ['$$this', null] } } } },
      uniqueCidCount:  { $size: { $filter: { input: '$uniqueCids',  cond: { $ne: ['$$this', null] } } } },
    }},
  ]);
}

// ── Most reused content ───────────────────────────────────────────────────────

/**
 * @param {{ limit }} opts
 */
async function getMostReusedContent({ limit = 20 } = {}) {
  const rows = await UCRSSchedule.aggregate([
    { $match: { 'contentRef.cid': { $ne: null } } },
    { $group: {
      _id:             '$contentRef.cid',
      scheduleCount:   { $sum: 1 },
      totalEnrolments: { $sum: '$enrolmentCount' },
      categories:      { $addToSet: '$category' },
      programs:        { $addToSet: '$programTitle' },
    }},
    { $sort: { scheduleCount: -1 } },
    { $limit: Math.min(limit, 100) },
  ]);

  const cids = rows.map(r => r._id);
  const vitality = cids.length ? await computeVitality(cids) : [];
  const vitalityMap = Object.fromEntries(vitality.map(v => [v.cid, v]));

  return rows.map(r => ({
    cid:             r._id,
    scheduleCount:   r.scheduleCount,
    totalEnrolments: r.totalEnrolments,
    categoryCount:   r.categories.length,
    programCount:    r.programs.length,
    vitality:        vitalityMap[r._id] || null,
  }));
}

// ── Instructor reach ──────────────────────────────────────────────────────────

/**
 * Unique enrolled citizens per instructor, across all their schedules.
 * @param {{ limit }} opts
 */
async function getInstructorReach({ limit = 20 } = {}) {
  // Step 1: group schedules by instructor
  const instructorSchedules = await UCRSSchedule.aggregate([
    { $match: { status: 'ACTIVE', instructorId: { $ne: null } } },
    { $group: {
      _id:           '$instructorId',
      instructorName: { $first: '$instructorName' },
      scheduleIds:   { $push: '$scheduleId' },
      scheduleCount: { $sum: 1 },
      programs:      { $addToSet: '$programTitle' },
      categories:    { $addToSet: '$category' },
    }},
    { $sort: { scheduleCount: -1 } },
    { $limit: Math.min(limit, 100) },
  ]);

  // Step 2: for each instructor, count unique enrolled citizens
  const results = await Promise.all(instructorSchedules.map(async (inst) => {
    const uniqueCitizens = await UCRSEnrolment.distinct('citizenId', {
      scheduleId: { $in: inst.scheduleIds },
      status:     'ACTIVE',
    });
    return {
      instructorId:   inst._id,
      instructorName: inst.instructorName,
      scheduleCount:  inst.scheduleCount,
      uniqueStudents: uniqueCitizens.length,
      programCount:   inst.programs.length,
      categories:     inst.categories,
    };
  }));

  return results.sort((a, b) => b.uniqueStudents - a.uniqueStudents);
}

// ── Content velocity ──────────────────────────────────────────────────────────

/**
 * UCE commits per day over the last N days.
 * @param {{ days }} opts
 */
async function getContentVelocity({ days = 30 } = {}) {
  const since = new Date(Date.now() - Math.min(days, 90) * 24 * 60 * 60 * 1000);

  return UceVersionRegistry.aggregate([
    { $match: { committedAt: { $gte: since } } },
    { $group: {
      _id: {
        year:        { $year:  '$committedAt' },
        month:       { $month: '$committedAt' },
        day:         { $dayOfMonth: '$committedAt' },
      },
      commits:     { $sum: 1 },
      contentTypes: { $addToSet: '$contentType' },
      newVersions: { $sum: { $cond: [{ $gt: ['$version', 1] }, 1, 0] } },
    }},
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    { $project: {
      _id:         0,
      date:        { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: '$_id.day' } },
      commits:     1,
      newVersions: 1,
      contentTypes: 1,
    }},
  ]);
}

// ── Category distribution ─────────────────────────────────────────────────────

async function getCategoryDistribution() {
  return UCRSSchedule.aggregate([
    { $group: {
      _id:             '$category',
      scheduleCount:   { $sum: 1 },
      totalEnrolments: { $sum: '$enrolmentCount' },
      activeCount:     { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
      uniquePrograms:  { $addToSet: '$programTitle' },
    }},
    { $sort: { totalEnrolments: -1 } },
    { $project: {
      category:        '$_id',
      _id:             0,
      scheduleCount:   1,
      activeCount:     1,
      totalEnrolments: 1,
      uniqueProgramCount: { $size: '$uniquePrograms' },
    }},
  ]);
}

// ── Semantic drift detection ───────────────────────────────────────────────────

/**
 * Analyze how a content's meaning has shifted across its version chain.
 * Uses the semantic diff stored on each version registry entry by the UCE pipeline.
 *
 * @param {string} logicalId
 */
async function getSemanticDrift(logicalId) {
  const chain = await UceVersionRegistry
    .find({ logicalId }, { cid: 1, version: 1, parentCid: 1, contentType: 1, committedAt: 1, diff: 1 })
    .sort({ version: 1 })
    .lean();

  if (!chain.length) {
    throw Object.assign(new Error('logicalId not found'), { status: 404 });
  }

  // Summarize drift: count fields changed across all versions
  const fieldChangeFrequency = {};
  let totalChanges = 0;

  for (const entry of chain) {
    if (!entry.diff) continue;
    const changed = Object.keys(entry.diff).filter(k => entry.diff[k]?.changed);
    totalChanges += changed.length;
    for (const field of changed) {
      fieldChangeFrequency[field] = (fieldChangeFrequency[field] || 0) + 1;
    }
  }

  const driftScore = chain.length > 1
    ? (totalChanges / ((chain.length - 1) * Math.max(Object.keys(fieldChangeFrequency).length, 1)))
    : 0;

  return {
    logicalId,
    versionCount:         chain.length,
    contentType:          chain[0]?.contentType,
    firstCommittedAt:     chain[0]?.committedAt,
    lastCommittedAt:      chain[chain.length - 1]?.committedAt,
    totalFieldChanges:    totalChanges,
    fieldChangeFrequency,
    driftScore:           Math.min(parseFloat(driftScore.toFixed(3)), 1),
    driftSignal:          driftScore > 0.7 ? 'high' : driftScore > 0.3 ? 'moderate' : 'low',
    versionChain:         chain.map(e => ({
      version:     e.version,
      cid:         e.cid,
      committedAt: e.committedAt,
      hasChanges:  !!e.diff,
      changedFields: e.diff ? Object.keys(e.diff).filter(k => e.diff[k]?.changed) : [],
    })),
  };
}

// ── Citizen audit export ──────────────────────────────────────────────────────

/**
 * Structured audit timeline for a citizen: all ledger events, enrolments,
 * and outbox entries as actor — chronologically sorted.
 *
 * @param {string} citizenId  — CB-prefixed UCRS citizen ID
 * @param {{ days }} opts
 */
async function exportCitizenAudit(citizenId, { days = 90 } = {}) {
  const since = new Date(Date.now() - Math.min(days, 365) * 24 * 60 * 60 * 1000);

  const [ledgerEvents, enrolments, ucrsOutboxEntries] = await Promise.all([
    UCRSEvent.find({ actorId: citizenId, occurredAt: { $gte: since } })
      .sort({ occurredAt: 1 })
      .select('eventId eventType resourceId subjectId payload traceId occurredAt')
      .lean(),
    UCRSEnrolment.find({ citizenId })
      .sort({ createdAt: 1 })
      .select('scheduleId status cancelledAt completedAt createdAt')
      .lean(),
    UCRSOutbox.find({ actorId: citizenId, createdAt: { $gte: since } })
      .sort({ createdAt: 1 })
      .select('eventId eventType entityType entityId contentCid status attempts createdAt processedAt')
      .lean(),
  ]);

  const timeline = [
    ...ledgerEvents.map(e => ({ source: 'ledger', occurredAt: e.occurredAt, ...e })),
    ...ucrsOutboxEntries.map(e => ({ source: 'ucrs_outbox', occurredAt: e.createdAt, ...e })),
  ].sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

  return {
    citizenId,
    exportedAt:      new Date(),
    windowDays:      days,
    enrolments,
    eventCount:      timeline.length,
    timeline,
  };
}

module.exports = {
  getTopPrograms,
  getMostReusedContent,
  getInstructorReach,
  getContentVelocity,
  getCategoryDistribution,
  getSemanticDrift,
  exportCitizenAudit,
};
