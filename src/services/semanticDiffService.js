'use strict';

/**
 * Semantic Diff Service — Semantic Evolution Observability
 *
 * Computes a structured, field-aware diff between two normalized UCE payloads.
 * Stored directly in uce_version_registry so "what changed in v3?" is answered
 * in a single document read — no need to fetch both versions.
 *
 * Field diff types:
 *   added            — field present in new, absent in old
 *   removed          — field present in old, absent in new
 *   modified_string  — string value changed (includes from/to for short strings)
 *   modified_array   — array changed (includes added/removed item lists)
 *   modified_blocks  — blocks array changed (count-based: added/removed/modified)
 *   modified_numeric — numeric value changed (includes delta)
 *
 * Unchanged fields are omitted from the output entirely.
 *
 * Public API:
 *   computeDiff(fromPayload, toPayload) → { summary, fields }
 */

// Strings below this length are stored in full inside the diff.
// Longer strings store only lengths — keeps registry documents compact.
const STRING_INLINE_MAX = 500;

// ── String similarity (Jaccard on word sets) ──────────────────────────────────
// Returns 0 = identical, 1 = completely different.
// Word-level Jaccard is fast, allocation-light, and meaningful for prose.

function _jaccardDistance(a, b) {
  if (a === b) return 0;
  const wordsA      = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB      = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const unionSize   = new Set([...wordsA, ...wordsB]).size;
  if (unionSize === 0) return 0;
  const interSize   = [...wordsA].filter(w => wordsB.has(w)).length;
  return 1 - interSize / unionSize;
}

// ── Per-type diff helpers ─────────────────────────────────────────────────────

function _diffString(fromVal, toVal) {
  if (fromVal === toVal) return null;

  if (fromVal === undefined || fromVal === null || fromVal === '') {
    const entry = { type: 'added', toLength: String(toVal).length };
    if (entry.toLength <= STRING_INLINE_MAX) entry.to = toVal;
    return entry;
  }
  if (toVal === undefined || toVal === null || toVal === '') {
    const entry = { type: 'removed', fromLength: String(fromVal).length };
    if (entry.fromLength <= STRING_INLINE_MAX) entry.from = fromVal;
    return entry;
  }

  const fromStr = String(fromVal);
  const toStr   = String(toVal);
  const entry   = {
    type:        'modified_string',
    fromLength:  fromStr.length,
    toLength:    toStr.length,
    lengthDelta: toStr.length - fromStr.length,
    distance:    Math.round(_jaccardDistance(fromStr, toStr) * 1000) / 1000,
  };
  if (fromStr.length <= STRING_INLINE_MAX && toStr.length <= STRING_INLINE_MAX) {
    entry.from = fromStr;
    entry.to   = toStr;
  }
  return entry;
}

function _diffArray(fromArr, toArr) {
  const fromSet = new Set(fromArr);
  const toSet   = new Set(toArr);
  const added   = toArr.filter(v => !fromSet.has(v));
  const removed = fromArr.filter(v => !toSet.has(v));
  if (added.length === 0 && removed.length === 0) return null;

  return {
    type:         'modified_array',
    addedCount:   added.length,
    removedCount: removed.length,
    added:        added.slice(0, 20),
    removed:      removed.slice(0, 20),
  };
}

function _diffBlocks(fromBlocks, toBlocks) {
  const fromMap = new Map(fromBlocks.map(b => [b.blockId, b]));
  const toMap   = new Map(toBlocks.map(b =>   [b.blockId, b]));

  const added    = toBlocks.filter(b  => !fromMap.has(b.blockId)).length;
  const removed  = fromBlocks.filter(b => !toMap.has(b.blockId)).length;
  const modified = [...toMap.entries()].filter(
    ([id, b]) => fromMap.has(id) && JSON.stringify(fromMap.get(id)) !== JSON.stringify(b)
  ).length;

  if (added === 0 && removed === 0 && modified === 0) return null;

  return {
    type:          'modified_blocks',
    fromCount:     fromBlocks.length,
    toCount:       toBlocks.length,
    addedCount:    added,
    removedCount:  removed,
    modifiedCount: modified,
  };
}

function _diffNumeric(fromVal, toVal) {
  if (fromVal === toVal) return null;
  return {
    type:  'modified_numeric',
    from:  fromVal,
    to:    toVal,
    delta: Math.round((toVal - fromVal) * 1000) / 1000,
  };
}

// ── Public: computeDiff ───────────────────────────────────────────────────────

/**
 * Compute a structured diff between two normalized UCE payloads.
 *
 * @param {object} fromPayload — the parent version's normalized payload
 * @param {object} toPayload   — the new version's normalized payload
 * @returns {{ summary: object, fields: object }}
 */
function computeDiff(fromPayload, toPayload) {
  const fields = {};
  let changedCount    = 0;
  let totalCount      = 0;
  let distanceSum     = 0;
  let distanceCount   = 0;

  // Union of all field keys; contentType never changes within a logical entity
  const allKeys = new Set([
    ...Object.keys(fromPayload),
    ...Object.keys(toPayload),
  ]);
  allKeys.delete('contentType');

  for (const key of allKeys) {
    totalCount++;
    const fromVal = fromPayload[key];
    const toVal   = toPayload[key];
    let   diff    = null;

    if (key === 'blocks') {
      diff = _diffBlocks(
        Array.isArray(fromVal) ? fromVal : [],
        Array.isArray(toVal)   ? toVal   : []
      );
    } else if (Array.isArray(fromVal) || Array.isArray(toVal)) {
      diff = _diffArray(
        Array.isArray(fromVal) ? fromVal : [],
        Array.isArray(toVal)   ? toVal   : []
      );
    } else if (typeof fromVal === 'number' || typeof toVal === 'number') {
      diff = _diffNumeric(fromVal ?? 0, toVal ?? 0);
    } else {
      diff = _diffString(fromVal, toVal);
      if (diff?.distance !== undefined) {
        distanceSum += diff.distance;
        distanceCount++;
      }
    }

    if (diff) {
      fields[key] = diff;
      changedCount++;
    }
  }

  const changeRatio      = totalCount > 0   ? changedCount / totalCount           : 0;
  const semanticDistance = distanceCount > 0 ? distanceSum  / distanceCount : 0;

  return {
    summary: {
      fieldsChanged:    changedCount,
      fieldsTotal:      totalCount,
      changeRatio:      Math.round(changeRatio      * 1000) / 1000,
      semanticDistance: Math.round(semanticDistance * 1000) / 1000,
    },
    fields,
  };
}

module.exports = { computeDiff };
