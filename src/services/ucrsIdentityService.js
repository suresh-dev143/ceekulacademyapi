'use strict';

/**
 * UCRS Identity Service — Layer 2 of the Cognitive Service Fabric
 *
 * Manages cryptographic public keys for every UCRS entity.
 * Ed25519 is used today; the algorithm field enables a non-breaking migration
 * to CRYSTALS-Dilithium when post-quantum support lands in Node.js/OpenSSL.
 *
 * Public API:
 *   registerKey(entityId, entityType, publicKeyB64, opts)
 *   getCurrentKey(entityId)
 *   verifySignature(entityId, message, signatureB64)
 *   rotateKey(entityId, newPublicKeyB64, opts)
 *   revokeKey(entityId, revokedBy)
 */

const crypto      = require('crypto');
const UCRSPublicKey = require('../models/ucrsPublicKeyModel');
const ledger      = require('./ucrsLedgerService');

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeB64(str) {
  return Buffer.from(str, 'base64');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register the first public key for an entity.
 * Call this when a citizen registers or an AI agent is provisioned.
 *
 * @param {string} entityId       — UCRS typed ID (CB..., CA..., etc.)
 * @param {string} entityType     — 'citizen' | 'agent' | 'service' | 'device'
 * @param {string} publicKeyB64   — Base64-encoded Ed25519 public key (32 bytes)
 * @param {object} [opts]
 * @param {string} [opts.algorithm='Ed25519']
 * @param {Date}   [opts.expiresAt]
 * @param {string} [opts.deviceFingerprint]
 */
async function registerKey(entityId, entityType, publicKeyB64, opts = {}) {
  const { algorithm = 'Ed25519', expiresAt = null, deviceFingerprint = null } = opts;

  const existing = await UCRSPublicKey.findOne({ entityId, status: 'ACTIVE' });
  if (existing) throw new Error(`ucrsIdentity: active key already exists for ${entityId}. Use rotateKey().`);

  const key = await UCRSPublicKey.create({
    entityId, entityType, algorithm, publicKey: publicKeyB64,
    keyVersion: 1, status: 'ACTIVE', expiresAt, deviceFingerprint,
  });

  ledger.emit({
    eventType: 'ENTITY_CREATED',
    actorId: entityId, actorType: entityType,
    payload: { action: 'key_registered', algorithm, keyVersion: 1 },
  }).catch(() => {});

  return key;
}

/**
 * Retrieve the current active public key record for an entity.
 */
async function getCurrentKey(entityId) {
  return UCRSPublicKey
    .findOne({ entityId, status: 'ACTIVE' })
    .sort({ keyVersion: -1 })
    .lean();
}

/**
 * Verify an Ed25519 signature against the entity's current active key.
 * message and signatureB64 are both base64-encoded strings.
 *
 * @returns {boolean}
 */
async function verifySignature(entityId, messageB64, signatureB64) {
  const keyRecord = await getCurrentKey(entityId);
  if (!keyRecord) return false;

  if (keyRecord.expiresAt && new Date() > keyRecord.expiresAt) {
    await UCRSPublicKey.updateOne({ _id: keyRecord._id }, { status: 'EXPIRED' });
    return false;
  }

  try {
    const publicKeyDer = decodeB64(keyRecord.publicKey);
    const message      = decodeB64(messageB64);
    const signature    = decodeB64(signatureB64);

    // Node.js crypto supports Ed25519 natively from v15+
    const cryptoKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, message, cryptoKey, signature);
  } catch {
    return false;
  }
}

/**
 * Rotate the key for an entity: REVOKE the current key and register a new one.
 * Old key is retained (status=REVOKED) for historical signature verification.
 *
 * @param {string} entityId
 * @param {string} newPublicKeyB64
 * @param {object} [opts]  — same options as registerKey
 */
async function rotateKey(entityId, newPublicKeyB64, opts = {}) {
  const current = await UCRSPublicKey
    .findOne({ entityId, status: 'ACTIVE' })
    .sort({ keyVersion: -1 });

  if (!current) throw new Error(`ucrsIdentity: no active key found for ${entityId}`);

  const nextVersion = current.keyVersion + 1;

  // Mark current as revoked
  current.status    = 'REVOKED';
  current.revokedAt = new Date();
  await current.save();

  const { algorithm = current.algorithm, expiresAt = null, deviceFingerprint = null } = opts;

  const newKey = await UCRSPublicKey.create({
    entityId,
    entityType: current.entityType,
    algorithm,
    publicKey: newPublicKeyB64,
    keyVersion: nextVersion,
    status: 'ACTIVE',
    expiresAt,
    deviceFingerprint,
  });

  ledger.emit({
    eventType: 'ENTITY_STATE_CHANGED',
    actorId: entityId, actorType: current.entityType,
    payload: { action: 'key_rotated', fromVersion: current.keyVersion, toVersion: nextVersion },
  }).catch(() => {});

  return newKey;
}

/**
 * Permanently revoke all keys for an entity (e.g. entity suspension or archival).
 */
async function revokeKey(entityId, revokedBy) {
  const result = await UCRSPublicKey.updateMany(
    { entityId, status: 'ACTIVE' },
    { status: 'REVOKED', revokedAt: new Date(), revokedBy }
  );

  ledger.emit({
    eventType: 'ENTITY_STATE_CHANGED',
    actorId: revokedBy, actorType: 'citizen',
    subjectId: entityId,
    payload: { action: 'key_revoked', count: result.modifiedCount },
  }).catch(() => {});

  return result.modifiedCount;
}

module.exports = { registerKey, getCurrentKey, verifySignature, rotateKey, revokeKey };
