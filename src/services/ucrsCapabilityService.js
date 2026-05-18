'use strict';

/**
 * UCRS Capability Service — Layer 3 of the Cognitive Service Fabric
 *
 * Issues, verifies, delegates, and revokes capability tokens.
 * Replaces role-based JWT claims with fine-grained, delegatable,
 * contextually-constrained permissions.
 *
 * Redis caches active capability lookups per subject for 30 s.
 * Cache is invalidated on any revocation or new issuance.
 *
 * Public API:
 *   issue(params)                              → UCRSCapability doc
 *   verify(capabilityId, { action, resourceId, riskScore, sessionId })  → boolean
 *   resolveForRequest({ subjectId, action, resourceId, riskScore })     → capability | null
 *   delegate({ parentCapabilityId, toSubjectId, toSubjectType, narrowedActions, narrowedConstraints })
 *   revoke(capabilityId, revokedBy, reason)
 *   revokeAllForSubject(subjectId, revokedBy)
 */

const crypto          = require('crypto');
const { v4: uuidv4 } = require('uuid');
const UCRSCapability  = require('../models/ucrsCapabilityModel');
const ledger          = require('./ucrsLedgerService');
const { UCRS_ACTIONS } = require('../constants/ucrsConstants');

// Redis client — lazy-imported to avoid circular deps at startup
let _redis = null;
function redis() {
  if (!_redis) {
    const { createClient } = require('redis');
    _redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    _redis.connect().catch(() => { _redis = null; });
  }
  return _redis;
}

const CACHE_TTL = 30; // seconds

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildIntegrityHash({ capabilityId, subjectId, resourceScope, allowedActions, issuer, issuedAt }) {
  const stable = JSON.stringify({ capabilityId, subjectId, resourceScope, allowedActions: [...allowedActions].sort(), issuer, issuedAt });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function matchesScope(resourceScope, resourceId) {
  if (resourceScope === '*') return true;
  if (resourceScope === resourceId) return true;
  // Prefix glob: 'CS:*' matches 'CS:education', 'CS:health', etc.
  if (resourceScope.endsWith(':*')) {
    const prefix = resourceScope.slice(0, -1); // 'CS:'
    return resourceId.startsWith(prefix);
  }
  return false;
}

async function cacheInvalidate(subjectId) {
  try {
    const r = redis();
    if (r) await r.del(`ucrs:cap:${subjectId}`);
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Issue a new root capability.
 *
 * @param {object} p
 * @param {string}   p.subjectId
 * @param {string}   p.subjectType
 * @param {string}   p.resourceScope     e.g. '*', 'CS:education', 'CR:abc123'
 * @param {string[]} p.allowedActions
 * @param {string}   p.issuer            entityId or 'system'
 * @param {object}  [p.constraints]      see constraintsSchema
 */
async function issue({ subjectId, subjectType, resourceScope = '*', allowedActions, issuer, constraints = {} }) {
  if (!allowedActions?.length) throw new Error('ucrsCapability.issue: allowedActions required');
  const invalid = allowedActions.filter(a => !UCRS_ACTIONS.includes(a));
  if (invalid.length) throw new Error(`ucrsCapability.issue: invalid actions: ${invalid.join(', ')}`);

  const capabilityId = uuidv4();
  const issuedAt     = new Date();
  const integrityHash = buildIntegrityHash({ capabilityId, subjectId, resourceScope, allowedActions, issuer, issuedAt: issuedAt.toISOString() });

  const cap = await UCRSCapability.create({
    capabilityId, subjectId, subjectType, resourceScope,
    allowedActions, constraints, issuer,
    parentCapabilityId: null, delegationDepth: 0,
    integrityHash, status: 'ACTIVE', issuedAt,
  });

  await cacheInvalidate(subjectId);

  ledger.emit({
    eventType: 'CAPABILITY_ISSUED',
    actorId: issuer, actorType: 'citizen',
    subjectId, resourceId: resourceScope,
    payload: { capabilityId, allowedActions, delegationDepth: 0 },
  }).catch(() => {});

  return cap;
}

/**
 * Verify that a specific capability covers a given action + resource.
 * Also validates integrity hash to detect DB tampering.
 *
 * @returns {boolean}
 */
async function verify(capabilityId, { action, resourceId, riskScore = 0 }) {
  const cap = await UCRSCapability.findOne({ capabilityId, status: 'ACTIVE' }).lean();
  if (!cap) return false;

  // Expiry check
  if (cap.constraints?.expiresAt && new Date() > new Date(cap.constraints.expiresAt)) {
    await UCRSCapability.updateOne({ capabilityId }, { status: 'EXPIRED' });
    await cacheInvalidate(cap.subjectId);
    return false;
  }

  // Risk score check
  if (riskScore > (cap.constraints?.riskScoreMax ?? 1)) return false;

  // Integrity check
  const expected = buildIntegrityHash({
    capabilityId: cap.capabilityId, subjectId: cap.subjectId,
    resourceScope: cap.resourceScope, allowedActions: cap.allowedActions,
    issuer: cap.issuer, issuedAt: new Date(cap.issuedAt).toISOString(),
  });
  if (expected !== cap.integrityHash) return false;

  return cap.allowedActions.includes(action) && matchesScope(cap.resourceScope, resourceId);
}

/**
 * Find any active capability for subjectId that covers action on resourceId.
 * Results are cached in Redis for CACHE_TTL seconds.
 *
 * @returns {object|null} capability doc or null
 */
async function resolveForRequest({ subjectId, action, resourceId, riskScore = 0 }) {
  const cacheKey = `ucrs:cap:${subjectId}`;
  try {
    const r = redis();
    if (r) {
      const cached = await r.get(cacheKey);
      if (cached) {
        const caps = JSON.parse(cached);
        const match = caps.find(c =>
          c.allowedActions.includes(action) &&
          matchesScope(c.resourceScope, resourceId) &&
          riskScore <= (c.constraints?.riskScoreMax ?? 1) &&
          (!c.constraints?.expiresAt || new Date() < new Date(c.constraints.expiresAt))
        );
        if (match) return match;
        // If found caps but no match, still return null without DB hit
        return null;
      }
    }
  } catch { /* proceed to DB */ }

  const caps = await UCRSCapability.find({ subjectId, status: 'ACTIVE' }).lean();

  try {
    const r = redis();
    if (r) await r.setEx(cacheKey, CACHE_TTL, JSON.stringify(caps));
  } catch { /* non-fatal */ }

  return caps.find(c =>
    c.allowedActions.includes(action) &&
    matchesScope(c.resourceScope, resourceId) &&
    riskScore <= (c.constraints?.riskScoreMax ?? 1) &&
    (!c.constraints?.expiresAt || new Date() < new Date(c.constraints.expiresAt))
  ) ?? null;
}

/**
 * Delegate a child capability from an existing parent.
 * The child cannot exceed the parent's allowedActions or delegationDepth limit.
 */
async function delegate({ parentCapabilityId, toSubjectId, toSubjectType, narrowedActions, narrowedConstraints = {} }) {
  const parent = await UCRSCapability.findOne({ capabilityId: parentCapabilityId, status: 'ACTIVE' }).lean();
  if (!parent) throw new Error('ucrsCapability.delegate: parent capability not found or inactive');

  const maxDelegations = parent.constraints?.maxDelegations ?? 3;
  if (parent.delegationDepth >= maxDelegations) {
    throw new Error('ucrsCapability.delegate: maximum delegation depth reached');
  }

  // Child actions must be a subset of parent actions
  const invalid = narrowedActions.filter(a => !parent.allowedActions.includes(a));
  if (invalid.length) throw new Error(`ucrsCapability.delegate: actions not in parent scope: ${invalid.join(', ')}`);

  const capabilityId  = uuidv4();
  const issuedAt      = new Date();
  const delegationDepth = parent.delegationDepth + 1;
  const constraints   = {
    ...parent.constraints,
    ...narrowedConstraints,
    maxDelegations: Math.max(0, maxDelegations - delegationDepth),
  };

  const integrityHash = buildIntegrityHash({
    capabilityId, subjectId: toSubjectId,
    resourceScope: parent.resourceScope, allowedActions: narrowedActions,
    issuer: parent.subjectId, issuedAt: issuedAt.toISOString(),
  });

  const cap = await UCRSCapability.create({
    capabilityId, subjectId: toSubjectId, subjectType: toSubjectType,
    resourceScope: parent.resourceScope, allowedActions: narrowedActions,
    constraints, issuer: parent.subjectId,
    parentCapabilityId, delegationDepth,
    integrityHash, status: 'ACTIVE', issuedAt,
  });

  await cacheInvalidate(toSubjectId);

  ledger.emit({
    eventType: 'CAPABILITY_ISSUED',
    actorId: parent.subjectId, actorType: parent.subjectType,
    subjectId: toSubjectId,
    payload: { capabilityId, parentCapabilityId, delegationDepth, allowedActions: narrowedActions },
  }).catch(() => {});

  return cap;
}

/**
 * Revoke a capability and cascade to all its delegated children.
 */
async function revoke(capabilityId, revokedBy, reason = '') {
  const now = new Date();

  // Cascade: find all descendants (BFS via parentCapabilityId chains)
  const toRevoke = [capabilityId];
  const visited  = new Set([capabilityId]);
  let   cursor   = [capabilityId];

  while (cursor.length) {
    const children = await UCRSCapability
      .find({ parentCapabilityId: { $in: cursor }, status: 'ACTIVE' })
      .select('capabilityId')
      .lean();
    cursor = children.map(c => c.capabilityId).filter(id => !visited.has(id));
    cursor.forEach(id => { visited.add(id); toRevoke.push(id); });
  }

  await UCRSCapability.updateMany(
    { capabilityId: { $in: toRevoke }, status: 'ACTIVE' },
    { status: 'REVOKED', revokedAt: now, revokedBy, revokeReason: reason }
  );

  // Invalidate caches for all affected subjects
  const affected = await UCRSCapability.find({ capabilityId: { $in: toRevoke } }).select('subjectId').lean();
  const subjects = [...new Set(affected.map(c => c.subjectId))];
  await Promise.all(subjects.map(cacheInvalidate));

  ledger.emit({
    eventType: 'CAPABILITY_REVOKED',
    actorId: revokedBy, actorType: 'citizen',
    payload: { capabilityId, cascadeCount: toRevoke.length, reason },
  }).catch(() => {});

  ledger.emit({
    eventType:  'ENTITY_STATE_CHANGED',
    actorId:    revokedBy,
    actorType:  'citizen',
    resourceId: capabilityId,
    payload:    { fromState: 'ACTIVE', toState: 'REVOKED', cascadeCount: toRevoke.length, reason },
  }).catch(() => {});

  return toRevoke.length;
}

/**
 * Revoke all active capabilities for a subject (e.g. on account suspension).
 */
async function revokeAllForSubject(subjectId, revokedBy) {
  const caps = await UCRSCapability.find({ subjectId, status: 'ACTIVE' }).select('capabilityId').lean();
  let total = 0;
  for (const cap of caps) {
    total += await revoke(cap.capabilityId, revokedBy, 'subject_suspended');
  }
  return total;
}

module.exports = { issue, verify, resolveForRequest, delegate, revoke, revokeAllForSubject };
