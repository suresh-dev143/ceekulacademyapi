'use strict';

/**
 * UCRS Foundation Constants — Schema Version 1.0.0
 *
 * This file is the single source of truth for all UCRS primitives.
 * Changes require deliberate governance — do not edit casually.
 *
 * Contents:
 *   1. Entity Type Prefix Registry
 *   2. Action Vocabulary (closed list)
 *   3. Entity Lifecycle States and valid transitions
 *   4. Event Types for the Event Ledger
 *   5. Schema versioning
 */

// ── 1. Entity Type Prefix Registry ───────────────────────────────────────────
//
// Every entity in the UCRS ecosystem is addressed by a typed prefix + sequence.
// Prefixes are two uppercase letters. The set is closed — new prefixes require
// a schema version bump.

const UCRS_ENTITY_PREFIXES = Object.freeze({
  CB: 'citizen',     // Human / Registered Member
  CC: 'community',   // Community group or collective
  CG: 'governance',  // Governance body (council, committee, board)
  CA: 'agent',       // AI Agent (autonomous or semi-autonomous)
  CR: 'resource',    // Resource (content, material, asset)
  CP: 'process',     // Process (pipeline, workflow instance)
  CD: 'device',      // Physical or virtual device
  CS: 'service',     // Service or system module
  CW: 'workflow',    // Automated workflow or orchestration unit
});

// Inverse: type name → prefix  e.g. 'citizen' → 'CB'
const UCRS_PREFIX_BY_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(UCRS_ENTITY_PREFIXES).map(([prefix, type]) => [type, prefix])
  )
);

// O(1) validity check
const VALID_PREFIXES = new Set(Object.keys(UCRS_ENTITY_PREFIXES));

/**
 * Extract the entity type name from any UCRS ID string.
 * Returns 'unknown' for unrecognised or malformed IDs.
 * @param {string} id
 * @returns {string}
 */
function resolveEntityType(id) {
  if (!id || typeof id !== 'string') return 'unknown';
  const prefix = id.slice(0, 2).toUpperCase();
  return UCRS_ENTITY_PREFIXES[prefix] ?? 'unknown';
}

/**
 * Returns true if the string looks like a valid UCRS entity ID
 * (known 2-letter prefix + at least one character).
 * @param {string} id
 * @returns {boolean}
 */
function isValidEntityId(id) {
  if (!id || typeof id !== 'string') return false;
  return VALID_PREFIXES.has(id.slice(0, 2).toUpperCase()) && id.length > 2;
}

// ── 2. Action Vocabulary ──────────────────────────────────────────────────────
//
// Closed, ordered list. Capability tokens and policy evaluations may only
// reference actions from this list. New actions require a version bump.

const UCRS_ACTIONS = Object.freeze([
  'read',        // Read or retrieve a resource or entity state
  'write',       // Create or modify a resource
  'allocate',    // Reserve or claim a resource for use
  'deallocate',  // Release a previously allocated resource
  'delegate',    // Grant a subset of own capabilities to another entity
  'invoke',      // Trigger a process, workflow, or service call
  'observe',     // Subscribe to an event stream or monitor state
  'audit',       // Read audit/event ledger records
  'admin',       // Administrative operations (lifecycle transitions, overrides)
]);

const UCRS_ACTION_SET = new Set(UCRS_ACTIONS);

/**
 * Returns true if the action is in the closed vocabulary.
 * @param {string} action
 * @returns {boolean}
 */
function isValidAction(action) {
  return UCRS_ACTION_SET.has(action);
}

// ── 3. Entity Lifecycle States ────────────────────────────────────────────────
//
// All UCRS entities follow this state machine.
// ARCHIVED is terminal — no transitions out.

const UCRS_LIFECYCLE_STATES = Object.freeze([
  'PENDING',    // Created but not yet activated
  'ACTIVE',     // Operational
  'SUSPENDED',  // Temporarily disabled (reversible)
  'REVOKED',    // Permanently disabled (irreversible except to ARCHIVED)
  'ARCHIVED',   // Terminal — read-only historical record
]);

// Valid transitions: state → allowed next states
const UCRS_LIFECYCLE_TRANSITIONS = Object.freeze({
  PENDING:   Object.freeze(['ACTIVE', 'REVOKED']),
  ACTIVE:    Object.freeze(['SUSPENDED', 'REVOKED', 'ARCHIVED']),
  SUSPENDED: Object.freeze(['ACTIVE', 'REVOKED', 'ARCHIVED']),
  REVOKED:   Object.freeze(['ARCHIVED']),
  ARCHIVED:  Object.freeze([]),
});

/**
 * Returns true if transitioning from `from` to `to` is permitted.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  return (UCRS_LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

// ── 4. Event Types ────────────────────────────────────────────────────────────
//
// Every type of event that may appear in the UCRS Event Ledger.
// This list is append-only — existing types are never removed.

const UCRS_EVENT_TYPES = Object.freeze([
  // Entity lifecycle
  'ENTITY_CREATED',
  'ENTITY_STATE_CHANGED',

  // Content and commits
  'COMMIT_CREATED',          // Session-level interaction commit
  'CONTENT_COMMITTED',       // UCE pipeline — new content stored
  'CONTENT_APPROVED',        // AI/human moderation: approved
  'CONTENT_BLOCKED',         // AI/human moderation: blocked

  // Sessions
  'SESSION_STARTED',
  'SESSION_ENDED',

  // Authorization
  'PERMISSION_GRANTED',
  'PERMISSION_DENIED',
  'CAPABILITY_ISSUED',
  'CAPABILITY_REVOKED',

  // Relationships
  'RELATIONSHIP_CREATED',
  'RELATIONSHIP_REMOVED',

  // Policy
  'POLICY_EVALUATED',
]);

const UCRS_EVENT_TYPE_SET = new Set(UCRS_EVENT_TYPES);

/**
 * Returns true if the event type is in the registered list.
 * @param {string} type
 * @returns {boolean}
 */
function isValidEventType(type) {
  return UCRS_EVENT_TYPE_SET.has(type);
}

// ── 5. Life Service Domains ───────────────────────────────────────────────────
//
// The 12 domains surfaced on the Personal Page.
// This list drives auto-registration of CS entities in the service registry.
// Adding a domain here automatically provisions its policy scopes on next boot.

const UCRS_LIFE_SERVICE_DOMAINS = Object.freeze([
  'education',    // Workshops, courses, lectures
  'digital',      // Digital life, identity, online presence
  'create',       // Content creation, creative tools
  'health',       // Health services, medical coordination
  'housing',      // Housing allocation and coordination
  'nutrition',    // Food, dietary services
  'justice',      // Legal aid, dispute resolution
  'security',     // Personal and community security
  'governance',   // Governance participation, voting
  'community',    // Community groups, collectives
  'economy',      // Economic services, trade, work
  'environment',  // Environmental coordination
]);

// ── 6. Policy Relations ───────────────────────────────────────────────────────
//
// Standard relation names for the Zanzibar-style policy graph.
// Relations are not closed — new ones can be created via the policy API.
// These are the built-in set with known action grants.

const UCRS_RELATIONS = Object.freeze([
  'owner',    // Full control, can delegate
  'admin',    // Full control within scope, no delegation
  'editor',   // Read + write + invoke
  'member',   // Read + observe + allocate
  'viewer',   // Read + observe only
  'delegate', // Inherits from parent capability
  'auditor',  // Read + audit only
]);

// Maps relation → set of actions implicitly granted.
// Policy checks use this to convert a relationship into permitted actions.
const UCRS_RELATION_ACTION_MAP = Object.freeze({
  owner:    Object.freeze(['read', 'write', 'allocate', 'deallocate', 'delegate', 'invoke', 'observe', 'audit', 'admin']),
  admin:    Object.freeze(['read', 'write', 'allocate', 'deallocate', 'invoke', 'observe', 'audit', 'admin']),
  editor:   Object.freeze(['read', 'write', 'invoke', 'observe']),
  member:   Object.freeze(['read', 'observe', 'allocate']),
  viewer:   Object.freeze(['read', 'observe']),
  delegate: Object.freeze([]), // resolved dynamically from parent capability
  auditor:  Object.freeze(['read', 'audit']),
});

// ── 7. Schema Versioning ──────────────────────────────────────────────────────

const UCRS_SCHEMA_VERSION = '1.1.0'; // bumped: added life service domains + policy relations

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Prefix registry
  UCRS_ENTITY_PREFIXES,
  UCRS_PREFIX_BY_TYPE,
  VALID_PREFIXES,
  resolveEntityType,
  isValidEntityId,

  // Action vocabulary
  UCRS_ACTIONS,
  UCRS_ACTION_SET,
  isValidAction,

  // Lifecycle
  UCRS_LIFECYCLE_STATES,
  UCRS_LIFECYCLE_TRANSITIONS,
  isValidTransition,

  // Event types
  UCRS_EVENT_TYPES,
  UCRS_EVENT_TYPE_SET,
  isValidEventType,

  // Life service domains
  UCRS_LIFE_SERVICE_DOMAINS,

  // Policy relations
  UCRS_RELATIONS,
  UCRS_RELATION_ACTION_MAP,

  // Schema version
  UCRS_SCHEMA_VERSION,
};
