'use strict';

/**
 * UCRS Policy Service — Layer 4 (Zanzibar-style Relationship Graph)
 *
 * Evaluates authorization by asking: "does actor have a relationship
 * to this resource that grants the requested action?"
 *
 * Relations → actions are resolved from UCRS_RELATION_ACTION_MAP.
 * Custom relations not in the map are treated as granting no actions
 * unless a capability token is also present.
 *
 * Redis caches check() results for 30 s per (actor, action, resource) triple.
 * Cache key is invalidated on any grant or revoke touching that triple.
 *
 * Public API:
 *   grant({ subjectId, subjectType, relation, objectId, objectType, createdBy, expiresAt, metadata })
 *   revoke({ subjectId, relation, objectId, createdBy })
 *   check({ actorId, action, resourceId })       → boolean
 *   listSubjects(objectId, relation)             → subject records
 *   listObjects(subjectId, relation)             → object records
 */

const UCRSPolicyTuple = require('../models/ucrsPolicyTupleModel');
const ledger          = require('./ucrsLedgerService');
const { UCRS_RELATION_ACTION_MAP } = require('../constants/ucrsConstants');

let _redis = null;
function redis() {
  if (!_redis) {
    const { createClient } = require('redis');
    _redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    _redis.connect().catch(() => { _redis = null; });
  }
  return _redis;
}

const CACHE_TTL = 30;

function cacheKey(actorId, action, resourceId) {
  return `ucrs:policy:${actorId}:${action}:${resourceId}`;
}

async function cacheSet(key, value) {
  try {
    const r = redis();
    if (r) await r.setEx(key, CACHE_TTL, value ? '1' : '0');
  } catch { /* non-fatal */ }
}

async function cacheGet(key) {
  try {
    const r = redis();
    if (!r) return null;
    const v = await r.get(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch { return null; }
}

async function cacheInvalidateActor(actorId) {
  try {
    const r = redis();
    if (r) {
      const keys = await r.keys(`ucrs:policy:${actorId}:*`);
      if (keys.length) await r.del(keys);
    }
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Grant a relationship tuple. Idempotent — upserts if the triple already exists.
 */
async function grant({ subjectId, subjectType, relation, objectId, objectType, createdBy, expiresAt = null, metadata = {} }) {
  if (!subjectId || !relation || !objectId) throw new Error('ucrsPolicygrant: subjectId, relation, objectId required');

  await UCRSPolicyTuple.findOneAndUpdate(
    { subjectId, relation, objectId },
    { subjectId, subjectType, relation, objectId, objectType, createdBy, expiresAt, metadata },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await cacheInvalidateActor(subjectId);

  ledger.emit({
    eventType: 'RELATIONSHIP_CREATED',
    actorId: createdBy, actorType: 'citizen',
    subjectId, resourceId: objectId,
    payload: { relation, objectType },
  }).catch(() => {});
}

/**
 * Revoke a relationship tuple.
 */
async function revoke({ subjectId, relation, objectId, createdBy }) {
  const result = await UCRSPolicyTuple.deleteOne({ subjectId, relation, objectId });

  if (result.deletedCount) {
    await cacheInvalidateActor(subjectId);

    ledger.emit({
      eventType: 'RELATIONSHIP_REMOVED',
      actorId: createdBy, actorType: 'citizen',
      subjectId, resourceId: objectId,
      payload: { relation },
    }).catch(() => {});
  }

  return result.deletedCount > 0;
}

/**
 * Check if actor can perform action on resourceId.
 * Resolves all tuples where subject=actorId AND object=resourceId,
 * maps each relation to its action set, checks membership.
 *
 * @param {string} actorId
 * @param {string} action      — must be in UCRS_ACTIONS
 * @param {string} resourceId  — UCRS entity ID or domain scope like 'CS:education'
 * @returns {boolean}
 */
async function check({ actorId, action, resourceId }) {
  const ck = cacheKey(actorId, action, resourceId);
  const cached = await cacheGet(ck);
  if (cached !== null) return cached;

  const now = new Date();

  // Direct tuples: subject=actor, object=resource
  const tuples = await UCRSPolicyTuple.find({
    subjectId: actorId,
    $or: [
      { objectId: resourceId },
      { objectId: '*' },                     // wildcard grants
    ],
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    ],
  }).lean();

  let allowed = false;
  for (const t of tuples) {
    const grantedActions = UCRS_RELATION_ACTION_MAP[t.relation];
    if (grantedActions && grantedActions.includes(action)) {
      allowed = true;
      break;
    }
  }

  await cacheSet(ck, allowed);

  ledger.emit({
    eventType: 'POLICY_EVALUATED',
    actorId, actorType: 'citizen',
    resourceId,
    payload: { action, result: allowed ? 'permit' : 'deny' },
  }).catch(() => {});

  return allowed;
}

/**
 * List all subjects with a given relation to an object.
 * e.g. "who are members of CS:education?"
 */
async function listSubjects(objectId, relation) {
  return UCRSPolicyTuple.find({ objectId, relation }).lean();
}

/**
 * List all objects a subject has a given relation to.
 * e.g. "what services does CB12345678901234 have viewer access to?"
 */
async function listObjects(subjectId, relation) {
  return UCRSPolicyTuple.find({ subjectId, relation }).lean();
}

module.exports = { grant, revoke, check, listSubjects, listObjects };
