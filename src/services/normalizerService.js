'use strict';

/**
 * Normalizer Service — produces a deterministic canonical form of any content
 * payload before it is hashed into a CID.
 *
 * Rules applied to every payload:
 *   - All strings are trimmed
 *   - Keywords/tags arrays are lowercased, deduped, and sorted
 *   - Block arrays are sorted by .order
 *   - Enum fields (domain, category) are lowercased
 *   - undefined/null optional fields are dropped, not stored as null
 *
 * Supported content types: lecture | workshop-hour | research | ad | product
 */

// ── Primitive helpers ─────────────────────────────────────────────────────────

function _str(v) { return typeof v === 'string' ? v.trim() : ''; }
function _lc(v)  { return _str(v).toLowerCase(); }
function _num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function _keywords(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(k => _lc(k)).filter(Boolean))].sort();
}

function _blocks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((b, i) => ({
      blockId: _str(b.blockId) || String(i),
      type:    _str(b.type) || 'text',
      content: b.content ?? {},
      order:   _num(b.order ?? i),
    }))
    .sort((a, b) => a.order - b.order);
}

// ── Per-type schemas ──────────────────────────────────────────────────────────

const _schemas = {
  'lecture': (p) => ({
    contentType: 'lecture',
    title:       _str(p.title),
    subtitle:    _str(p.subtitle),
    body:        _str(p.body),
    blocks:      _blocks(p.blocks),
    keywords:    _keywords(p.keywords),
    domain:      _lc(p.domain),
    category:    _lc(p.category),
  }),

  'workshop-hour': (p) => ({
    contentType: 'workshop-hour',
    title:       _str(p.title),
    subtitle:    _str(p.subtitle),
    body:        _str(p.body),
    blocks:      _blocks(p.blocks),
    keywords:    _keywords(p.keywords),
    domain:      _lc(p.domain),
    category:    _lc(p.category),
  }),

  'research': (p) => ({
    contentType: 'research',
    title:       _str(p.title),
    subtitle:    _str(p.subtitle),
    body:        _str(p.body),
    blocks:      _blocks(p.blocks),
    keywords:    _keywords(p.keywords),
    domain:      _lc(p.domain),
    category:    _lc(p.category),
  }),

  'ad': (p) => ({
    contentType: 'ad',
    title:       _str(p.title),
    subtitle:    _str(p.subtitle),
    body:        _str(p.body),
    mediaUrl:    _str(p.mediaUrl),
    keywords:    _keywords(p.keywords),
    category:    _lc(p.category),
  }),

  'product': (p) => ({
    contentType: 'product',
    title:       _str(p.title),
    subtitle:    _str(p.subtitle),
    body:        _str(p.body),
    price:       _num(p.price),
    keywords:    _keywords(p.keywords),
    category:    _lc(p.category),
  }),

  'workshop-session': (p) => ({
    contentType:      'workshop-session',
    workshopId:       _str(p.workshopId),
    scheduleId:       _str(p.scheduleId),
    title:            _str(p.title),
    startedAt:        _str(p.startedAt),
    elapsedSecs:      _num(p.elapsedSecs),
    participantCount: _num(p.participantCount),
    chatCount:        _num(p.chatCount),
    eventType:        _lc(p.eventType),   // 'start' | 'micro' | 'end'
  }),

  'session-summary': (p) => ({
    contentType:      'session-summary',
    sessionCid:       _str(p.sessionCid),
    title:            _str(p.title),
    summary:          _str(p.summary),
    keyTopics:        _keywords(p.keyTopics),
    insights:         Array.isArray(p.insights) ? p.insights.map(_str).filter(Boolean) : [],
    totalSecs:        _num(p.totalSecs),
    peakParticipants: _num(p.peakParticipants),
    totalMessages:    _num(p.totalMessages),
  }),
};

const CONTENT_TYPES = Object.keys(_schemas);

function normalize(contentType, payload) {
  const schema = _schemas[contentType];
  if (!schema) {
    throw Object.assign(
      new Error(`Unknown contentType "${contentType}". Valid: ${CONTENT_TYPES.join(', ')}`),
      { status: 400 }
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('payload must be a non-null object'), { status: 400 });
  }
  return schema(payload);
}

module.exports = { normalize, CONTENT_TYPES };
