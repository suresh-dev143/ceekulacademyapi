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

// ── Screen helpers ────────────────────────────────────────────────────────────

// Bucket exact pixel widths into size classes so two iPhones with slightly
// different resolutions produce the same layout CID — enabling dedup across
// the real device population.
function _viewportClass(width) {
  const w = Number(width) || 0;
  if (w <= 480)  return 'xs';   // wearable, small phone
  if (w <= 768)  return 'sm';   // phone
  if (w <= 1024) return 'md';   // tablet, large phone landscape
  if (w <= 1440) return 'lg';   // laptop
  return 'xl';                  // desktop, large monitor
}

function _screenComponents(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((c, i) => ({
    id:      _str(c.id) || `c${i}`,
    type:    _lc(c.type || 'text'),   // text|button|image|list|input|nav|card|modal|divider
    content: _str(c.content || ''),
    visible: c.visible !== false,
    order:   _num(c.order ?? i),
    props:   c.props && typeof c.props === 'object' ? c.props : {},
  })).sort((a, b) => a.order - b.order);
}

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

  // ── Architecture Knowledge Base ───────────────────────────────────────────────
  // Committed once with trusted:true. Provides the stable CIDs that all
  // architecture queries reference instead of repeating full text inline.

  'architecture.spec': (p) => ({
    contentType: 'architecture.spec',
    specId:      _lc(p.specId),           // e.g. 'governance-roles', 'cg-id-system'
    title:       _str(p.title),
    version:     _str(p.version || '1.0.0'),
    body:        _str(p.body),            // full spec text, normalized
    keywords:    _keywords(p.keywords),
    domain:      _lc(p.domain || 'governance'),
  }),

  // A single architectural question that references committed spec CIDs.
  // Only the unique query text is hashed — shared context lives in specRefs.
  'architecture.query': (p) => ({
    contentType: 'architecture.query',
    promptId:    _lc(p.promptId),         // e.g. 'prompt-01-governance'
    title:       _str(p.title),
    query:       _str(p.query),           // the unique question only
    specRefs:    _keywords(p.specRefs),   // CIDs of referenced architecture.spec entries
    parentCid:   _str(p.parentCid || ''),
    model:       _lc(p.model || 'claude-opus-4-6'),
  }),

  // The Opus response committed back into UCE so future identical queries
  // hit the dedup gate and return O(1) without a new Opus call.
  'architecture.response': (p) => ({
    contentType: 'architecture.response',
    queryCid:    _str(p.queryCid),        // CID of the architecture.query that triggered this
    title:       _str(p.title),
    response:    _str(p.response),
    model:       _lc(p.model || 'claude-opus-4-6'),
    inputTokens: _num(p.inputTokens),
    outputTokens:_num(p.outputTokens),
    keywords:    _keywords(p.keywords),
  }),

  // ── Evolving Screen ───────────────────────────────────────────────────────────
  // Viewport is bucketed to xs/sm/md/lg/xl so two phones with slightly different
  // resolutions share the same layout CID — enabling O(1) dedup across the real
  // device population without any per-pixel divergence.

  'screen-layout': (p) => ({
    contentType:   'screen-layout',
    deviceType:    _lc(p.deviceType   || 'mobile'),   // mobile|tablet|laptop|desktop|wearable|machine
    viewportClass: _viewportClass(p.viewport?.width || 0),
    layoutType:    _lc(p.layoutType   || 'stack'),     // stack|grid|tabs|drawer|modal|split
    context:       _lc(p.context      || 'home'),      // route/page identifier
    theme:         _lc(p.theme        || 'default'),
    components:    _screenComponents(p.components),
    keywords:      _keywords(p.keywords),
  }),

  // A normalised user instruction — touch, click, voice, gesture, text input.
  // fromCid is the layout CID that was active when the instruction was issued,
  // enabling lineage tracing across the screen evolution chain.
  'ui-instruction': (p) => ({
    contentType:     'ui-instruction',
    instructionType: _lc(p.instructionType || 'tap'),  // tap|click|swipe|input|voice|gesture
    target:          _str(p.target),                   // component id or semantic label
    context:         _lc(p.context || ''),             // route context at instruction time
    value:           _str(p.value  || ''),             // typed text, voice transcript, etc.
    fromCid:         _str(p.fromCid || ''),            // active layout CID at instruction time
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

// Increment this when any normalizer schema changes so stale CIDs can be detected.
const NORMALIZER_VERSION = '1.0.0';

module.exports = { normalize, CONTENT_TYPES, NORMALIZER_VERSION };
