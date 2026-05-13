'use strict';

/**
 * UCRS Service Registry Service
 *
 * Auto-registers every life service domain from UCRS_LIFE_SERVICE_DOMAINS
 * as a CS-prefixed entity on each server startup. This is the bridge that
 * makes the architecture self-maintaining:
 *
 *   1. Add domain to UCRS_LIFE_SERVICE_DOMAINS in ucrsConstants.js
 *   2. Deploy — bootstrap() runs on startup, provisions the new service
 *   3. No other code changes needed
 *
 * Default capability scopes are issued to citizens on portal registration
 * via provisionCitizenDefaults(). As service scopes evolve, updating the
 * registry record and bumping version is sufficient — existing capabilities
 * remain valid until they expire or are explicitly revoked.
 *
 * Public API:
 *   bootstrap()                                     — run on server start
 *   provisionCitizenDefaults(citizenId)             — call on user registration
 *   activateService(domain)                         — mark service as ACTIVE
 *   updateDefaultScopes(domain, scopes, relations)  — evolve default permissions
 *   getService(domain)                              → registry record
 */

const UCRSServiceRegistry = require('../models/ucrsServiceRegistryModel');
const ledger              = require('./ucrsLedgerService');
const policyService       = require('./ucrsPolicyService');
const capabilityService   = require('./ucrsCapabilityService');
const { UCRS_LIFE_SERVICE_DOMAINS } = require('../constants/ucrsConstants');

// Display names for each domain — used in registry records
const DOMAIN_DISPLAY_NAMES = {
  education:   'Education',
  digital:     'Digital Life',
  create:      'Create',
  health:      'Health',
  housing:     'Housing',
  nutrition:   'Nutrition',
  justice:     'Justice',
  security:    'Security',
  governance:  'Governance',
  community:   'Community',
  economy:     'Economy',
  environment: 'Environment',
};

// Default capability scopes per domain — what every citizen gets on registration.
// These are conservative defaults; admin can widen via updateDefaultScopes().
const DEFAULT_CITIZEN_SCOPES = {
  education:   [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:education' }],
  digital:     [{ allowedActions: ['read', 'observe', 'write'], resourceScope: 'CS:digital' }],
  create:      [{ allowedActions: ['read', 'write', 'invoke'], resourceScope: 'CS:create' }],
  health:      [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:health' }],
  housing:     [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:housing' }],
  nutrition:   [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:nutrition' }],
  justice:     [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:justice' }],
  security:    [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:security' }],
  governance:  [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:governance' }],
  community:   [{ allowedActions: ['read', 'observe', 'allocate'], resourceScope: 'CS:community' }],
  economy:     [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:economy' }],
  environment: [{ allowedActions: ['read', 'observe'], resourceScope: 'CS:environment' }],
};

// ── Internal: derive stable CS entity ID for a domain ─────────────────────────

function domainToServiceId(domain) {
  // Deterministic: CS + 12-char domain hash so IDs survive across restarts
  const crypto = require('crypto');
  const hash   = crypto.createHash('sha256').update(`ucrs:service:${domain}`).digest('hex');
  return `CS${hash.slice(0, 12).toUpperCase()}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run on every server startup.
 * Upserts a registry record for each domain in UCRS_LIFE_SERVICE_DOMAINS.
 * New domains are provisioned; existing records are left unchanged
 * (preserving manually tuned scopes and status).
 */
async function bootstrap() {
  const now = new Date();

  for (const domain of UCRS_LIFE_SERVICE_DOMAINS) {
    const serviceId = domainToServiceId(domain);

    await UCRSServiceRegistry.findOneAndUpdate(
      { domain },
      {
        $setOnInsert: {
          serviceId,
          domain,
          displayName: DOMAIN_DISPLAY_NAMES[domain] || domain,
          status: 'PENDING',
          available: false,
          defaultCitizenScopes: DEFAULT_CITIZEN_SCOPES[domain] || [],
          recognisedRelations: ['viewer'],
          version: 1,
        },
        $set: { lastBootstrappedAt: now },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  console.log(`[UCRS] Service registry bootstrapped — ${UCRS_LIFE_SERVICE_DOMAINS.length} domains`);
}

/**
 * Issue default capabilities and viewer policy tuples for a newly registered citizen.
 * Call this inside the user registration flow after ceebrainId is assigned.
 *
 * @param {string} citizenId   — UCRS CB-prefixed entity ID
 */
async function provisionCitizenDefaults(citizenId) {
  const services = await UCRSServiceRegistry.find({ status: 'ACTIVE' }).lean();

  for (const svc of services) {
    // Default capability for each active service
    for (const scope of svc.defaultCitizenScopes) {
      await capabilityService.issue({
        subjectId:      citizenId,
        subjectType:    'citizen',
        resourceScope:  scope.resourceScope,
        allowedActions: scope.allowedActions,
        issuer:         'system',
        constraints:    { maxDelegations: 1 },
      }).catch(() => {}); // non-fatal: already exists or service unavailable
    }

    // Viewer policy tuple — grants read/observe without a capability token
    await policyService.grant({
      subjectId:   citizenId,
      subjectType: 'citizen',
      relation:    'viewer',
      objectId:    `CS:${svc.domain}`,
      objectType:  'service',
      createdBy:   'system',
    }).catch(() => {});
  }

  ledger.emit({
    eventType: 'PERMISSION_GRANTED',
    actorId:   'system', actorType: 'service',
    subjectId: citizenId,
    payload:   { action: 'citizen_defaults_provisioned', serviceCount: services.length },
  }).catch(() => {});
}

/**
 * Activate a service domain (transition PENDING → ACTIVE).
 * After this, the service is visible and new citizen registrations
 * receive default capabilities for it.
 */
async function activateService(domain) {
  const result = await UCRSServiceRegistry.findOneAndUpdate(
    { domain },
    { status: 'ACTIVE', available: true },
    { new: true }
  );
  if (!result) throw new Error(`ucrsServiceRegistry: domain "${domain}" not found`);
  return result;
}

/**
 * Update default capability scopes for a domain.
 * Does NOT retroactively update existing citizen capabilities —
 * only new registrations and explicit re-provisioning are affected.
 * Bumps version to mark the change.
 */
async function updateDefaultScopes(domain, scopes, recognisedRelations) {
  const update = { $inc: { version: 1 } };
  if (scopes)              update.$set = { ...(update.$set || {}), defaultCitizenScopes: scopes };
  if (recognisedRelations) update.$set = { ...(update.$set || {}), recognisedRelations };

  return UCRSServiceRegistry.findOneAndUpdate({ domain }, update, { new: true });
}

/**
 * Retrieve a service registry record by domain name.
 */
async function getService(domain) {
  return UCRSServiceRegistry.findOne({ domain }).lean();
}

module.exports = { bootstrap, provisionCitizenDefaults, activateService, updateDefaultScopes, getService };
