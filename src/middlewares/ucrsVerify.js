'use strict';

/**
 * UCRS Zero-Trust Verification Middleware — Layer 6 of the Cognitive Service Fabric
 *
 * Every request passes through three verification stages:
 *
 *   Stage 1 — Identity: extract actor from bearer token
 *             Tries UCRS capability token first (future).
 *             Falls back to existing JWT (backward compatibility).
 *
 *   Stage 2 — Capability: if requiredAction + requiredScope are specified,
 *             verify the actor holds an active capability covering them.
 *
 *   Stage 3 — Policy: optionally check relationship graph as a secondary gate.
 *
 * Attaches req.ucrsContext = {
 *   actorId, actorType, entityType,
 *   verifiedBy: 'capability' | 'jwt',
 *   riskScore: 0–1,
 * }
 *
 * Usage:
 *   // Identity only (drop-in replacement for authenticateUser)
 *   router.get('/path', ucrsVerify(), handler)
 *
 *   // Identity + capability check
 *   router.post('/path', ucrsVerify({ action: 'write', scope: 'CS:education' }), handler)
 *
 *   // Identity + policy check
 *   router.get('/path', ucrsVerify({ action: 'read', policyCheck: true }), handler)
 */

const jwt               = require('jsonwebtoken');
const { User }          = require('../models/authModels');
const capabilityService = require('../services/ucrsCapabilityService');
const policyService     = require('../services/ucrsPolicyService');
const { resolveEntityType } = require('../constants/ucrsConstants');

// ── Risk scoring ──────────────────────────────────────────────────────────────
// Simple behavioral risk score (0=clean, 1=highest risk).
// Extend this over time with anomaly detection, device trust, geo signals, etc.

function computeRiskScore(req) {
  let score = 0;

  // No user-agent is mildly suspicious
  if (!req.headers['user-agent']) score += 0.1;

  // TOR exit node header (set by upstream proxy if available)
  if (req.headers['x-tor-exit']) score += 0.4;

  // Request marked high-risk by upstream fraud detection
  if (req.headers['x-risk-score']) {
    score = Math.max(score, parseFloat(req.headers['x-risk-score']) || 0);
  }

  return Math.min(score, 1);
}

// ── Token extraction ──────────────────────────────────────────────────────────

function extractBearer(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// ── Stage 1: Identity ─────────────────────────────────────────────────────────

async function resolveIdentity(token) {
  if (!token) return null;

  // Future: detect UCRS capability token format (e.g. starts with 'ucrs_')
  // and verify cryptographically. For now, all tokens go through JWT path.

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user    = await User.findById(decoded.id).select('_id ceebrainId status').lean();
    if (!user || user.status === 'Inactive' || user.status === 'Suspended') return null;

    const entityId = user.ceebrainId
      ? (user.ceebrainId.startsWith('CB') ? user.ceebrainId : `CB${user.ceebrainId}`)
      : `CB${user._id}`;

    return { actorId: entityId, actorType: 'citizen', mongoId: user._id, verifiedBy: 'jwt' };
  } catch {
    return null;
  }
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string}  [opts.action]       — UCRS action required (e.g. 'write')
 * @param {string}  [opts.scope]        — resource scope required (e.g. 'CS:education')
 * @param {boolean} [opts.policyCheck]  — also check policy graph
 * @param {boolean} [opts.optional]     — if true, attach context but don't 401 on missing token
 */
function ucrsVerify(opts = {}) {
  const { action, scope, policyCheck = false, optional = false } = opts;

  return async function (req, res, next) {
    const token    = extractBearer(req);
    const identity = await resolveIdentity(token).catch(() => null);

    if (!identity) {
      if (optional) {
        req.ucrsContext = null;
        return next();
      }
      return res.status(401).json({ status: false, message: 'Authentication required' });
    }

    const riskScore = computeRiskScore(req);

    req.ucrsContext = {
      actorId:    identity.actorId,
      actorType:  identity.actorType,
      entityType: resolveEntityType(identity.actorId),
      mongoId:    identity.mongoId,
      verifiedBy: identity.verifiedBy,
      riskScore,
    };

    // Backward compatibility: keep req.user populated for existing route handlers
    if (identity.mongoId) {
      req.user = { id: identity.mongoId, _id: identity.mongoId };
    }

    // ── Stage 2: Capability check ─────────────────────────────────────────────
    if (action && scope) {
      const cap = await capabilityService.resolveForRequest({
        subjectId:  identity.actorId,
        action,
        resourceId: scope,
        riskScore,
      }).catch(() => null);

      if (!cap) {
        // Fall through to policy check — capability is preferred but not mandatory
        // if the route only requires a policy relationship
        if (!policyCheck) {
          return res.status(403).json({ status: false, message: 'Capability required' });
        }
      } else {
        req.ucrsContext.capability = cap.capabilityId;
      }
    }

    // ── Stage 3: Policy graph check ───────────────────────────────────────────
    if (policyCheck && action && scope) {
      const allowed = await policyService.check({
        actorId:    identity.actorId,
        action,
        resourceId: scope,
      }).catch(() => false);

      if (!allowed && !req.ucrsContext.capability) {
        return res.status(403).json({ status: false, message: 'Access denied' });
      }
    }

    next();
  };
}

module.exports = ucrsVerify;
