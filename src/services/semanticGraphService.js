'use strict';

/**
 * UCRS Semantic Graph Service — Phase 4 Intelligence Layer
 *
 * Read-only query layer that derives the living semantic knowledge graph from
 * existing collections (schedules, enrolments, UCE content, reference graph).
 *
 * NO new persistence. NO schema changes. Fully additive.
 *
 * Relationships modelled:
 *   Program → Section → ContentItem (from schedule.programTitle / sectionTitle / contentTitle)
 *   Instructor → Schedules → CIDs   (from schedule.instructorId / createdBy)
 *   Citizen → Enrolments → Schedules → CIDs
 *   CID → Categories (cross-category reuse)
 *   CID → Derived CIDs (via reference graph BFS)
 *
 * Public API:
 *   getProgramTree(programTitle, opts)     → Program→Section→Content hierarchy
 *   getContentReuse(cid)                   → all schedules using this CID, by category
 *   getInstructorContent(instructorId)     → all schedules + CIDs by instructor
 *   getEnrolmentMap(cid)                   → citizens enrolled via this CID
 *   getImpactReport(cid)                   → affected schedules, enrolments, programs, owners
 *   validateSemanticConsistency()          → orphaned refs, broken chains, title inconsistencies
 */

const UCRSSchedule    = require('../models/scheduleModel');
const UCRSEnrolment   = require('../models/enrolmentModel');
const UceContent      = require('../models/uceContentModel');
const { getAffectedContent } = require('./referenceGraphService');

// ── Task 1+3 — Program Tree ───────────────────────────────────────────────────

/**
 * Build the Program → Section → Content hierarchy from schedule metadata.
 *
 * @param {string}  programTitle
 * @param {object}  [opts]
 * @param {string}  [opts.category]        — filter to one category
 * @param {boolean} [opts.includeInactive] — include REVOKED/CANCELLED schedules
 * @returns {Promise<object>}
 */
async function getProgramTree(programTitle, { category = null, includeInactive = false } = {}) {
  if (!programTitle) throw Object.assign(new Error('programTitle is required'), { status: 400 });

  const match = { programTitle };
  if (category) match.category = category;
  if (!includeInactive) match.status = 'ACTIVE';

  const schedules = await UCRSSchedule.find(match, {
    scheduleId: 1, category: 1, sectionTitle: 1, contentTitle: 1,
    'contentRef.cid': 1, instructorId: 1, instructorName: 1,
    enrolmentCount: 1, scheduledDate: 1, status: 1,
  }).sort({ sectionTitle: 1, contentTitle: 1, scheduledDate: -1 }).lean();

  // Group into sections → content items → schedule instances
  const sectionMap = new Map();

  for (const s of schedules) {
    const sKey = s.sectionTitle || '(unsectioned)';
    if (!sectionMap.has(sKey)) sectionMap.set(sKey, new Map());

    const contentMap = sectionMap.get(sKey);
    const cid = s.contentRef?.cid || null;
    const cKey = `${s.contentTitle || ''}::${cid || 'no-cid'}`;

    if (!contentMap.has(cKey)) {
      contentMap.set(cKey, { contentTitle: s.contentTitle || null, cid, schedules: [] });
    }

    contentMap.get(cKey).schedules.push({
      scheduleId:    s.scheduleId,
      category:      s.category,
      instructorId:  s.instructorId,
      instructorName: s.instructorName,
      enrolmentCount: s.enrolmentCount,
      scheduledDate:  s.scheduledDate,
      status:         s.status,
    });
  }

  const sections = [];
  for (const [sectionTitle, contentMap] of sectionMap) {
    sections.push({ sectionTitle, contentItems: Array.from(contentMap.values()) });
  }

  const cidSet = new Set(schedules.map(s => s.contentRef?.cid).filter(Boolean));

  return {
    programTitle,
    filter: { category: category || 'all', includeInactive },
    totalSchedules: schedules.length,
    uniqueContentCids: [...cidSet],
    sections,
  };
}

// ── Task 2 — Content Reuse Intelligence ──────────────────────────────────────

/**
 * Where is this CID reused? Which categories, instructors, and programs schedule it?
 *
 * @param {string} cid
 * @returns {Promise<object>}
 */
async function getContentReuse(cid) {
  if (!cid) throw Object.assign(new Error('cid is required'), { status: 400 });

  const schedules = await UCRSSchedule.find(
    { 'contentRef.cid': cid },
    {
      scheduleId: 1, category: 1, programTitle: 1, sectionTitle: 1, contentTitle: 1,
      instructorId: 1, instructorName: 1, enrolmentCount: 1, scheduledDate: 1, status: 1, createdBy: 1,
    }
  ).sort({ scheduledDate: -1 }).lean();

  const byCategory = {};
  for (const s of schedules) {
    if (!byCategory[s.category]) byCategory[s.category] = [];
    byCategory[s.category].push(s);
  }

  const instructorSet = new Set(schedules.map(s => s.instructorId).filter(Boolean));
  const programSet    = new Set(schedules.map(s => s.programTitle));

  return {
    cid,
    totalSchedules: schedules.length,
    categories:     Object.keys(byCategory),
    instructors:    [...instructorSet],
    programs:       [...programSet],
    byCategory,
  };
}

/**
 * Which instructors are teaching the same or similar programTitle?
 * Scoped to a single title to avoid full-collection scans.
 *
 * @param {string} programTitle
 * @returns {Promise<object[]>}
 */
async function getInstructorsForProgram(programTitle) {
  const result = await UCRSSchedule.aggregate([
    { $match: { programTitle, status: 'ACTIVE', instructorId: { $ne: null } } },
    { $group: {
      _id: '$instructorId',
      instructorName:  { $first: '$instructorName' },
      categories:      { $addToSet: '$category' },
      uniqueCids:      { $addToSet: '$contentRef.cid' },
      totalEnrolments: { $sum: '$enrolmentCount' },
      scheduleCount:   { $sum: 1 },
    }},
    { $sort: { totalEnrolments: -1 } },
  ]);

  return result.map(r => ({
    instructorId:    r._id,
    instructorName:  r.instructorName,
    categories:      r.categories,
    uniqueCids:      r.uniqueCids.filter(Boolean),
    totalEnrolments: r.totalEnrolments,
    scheduleCount:   r.scheduleCount,
  }));
}

// ── Task 3 — Instructor Content Map ──────────────────────────────────────────

/**
 * All schedules and content CIDs associated with an instructor.
 * Matches both instructorId and createdBy (instructors who created their own schedules).
 *
 * @param {string} instructorId  — CB-prefixed UCRS citizen ID
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.page]
 * @returns {Promise<object>}
 */
async function getInstructorContent(instructorId, { limit = 50, page = 0 } = {}) {
  if (!instructorId) throw Object.assign(new Error('instructorId is required'), { status: 400 });

  const schedules = await UCRSSchedule.find(
    { $or: [{ instructorId }, { createdBy: instructorId }] },
    {
      scheduleId: 1, category: 1, programTitle: 1, sectionTitle: 1, contentTitle: 1,
      'contentRef.cid': 1, enrolmentCount: 1, scheduledDate: 1, status: 1,
    }
  ).sort({ scheduledDate: -1 }).skip(page * limit).limit(limit).lean();

  const cidSet = new Set(schedules.map(s => s.contentRef?.cid).filter(Boolean));
  const categorySet = new Set(schedules.map(s => s.category));

  return {
    instructorId,
    scheduleCount:    schedules.length,
    uniqueContentCids: [...cidSet],
    categories:       [...categorySet],
    schedules,
  };
}

// ── Enrolment Map ─────────────────────────────────────────────────────────────

/**
 * Which citizens are enrolled across all schedules using this CID?
 *
 * @param {string} cid
 * @returns {Promise<object>}
 */
async function getEnrolmentMap(cid) {
  if (!cid) throw Object.assign(new Error('cid is required'), { status: 400 });

  const schedules = await UCRSSchedule.find(
    { 'contentRef.cid': cid },
    { scheduleId: 1, category: 1, programTitle: 1, enrolmentCount: 1 }
  ).lean();

  if (!schedules.length) {
    return { cid, schedulesCount: 0, schedules: [], totalCitizens: 0, enrolments: [] };
  }

  const scheduleIds = schedules.map(s => s.scheduleId);
  const enrolments  = await UCRSEnrolment.find(
    { scheduleId: { $in: scheduleIds }, status: 'ACTIVE' },
    { citizenId: 1, scheduleId: 1, createdAt: 1 }
  ).lean();

  const citizenSet = new Set(enrolments.map(e => e.citizenId));

  return {
    cid,
    schedulesCount: schedules.length,
    schedules,
    totalCitizens:  citizenSet.size,
    enrolments,
  };
}

// ── Task 4 — Impact Analysis Engine ──────────────────────────────────────────

/**
 * Deterministic impact analysis: if this CID changes, what is affected?
 *
 * Returns:
 *   directImpact   — schedules and enrolments directly using this CID
 *   derivedImpact  — schedules using CIDs that derive from this one (BFS, depth 3)
 *   summary        — programs, categories, owners across all impact
 *
 * This is READ-ONLY. No writes, no side effects.
 *
 * @param {string} cid
 * @returns {Promise<object>}
 */
async function getImpactReport(cid) {
  if (!cid) throw Object.assign(new Error('cid is required'), { status: 400 });

  // Direct schedules using this CID
  const directSchedules = await UCRSSchedule.find(
    { 'contentRef.cid': cid },
    { scheduleId: 1, category: 1, programTitle: 1, createdBy: 1, enrolmentCount: 1, status: 1 }
  ).lean();

  const directScheduleIds = directSchedules.map(s => s.scheduleId);
  const directEnrolmentCount = directScheduleIds.length > 0
    ? await UCRSEnrolment.countDocuments({ scheduleId: { $in: directScheduleIds }, status: 'ACTIVE' })
    : 0;

  // CIDs that derive from this one (inbound BFS on the reference graph)
  const derivedCids = await getAffectedContent(cid, 3);
  const derivedCidValues = derivedCids.map(d => d.cid);

  let derivedSchedules = [];
  let derivedEnrolmentCount = 0;

  if (derivedCidValues.length > 0) {
    derivedSchedules = await UCRSSchedule.find(
      { 'contentRef.cid': { $in: derivedCidValues } },
      { scheduleId: 1, category: 1, programTitle: 1, 'contentRef.cid': 1, createdBy: 1 }
    ).lean();

    const derivedScheduleIds = derivedSchedules.map(s => s.scheduleId);
    if (derivedScheduleIds.length > 0) {
      derivedEnrolmentCount = await UCRSEnrolment.countDocuments({
        scheduleId: { $in: derivedScheduleIds },
        status:     'ACTIVE',
      });
    }
  }

  const allPrograms    = [...new Set([...directSchedules, ...derivedSchedules].map(s => s.programTitle))];
  const allCategories  = [...new Set([...directSchedules, ...derivedSchedules].map(s => s.category))];
  const allOwners      = [...new Set(directSchedules.map(s => s.createdBy).filter(Boolean))];

  return {
    cid,
    directImpact: {
      schedules:       directSchedules,
      enrolmentsAtRisk: directEnrolmentCount,
    },
    derivedImpact: {
      affectedCids:    derivedCids,
      schedules:       derivedSchedules,
      enrolmentsAtRisk: derivedEnrolmentCount,
    },
    summary: {
      totalSchedules:   directSchedules.length + derivedSchedules.length,
      totalEnrolmentsAtRisk: directEnrolmentCount + derivedEnrolmentCount,
      affectedPrograms:   allPrograms,
      affectedCategories: allCategories,
      affectedOwners:     allOwners,
    },
  };
}

// ── Task 5 — Semantic Consistency Validation ──────────────────────────────────

/**
 * Extended consistency validation for the semantic graph layer.
 *
 * Checks:
 *   1. Schedules referencing a CID with no matching uce_content doc (orphaned ref)
 *   2. Active schedules with no contentRef.cid (broken semantic link)
 *   3. Same (programTitle, sectionTitle, contentTitle) tuple mapped to different CIDs
 *      across categories (semantic title inconsistency — may indicate content drift)
 *   4. Active schedules with neither instructorId nor meaningful createdBy
 *
 * @returns {Promise<object>}
 */
async function validateSemanticConsistency() {
  // Check 1: schedule CID refs with no UCE content doc
  const schedulesWithCid = await UCRSSchedule.find(
    { 'contentRef.cid': { $ne: null } },
    { scheduleId: 1, 'contentRef.cid': 1, programTitle: 1, category: 1 }
  ).lean();

  let orphanedCidRefs = [];
  if (schedulesWithCid.length > 0) {
    const cidRefs = [...new Set(schedulesWithCid.map(s => s.contentRef.cid))];
    const existingContent = await UceContent.find({ cid: { $in: cidRefs } }, { cid: 1 }).lean();
    const existingCids    = new Set(existingContent.map(c => c.cid));
    const missingCids     = cidRefs.filter(c => !existingCids.has(c));
    orphanedCidRefs = schedulesWithCid.filter(s => missingCids.includes(s.contentRef.cid));
  }

  // Check 2: active schedules with no CID (incomplete semantic link)
  const noCidSchedules = await UCRSSchedule.find(
    {
      $or: [{ 'contentRef.cid': null }, { 'contentRef.cid': { $exists: false } }],
      status: 'ACTIVE',
    },
    { scheduleId: 1, programTitle: 1, category: 1 }
  ).lean();

  // Check 3: same title triple → different CIDs (semantic inconsistency)
  const titleInconsistencies = await UCRSSchedule.aggregate([
    { $match: { 'contentRef.cid': { $ne: null }, status: 'ACTIVE' } },
    { $group: {
      _id: {
        programTitle:  '$programTitle',
        sectionTitle:  '$sectionTitle',
        contentTitle:  '$contentTitle',
      },
      uniqueCids: { $addToSet: '$contentRef.cid' },
      categories: { $addToSet: '$category' },
      count:      { $sum: 1 },
    }},
    // More than one unique CID for the same title triple
    { $match: { 'uniqueCids.1': { $exists: true } } },
    { $sort: { count: -1 } },
  ]);

  // Check 4: active schedules missing ownership
  const missingOwnership = await UCRSSchedule.find(
    { instructorId: null, createdBy: null, status: 'ACTIVE' },
    { scheduleId: 1, programTitle: 1, category: 1 }
  ).lean();

  const healthy =
    orphanedCidRefs.length === 0 &&
    titleInconsistencies.length === 0;

  return {
    healthy,
    checks: {
      orphanedCidReferences: {
        count:  orphanedCidRefs.length,
        sample: orphanedCidRefs.slice(0, 10),
      },
      schedulesWithoutContentCid: {
        count:  noCidSchedules.length,
        sample: noCidSchedules.slice(0, 10),
      },
      semanticTitleInconsistencies: {
        count:  titleInconsistencies.length,
        // Each entry: { _id: { programTitle, sectionTitle, contentTitle }, uniqueCids, categories }
        sample: titleInconsistencies.slice(0, 10),
      },
      schedulesWithMissingOwnership: {
        count:  missingOwnership.length,
        sample: missingOwnership.slice(0, 10),
      },
    },
  };
}

module.exports = {
  getProgramTree,
  getContentReuse,
  getInstructorsForProgram,
  getInstructorContent,
  getEnrolmentMap,
  getImpactReport,
  validateSemanticConsistency,
};
