'use strict';

/**
 * UCRS Public Key Store
 *
 * One record per entity per key version. Supports Ed25519 today and
 * CRYSTALS-Dilithium when Node.js/OpenSSL ships post-quantum support.
 * Key rotation increments keyVersion; old keys are retained (REVOKED)
 * for signature verification of historical records.
 */

const mongoose = require('mongoose');

const ucrsPublicKeySchema = new mongoose.Schema({
  // ── Who owns this key ──────────────────────────────────────────────────────
  entityId: {
    type: String,
    required: true,
    index: true,
    // UCRS typed ID: CB..., CA..., CS..., CD..., etc.
  },

  entityType: {
    type: String,
    required: true,
    // mirrors UCRS_ENTITY_PREFIXES values: 'citizen','agent','service','device'…
  },

  // ── Key material ───────────────────────────────────────────────────────────
  algorithm: {
    type: String,
    required: true,
    enum: ['Ed25519', 'CRYSTALS-Dilithium', 'RS256'],
    default: 'Ed25519',
  },

  publicKey: {
    type: String,
    required: true,
    // Base64-encoded SubjectPublicKeyInfo (DER) or raw Ed25519 public key bytes
  },

  keyVersion: {
    type: Number,
    required: true,
    default: 1,
    // Increments on each rotation. The highest ACTIVE version is the current key.
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'REVOKED', 'EXPIRED'],
    default: 'ACTIVE',
    index: true,
  },

  expiresAt: {
    type: Date,
    default: null,
    // null = no expiry (device-bound or long-lived service keys)
  },

  revokedAt: {
    type: Date,
    default: null,
  },

  revokedBy: {
    type: String,
    default: null,
    // entityId of the admin/system that revoked this key
  },

  // ── Device binding (optional) ─────────────────────────────────────────────
  deviceFingerprint: {
    type: String,
    default: null,
    // SHA-256 of device identifiers for hardware-bound keys
  },

}, {
  timestamps: true,
  strict: true,
});

// Current active key for an entity (most common lookup)
ucrsPublicKeySchema.index({ entityId: 1, status: 1, keyVersion: -1 });

// Algorithm + status for migration queries (e.g. "find all Ed25519 keys to migrate")
ucrsPublicKeySchema.index({ algorithm: 1, status: 1 });

module.exports = mongoose.model('UCRSPublicKey', ucrsPublicKeySchema);
