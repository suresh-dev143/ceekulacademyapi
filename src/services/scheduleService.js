'use strict';

/**
 * UCRS Schedule Service
 *
 * AI-filtered, UCRS-compatible scheduling engine.
 *
 * Write pipeline (mirrors UCE):
 *   1. Validate   — required fields, date/time sanity, no past dates
 *   2. Normalize  — canonical form (trimmed, lowercase category, IANA timezone)
 *   3. AI Filter  — Claude Haiku: contextual coherence, abuse, spam (one call per unique)
 *   4. Hard block — 422 if flagged
 *   5. Dedup gate — same (createdBy + category + contentCid + date + startTime) = reject
 *   6. Store      — write DB + emit ledger events
 *
 * Authorization: enforced in the router via ucrsVerify middleware.
 * All policy tuple operations are delegated to ucrsPolicyService.
 */

const crypto          = require('crypto');
const { v4: uuidv4 } = require('uuid');
const UCRSSchedule    = require('../models/scheduleModel');
const UCRSOutbox      = require('../models/ucrsOutboxModel');
const ledger          = require('./ucrsLedgerService');
const { runContentEvaluator } = require('./claudeService');
const { matchAndNotify } = require('./subscriptionService');

// ── Internal helpers ──────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function buildScheduleId(createdBy, category, contentCid, date, startTime) {
  const seed = `${createdBy}:${category}:${contentCid || ''}:${date}:${startTime}`;
  return `CP${sha256(seed).slice(0, 12).toUpperCase()}`;
}

function buildIntegrityHash({ scheduleId, category, programTitle, createdBy, date, startTime }) {
  return sha256(JSON.stringify({ scheduleId, category, programTitle, createdBy, date, startTime }));
}

function validateTime(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em > sh * 60 + sm;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a schedule.
 *
 * @param {string} creatorId   CB-prefixed UCRS entity ID
 * @param {object} data        form fields
 */
async function createSchedule(creatorId, data) {
  const {
    category, programTitle, sectionTitle = '', contentTitle = '',
    contentRef = {}, instructorId = null, instructorName = null,
    scheduledDate, startTime, endTime,
    timezone = 'Asia/Kolkata', deliveryMode = 'online', capacity = null,
    fee = 0, streamingFee = 0, streamingPlatform = null, workshopHour = null,
    contentDescription = {}, expertProfile = {},
  } = data;

  // ── Step 1: Validate ───────────────────────────────────────────────────────
  if (!category || !programTitle || !scheduledDate || !startTime || !endTime) {
    throw Object.assign(new Error('category, programTitle, scheduledDate, startTime, endTime are required'), { status: 400 });
  }

  const schedDate = new Date(scheduledDate);
  if (isNaN(schedDate.getTime())) throw Object.assign(new Error('Invalid scheduledDate'), { status: 400 });
  if (schedDate < new Date(new Date().setHours(0, 0, 0, 0))) {
    throw Object.assign(new Error('Cannot schedule in the past'), { status: 400 });
  }
  if (!validateTime(startTime, endTime)) {
    throw Object.assign(new Error('endTime must be after startTime'), { status: 400 });
  }

  // ── Step 2: Normalize ──────────────────────────────────────────────────────
  const norm = {
    category:      category.toLowerCase().trim(),
    programTitle:  programTitle.trim(),
    sectionTitle:  (sectionTitle || '').trim(),
    contentTitle:  (contentTitle || '').trim(),
    startTime:     startTime.trim(),
    endTime:       endTime.trim(),
    timezone:      timezone.trim(),
    deliveryMode:  (deliveryMode || 'online').toLowerCase(),
  };

  // ── Step 3: AI Semantic Filter ─────────────────────────────────────────────
  let aiFlags = null;
  let aiStatus = 'approved';

  try {
    aiFlags = await runContentEvaluator({
      userId:   creatorId,
      title:    norm.programTitle,
      subtitle: norm.sectionTitle,
      snippet:  `Category: ${norm.category}. Content: ${norm.contentTitle}. Mode: ${norm.deliveryMode}.`,
    });
    aiStatus = aiFlags?.status === 'restrict' ? 'blocked' : 'approved';
  } catch {
    aiStatus = 'approved'; // AI unavailable — allow, log later
  }

  // ── Step 4: Hard block ─────────────────────────────────────────────────────
  if (aiStatus === 'blocked') {
    throw Object.assign(
      new Error('Schedule blocked by AI filter: ' + (aiFlags?.routing?.reason || 'policy violation')),
      { status: 422, aiFlags }
    );
  }

  // ── Step 5: Dedup gate ─────────────────────────────────────────────────────
  const scheduleId = buildScheduleId(
    creatorId, norm.category, contentRef?.cid || '',
    schedDate.toISOString().slice(0, 10), norm.startTime
  );

  const existing = await UCRSSchedule.findOne({ scheduleId }).lean();
  if (existing) return { schedule: existing, isDuplicate: true };

  // ── Step 6: Store ──────────────────────────────────────────────────────────
  const integrityHash = buildIntegrityHash({
    scheduleId, category: norm.category,
    programTitle: norm.programTitle, createdBy: creatorId,
    date: schedDate.toISOString().slice(0, 10), startTime: norm.startTime,
  });

  const schedule = await UCRSSchedule.create({
    scheduleId,
    category:     norm.category,
    programTitle: norm.programTitle,
    sectionTitle: norm.sectionTitle,
    contentTitle: norm.contentTitle,
    contentRef:   contentRef || {},
    instructorId,
    instructorName,
    scheduledDate: schedDate,
    startTime: norm.startTime,
    endTime:   norm.endTime,
    timezone:  norm.timezone,
    deliveryMode: norm.deliveryMode,
    capacity,
    fee:               fee || 0,
    streamingFee:      streamingFee || 0,
    streamingPlatform: streamingPlatform || null,
    workshopHour:      workshopHour || null,
    contentDescription: contentDescription || {},
    expertProfile:      expertProfile || {},
    status: 'ACTIVE',
    createdBy: creatorId,
    aiFlags,
    integrityHash,
    enrolmentCount: 0,
  });

  ledger.emit({
    eventType:  'ENTITY_CREATED',
    actorId:    creatorId,
    actorType:  'citizen',
    resourceId: scheduleId,
    payload:    { category: norm.category, programTitle: norm.programTitle, scheduledDate: schedDate },
  }).catch(() => {});

  ledger.emit({
    eventType:  'SESSION_STARTED',
    actorId:    creatorId,
    actorType:  'citizen',
    resourceId: scheduleId,
    payload:    { scheduleId, startTime: norm.startTime, timezone: norm.timezone },
  }).catch(() => {});

  // Subscriptions: notify watchers of this program/category/instructor
  matchAndNotify(schedule).catch(() => {});

  // Outbox: guaranteed delivery to Redis Streams via UCRS event dispatcher
  UCRSOutbox.create({
    eventId:    uuidv4(),
    actorId:    creatorId,
    eventType:  'SCHEDULE_CREATED',
    entityType: 'schedule',
    entityId:   scheduleId,
    contentCid: contentRef?.cid || null,
    payload: {
      scheduleId,
      category:     norm.category,
      programTitle: norm.programTitle,
      contentCid:   contentRef?.cid || null,
      scheduledDate: schedDate,
    },
  }).catch(() => {});

  return { schedule, isDuplicate: false };
}

/**
 * Search schedules by program/section/contentTitle + optional category filter.
 * Used by the Enrol page to find available sessions.
 */
async function searchSchedules({ category, programTitle, sectionTitle, contentTitle, limit = 20, page = 0 }) {
  const q = { status: 'ACTIVE', scheduledDate: { $gte: new Date() } };

  if (category) q.category = category.toLowerCase();
  if (programTitle) q.programTitle = { $regex: programTitle.trim(), $options: 'i' };
  if (sectionTitle) q.sectionTitle = { $regex: sectionTitle.trim(), $options: 'i' };
  if (contentTitle) q.contentTitle = { $regex: contentTitle.trim(), $options: 'i' };

  return UCRSSchedule
    .find(q)
    .sort({ scheduledDate: 1 })
    .skip(page * limit)
    .limit(limit)
    .lean();
}

/**
 * List schedules created by a citizen.
 */
async function listByCreator(creatorId, { limit = 20, page = 0 } = {}) {
  return UCRSSchedule
    .find({ createdBy: creatorId })
    .sort({ scheduledDate: -1 })
    .skip(page * limit)
    .limit(limit)
    .lean();
}

/**
 * Get a single schedule by its UCRS CP-prefixed ID.
 */
async function getSchedule(scheduleId) {
  return UCRSSchedule.findOne({ scheduleId }).lean();
}

/**
 * Cancel a schedule (ACTIVE → REVOKED).
 * Emits SESSION_ENDED to ledger.
 */
async function cancelSchedule(scheduleId, cancelledBy) {
  const schedule = await UCRSSchedule.findOneAndUpdate(
    { scheduleId, status: 'ACTIVE' },
    { status: 'REVOKED' },
    { new: true }
  );
  if (!schedule) throw Object.assign(new Error('Schedule not found or not active'), { status: 404 });

  ledger.emit({
    eventType:  'SESSION_ENDED',
    actorId:    cancelledBy,
    actorType:  'citizen',
    resourceId: scheduleId,
    payload:    { reason: 'cancelled' },
  }).catch(() => {});

  ledger.emit({
    eventType:  'ENTITY_STATE_CHANGED',
    actorId:    cancelledBy,
    actorType:  'citizen',
    resourceId: scheduleId,
    payload:    { fromState: 'ACTIVE', toState: 'REVOKED', reason: 'cancelled' },
  }).catch(() => {});

  UCRSOutbox.create({
    eventId:    uuidv4(),
    actorId:    cancelledBy,
    eventType:  'SCHEDULE_CANCELLED',
    entityType: 'schedule',
    entityId:   scheduleId,
    contentCid: schedule.contentRef?.cid || null,
    payload:    { scheduleId, reason: 'cancelled' },
  }).catch(() => {});

  return schedule;
}

module.exports = { createSchedule, searchSchedules, listByCreator, getSchedule, cancelSchedule };
