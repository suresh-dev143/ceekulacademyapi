'use strict';

/**
 * CID Generator — produces a deterministic, content-addressed ID.
 *
 * Same normalized payload always yields the same CID.
 * Any single-character change yields a completely different CID.
 * Format: "ck_" + first 48 hex chars of SHA-256 (192-bit collision resistance).
 */

const crypto = require('crypto');

// Stable (sorted-key) JSON serialization for deterministic hashing.
// Handles nested objects and arrays recursively.
function _stableStringify(val) {
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(_stableStringify).join(',') + ']';
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify(val[k])).join(',') + '}';
}

function generateCid(normalizedPayload) {
  const canonical = _stableStringify(normalizedPayload);
  const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return 'ck_' + hash.slice(0, 48);
}

module.exports = { generateCid };
