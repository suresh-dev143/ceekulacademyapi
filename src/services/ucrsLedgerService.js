'use strict';

/**
 * UCRS Event Ledger Service
 *
 * Fire-and-forget event emission with SHA-256 hash chaining.
 * Each actor maintains an independent hash chain so tamper detection
 * is scoped per actor without cross-actor coupling.
 *
 * Public API:
 *   emit(eventData)                → appends one event, returns the saved doc
 *   getActorEvents(actorId, opts)  → actor timeline, newest first
 *   getSessionEvents(sessionRef)   → all events in a session
 *   getEventsByType(eventType)     → regulatory / compliance queries
 */

const crypto       = require('crypto');
const { v4: uuidv4 } = require('uuid');
const UCRSEvent    = require('../models/ucrsEventModel');
const { isValidEventType, UCRS_SCHEMA_VERSION } = require('../constants/ucrsConstants');

// ── Internal: hash helpers ────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Build the event hash that locks this record in the chain.
 * All fields included must be stable before calling — no mutable defaults.
 */
function buildEventHash({ eventId, eventType, actorId, occurredAt, previousHash, payload }) {
  const stable = JSON.stringify({ eventId, eventType, actorId, occurredAt, previousHash, payload });
  return sha256(stable);
}

// ── Internal: resolve the tip of an actor's chain ────────────────────────────

async function resolveChainTip(actorId) {
  const latest = await UCRSEvent
    .findOne({ actorId })
    .sort({ occurredAt: -1 })
    .select('eventHash')
    .lean();
  return latest?.eventHash ?? null;
}

// ── Public: emit ──────────────────────────────────────────────────────────────

/**
 * Append one event to the ledger.
 *
 * @param {object} eventData
 * @param {string}  eventData.eventType   — must be in UCRS_EVENT_TYPES
 * @param {string}  eventData.actorId     — UCRS entity ID of the actor
 * @param {string}  eventData.actorType   — entity type name (e.g. 'citizen')
 * @param {string} [eventData.subjectId]  — entity the event is about
 * @param {string} [eventData.resourceId] — resource being acted upon
 * @param {object} [eventData.payload]    — event-specific data
 * @param {string} [eventData.sessionRef] — session correlation ID
 * @param {string} [eventData.ipHash]     — SHA-256 of originating IP
 * @param {string} [eventData.userAgent]
 * @param {string} [eventData.region]
 * @returns {Promise<object>} the saved UCRSEvent document
 */
async function emit(eventData) {
  const {
    eventType,
    actorId,
    actorType,
    subjectId   = null,
    resourceId  = null,
    payload     = {},
    sessionRef  = null,
    ipHash      = null,
    userAgent   = null,
    region      = null,
  } = eventData;

  if (!isValidEventType(eventType)) {
    throw new Error(`ucrsLedger.emit: unknown eventType "${eventType}"`);
  }
  if (!actorId)   throw new Error('ucrsLedger.emit: actorId is required');
  if (!actorType) throw new Error('ucrsLedger.emit: actorType is required');

  const eventId      = uuidv4();
  const occurredAt   = new Date();
  const previousHash = await resolveChainTip(actorId);
  const eventHash    = buildEventHash({ eventId, eventType, actorId, occurredAt: occurredAt.toISOString(), previousHash, payload });

  return UCRSEvent.create({
    eventId,
    schemaVersion: UCRS_SCHEMA_VERSION,
    eventType,
    actorId,
    actorType,
    subjectId,
    resourceId,
    payload,
    previousHash,
    eventHash,
    sessionRef,
    ipHash,
    userAgent,
    region,
    occurredAt,
  });
}

// ── Public: query helpers ─────────────────────────────────────────────────────

/**
 * @param {string} actorId
 * @param {{ limit?: number, before?: Date }} [opts]
 */
async function getActorEvents(actorId, opts = {}) {
  const { limit = 50, before } = opts;
  const q = { actorId };
  if (before) q.occurredAt = { $lt: before };
  return UCRSEvent.find(q).sort({ occurredAt: -1 }).limit(limit).lean();
}

/**
 * @param {string} sessionRef
 */
async function getSessionEvents(sessionRef) {
  return UCRSEvent.find({ sessionRef }).sort({ occurredAt: 1 }).lean();
}

/**
 * @param {string} eventType
 * @param {{ limit?: number, before?: Date }} [opts]
 */
async function getEventsByType(eventType, opts = {}) {
  const { limit = 100, before } = opts;
  const q = { eventType };
  if (before) q.occurredAt = { $lt: before };
  return UCRSEvent.find(q).sort({ occurredAt: -1 }).limit(limit).lean();
}

module.exports = { emit, getActorEvents, getSessionEvents, getEventsByType };
