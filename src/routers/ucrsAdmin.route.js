'use strict';

/**
 * UCRS Admin Router
 *
 * All management endpoints for the UCRS Cognitive Service Fabric.
 * Protected by authenticateAdmin — not accessible to regular citizens.
 *
 * Identity:
 *   POST   /api/ucrs-admin/identity/register         — register public key
 *   POST   /api/ucrs-admin/identity/rotate           — rotate key
 *   DELETE /api/ucrs-admin/identity/:entityId/revoke — revoke all keys
 *
 * Capabilities:
 *   POST   /api/ucrs-admin/capability/issue          — issue capability
 *   POST   /api/ucrs-admin/capability/delegate       — delegate capability
 *   DELETE /api/ucrs-admin/capability/:id/revoke     — revoke + cascade
 *   GET    /api/ucrs-admin/capability/subject/:id    — list subject capabilities
 *
 * Policy:
 *   POST   /api/ucrs-admin/policy/grant              — grant relationship tuple
 *   DELETE /api/ucrs-admin/policy/revoke             — remove tuple
 *   GET    /api/ucrs-admin/policy/check              — evaluate access
 *   GET    /api/ucrs-admin/policy/subjects/:objectId — who has relation to object
 *
 * Service Registry:
 *   GET    /api/ucrs-admin/services                  — list all services
 *   GET    /api/ucrs-admin/services/:domain          — get service record
 *   POST   /api/ucrs-admin/services/:domain/activate — activate a service
 *   PUT    /api/ucrs-admin/services/:domain/scopes   — update default scopes
 *   POST   /api/ucrs-admin/services/bootstrap        — force re-bootstrap
 *
 * Ledger:
 *   GET    /api/ucrs-admin/ledger/actor/:actorId     — actor timeline
 *   GET    /api/ucrs-admin/ledger/session/:ref       — session events
 *   GET    /api/ucrs-admin/ledger/type/:type         — events by type
 */

const express          = require('express');
const router           = express.Router();
const { authenticateAdmin } = require('../middlewares');
const identityService  = require('../services/ucrsIdentityService');
const capabilityService = require('../services/ucrsCapabilityService');
const policyService    = require('../services/ucrsPolicyService');
const registryService  = require('../services/ucrsServiceRegistryService');
const ledger           = require('../services/ucrsLedgerService');
const UCRSCapability   = require('../models/ucrsCapabilityModel');
const UCRSServiceRegistry = require('../models/ucrsServiceRegistryModel');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); } catch (err) { next(err); }
  };
}

// ══ Identity ══════════════════════════════════════════════════════════════════

router.post('/identity/register', authenticateAdmin, h(async (req, res) => {
  const { entityId, entityType, publicKeyB64, algorithm, expiresAt, deviceFingerprint } = req.body;
  if (!entityId || !entityType || !publicKeyB64) {
    return res.status(400).json({ status: false, message: 'entityId, entityType, publicKeyB64 required' });
  }
  const key = await identityService.registerKey(entityId, entityType, publicKeyB64, { algorithm, expiresAt, deviceFingerprint });
  res.status(201).json({ status: true, data: key });
}));

router.post('/identity/rotate', authenticateAdmin, h(async (req, res) => {
  const { entityId, newPublicKeyB64, algorithm, expiresAt } = req.body;
  if (!entityId || !newPublicKeyB64) {
    return res.status(400).json({ status: false, message: 'entityId, newPublicKeyB64 required' });
  }
  const key = await identityService.rotateKey(entityId, newPublicKeyB64, { algorithm, expiresAt });
  res.json({ status: true, data: key });
}));

router.delete('/identity/:entityId/revoke', authenticateAdmin, h(async (req, res) => {
  const count = await identityService.revokeKey(req.params.entityId, req.admin?._id?.toString() || 'admin');
  res.json({ status: true, revokedCount: count });
}));

// ══ Capabilities ══════════════════════════════════════════════════════════════

router.post('/capability/issue', authenticateAdmin, h(async (req, res) => {
  const { subjectId, subjectType, resourceScope, allowedActions, constraints } = req.body;
  if (!subjectId || !subjectType || !allowedActions?.length) {
    return res.status(400).json({ status: false, message: 'subjectId, subjectType, allowedActions required' });
  }
  const issuer = req.admin?._id?.toString() || 'system';
  const cap = await capabilityService.issue({ subjectId, subjectType, resourceScope, allowedActions, issuer, constraints });
  res.status(201).json({ status: true, data: cap });
}));

router.post('/capability/delegate', authenticateAdmin, h(async (req, res) => {
  const { parentCapabilityId, toSubjectId, toSubjectType, narrowedActions, narrowedConstraints } = req.body;
  if (!parentCapabilityId || !toSubjectId || !narrowedActions?.length) {
    return res.status(400).json({ status: false, message: 'parentCapabilityId, toSubjectId, narrowedActions required' });
  }
  const cap = await capabilityService.delegate({ parentCapabilityId, toSubjectId, toSubjectType, narrowedActions, narrowedConstraints });
  res.status(201).json({ status: true, data: cap });
}));

router.delete('/capability/:id/revoke', authenticateAdmin, h(async (req, res) => {
  const revokedBy = req.admin?._id?.toString() || 'admin';
  const count = await capabilityService.revoke(req.params.id, revokedBy, req.body.reason || '');
  res.json({ status: true, revokedCount: count });
}));

router.get('/capability/subject/:subjectId', authenticateAdmin, h(async (req, res) => {
  const caps = await UCRSCapability.find({ subjectId: req.params.subjectId }).sort({ issuedAt: -1 }).lean();
  res.json({ status: true, data: caps });
}));

// ══ Policy ════════════════════════════════════════════════════════════════════

router.post('/policy/grant', authenticateAdmin, h(async (req, res) => {
  const { subjectId, subjectType, relation, objectId, objectType, expiresAt, metadata } = req.body;
  if (!subjectId || !relation || !objectId) {
    return res.status(400).json({ status: false, message: 'subjectId, relation, objectId required' });
  }
  const createdBy = req.admin?._id?.toString() || 'admin';
  await policyService.grant({ subjectId, subjectType, relation, objectId, objectType, createdBy, expiresAt, metadata });
  res.status(201).json({ status: true });
}));

router.delete('/policy/revoke', authenticateAdmin, h(async (req, res) => {
  const { subjectId, relation, objectId } = req.body;
  const createdBy = req.admin?._id?.toString() || 'admin';
  const removed = await policyService.revoke({ subjectId, relation, objectId, createdBy });
  res.json({ status: true, removed });
}));

router.get('/policy/check', authenticateAdmin, h(async (req, res) => {
  const { actorId, action, resourceId } = req.query;
  if (!actorId || !action || !resourceId) {
    return res.status(400).json({ status: false, message: 'actorId, action, resourceId required' });
  }
  const allowed = await policyService.check({ actorId, action, resourceId });
  res.json({ status: true, allowed });
}));

router.get('/policy/subjects/:objectId', authenticateAdmin, h(async (req, res) => {
  const { relation } = req.query;
  const subjects = await policyService.listSubjects(req.params.objectId, relation);
  res.json({ status: true, data: subjects });
}));

// ══ Service Registry ══════════════════════════════════════════════════════════

router.get('/services', authenticateAdmin, h(async (req, res) => {
  const services = await UCRSServiceRegistry.find().sort({ domain: 1 }).lean();
  res.json({ status: true, data: services });
}));

router.get('/services/:domain', authenticateAdmin, h(async (req, res) => {
  const svc = await registryService.getService(req.params.domain);
  if (!svc) return res.status(404).json({ status: false, message: 'Service not found' });
  res.json({ status: true, data: svc });
}));

router.post('/services/:domain/activate', authenticateAdmin, h(async (req, res) => {
  const svc = await registryService.activateService(req.params.domain);
  res.json({ status: true, data: svc });
}));

router.put('/services/:domain/scopes', authenticateAdmin, h(async (req, res) => {
  const { scopes, recognisedRelations } = req.body;
  const svc = await registryService.updateDefaultScopes(req.params.domain, scopes, recognisedRelations);
  if (!svc) return res.status(404).json({ status: false, message: 'Service not found' });
  res.json({ status: true, data: svc });
}));

router.post('/services/bootstrap', authenticateAdmin, h(async (req, res) => {
  await registryService.bootstrap();
  res.json({ status: true, message: 'Service registry bootstrapped' });
}));

// ══ Ledger ════════════════════════════════════════════════════════════════════

router.get('/ledger/actor/:actorId', authenticateAdmin, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 500);
  const before = req.query.before ? new Date(req.query.before) : undefined;
  const events = await ledger.getActorEvents(req.params.actorId, { limit, before });
  res.json({ status: true, data: events });
}));

router.get('/ledger/session/:ref', authenticateAdmin, h(async (req, res) => {
  const events = await ledger.getSessionEvents(req.params.ref);
  res.json({ status: true, data: events });
}));

router.get('/ledger/type/:type', authenticateAdmin, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
  const before = req.query.before ? new Date(req.query.before) : undefined;
  const events = await ledger.getEventsByType(req.params.type, { limit, before });
  res.json({ status: true, data: events });
}));

module.exports = router;
