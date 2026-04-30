'use strict';

/**
 * Hybrid ID Service — C)
 *
 * Base ID:    CB100000000001
 * Full form:  CB100000000001-E-L-045-V02-D
 *             ^prefix ^12-seq ^dom ^type ^cat ^ver ^state
 *
 * Strategy:
 *   - Base 12-digit sequence: MongoDB atomic counter (sequential, gap-free,
 *     human-memorable). Any server instance calls this — state lives in DB.
 *   - Snowflake generator available for high-volume sub-IDs (blocks, versions).
 *   - buildBaseId()   — assigns permanent base ID at draft creation
 *   - buildHybridId() — computes full suffix from content metadata
 *   - buildUrl()      — canonical URL (omits state suffix per spec)
 */

const mongoose = require('mongoose');

// ── Atomic sequence counter ───────────────────────────────────────────────────

const sequenceSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'id_sequences' }
);
const Sequence = mongoose.models.IdSequence ?? mongoose.model('IdSequence', sequenceSchema);

const CONTENT_SEQ_KEY = 'content_base';
const SEQ_START       = 100_000_000_001; // first issued ID: CB100000000001

/**
 * Issues the next sequential base ID.  Atomic increment — safe under concurrency.
 * @returns {Promise<string>}  e.g. "CB100000000001"
 */
async function buildBaseId() {
  const doc = await Sequence.findOneAndUpdate(
    { _id: CONTENT_SEQ_KEY },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // On first call seq becomes 1; map to SEQ_START range
  const numeric = SEQ_START - 1 + doc.seq;
  return `CB${String(numeric).padStart(12, '0')}`;
}

// ── Snowflake generator (sub-IDs: blocks, versions, deltas) ─────────────────

const SNOWFLAKE_EPOCH = 1_704_067_200_000n; // Jan 1 2024 00:00:00 UTC
const MACHINE_ID      = BigInt(parseInt(process.env.MACHINE_ID ?? '1', 10) & 0x3FF);

let _lastMs   = -1n;
let _sequence = 0n;

/**
 * Stateless Snowflake — 63-bit: 41b timestamp | 10b machineId | 12b sequence
 * @returns {string}  base-36 encoded, ~13 chars, URL-safe
 */
function snowflakeId() {
  let now = BigInt(Date.now());
  if (now === _lastMs) {
    _sequence = (_sequence + 1n) & 0xFFFn;
    if (_sequence === 0n) {
      while (BigInt(Date.now()) <= _lastMs) { /* spin */ }
      now = BigInt(Date.now());
    }
  } else {
    _sequence = 0n;
  }
  _lastMs = now;

  const id = ((now - SNOWFLAKE_EPOCH) << 22n) | (MACHINE_ID << 12n) | _sequence;
  return id.toString(36).toUpperCase();
}

// ── Domain / type / category lookup tables ───────────────────────────────────

const DOMAIN_CODES = {
  education:      'E',
  health:         'H',
  justice:        'J',
  services:       'S',
  infrastructure: 'I',
};

/** Content type — matches the three options in Create Content flow */
const CONTENT_TYPES = { L: 'Lecture', H: 'Hands-On', P: 'Project Discussion' };

/** Category codes: 3-digit topic codes, extensible via DB later */
const CATEGORY_CODES = {
  // Education
  programming:       '001',
  mathematics:       '002',
  science:           '003',
  language:          '004',
  history:           '005',
  engineering:       '006',
  design:            '007',
  business:          '008',
  economics:         '009',
  philosophy:        '010',
  // Health
  medicine:          '101',
  nutrition:         '102',
  mentalHealth:      '103',
  fitness:           '104',
  // Justice
  law:               '201',
  civilRights:       '202',
  policy:            '203',
  // Services
  technology:        '301',
  finance:           '302',
  logistics:         '303',
  // Infrastructure
  urbanPlanning:     '401',
  energy:            '402',
  environment:       '403',
  // Fallback
  general:           '000',
};

const STATE_CODES = { draft: 'D', shared: 'S', published: 'P' };

// ── Core builders ─────────────────────────────────────────────────────────────

/**
 * Builds the full Hybrid ID from a previously-issued base ID.
 *
 * @param {string} baseId       e.g. "CB100000000001"
 * @param {object} meta
 * @param {string} meta.domain       key from DOMAIN_CODES
 * @param {string} meta.contentType  'L' | 'H' | 'P'
 * @param {string} meta.category     key from CATEGORY_CODES
 * @param {number} meta.version      integer >= 1
 * @param {string} meta.state        'draft' | 'shared' | 'published'
 * @returns {string}  e.g. "CB100000000001-E-L-001-V01-D"
 */
function buildHybridId(baseId, { domain, contentType, category, version, state }) {
  const D = DOMAIN_CODES[domain]    ?? 'X';
  const T = contentType.toUpperCase();
  const C = (CATEGORY_CODES[category] ?? '000');
  const V = `V${String(version).padStart(2, '0')}`;
  const S = STATE_CODES[state]      ?? 'D';
  return `${baseId}-${D}-${T}-${C}-${V}-${S}`;
}

/**
 * Derives the canonical public URL for a content item.
 * State suffix is omitted — URL is stable across state transitions.
 *
 * @param {string} hybridId  full hybrid ID including state
 * @returns {string}  e.g. "https://ceekul.xyz/cb100000000001-e-l-001-v01"
 */
function buildUrl(hybridId) {
  const parts  = hybridId.split('-');
  const withoutState = parts.slice(0, -1).join('-').toLowerCase();
  return `https://ceekul.xyz/${withoutState}`;
}

/**
 * Bumps only the state suffix of an existing hybridId.
 * Used when transitioning Draft → Shared → Published without creating a new version.
 */
function transitionState(hybridId, newState) {
  const parts = hybridId.split('-');
  parts[parts.length - 1] = STATE_CODES[newState] ?? 'D';
  return parts.join('-');
}

/**
 * Bumps version number and resets state to 'D' (new draft version).
 * Used when a published item is re-opened for editing.
 */
function bumpVersion(hybridId) {
  const parts   = hybridId.split('-');
  const verIdx  = parts.length - 2; // second-to-last is Vxx
  const current = parseInt(parts[verIdx].slice(1), 10);
  parts[verIdx] = `V${String(current + 1).padStart(2, '0')}`;
  parts[parts.length - 1] = 'D';
  return parts.join('-');
}

module.exports = {
  buildBaseId,
  buildHybridId,
  buildUrl,
  transitionState,
  bumpVersion,
  snowflakeId,
  DOMAIN_CODES,
  CONTENT_TYPES,
  CATEGORY_CODES,
  STATE_CODES,
};
