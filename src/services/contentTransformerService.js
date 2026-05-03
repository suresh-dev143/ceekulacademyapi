'use strict';

/**
 * Content Transformer Service
 *
 * Converts a CID's generic block content into a domain-specific structure
 * on demand. Uses a hybrid approach:
 *
 *   Layer 1 — Deterministic:  heading detection, block grouping, segmentation
 *   Layer 2 — Heuristics:     word-count duration, category→intent mapping
 *   Layer 3 — AI (future):    optional summarization/refinement per spec
 *
 * Results are cached in transformed_content. Cache is invalidated when
 * source content.updatedAt advances past the stored contentUpdatedAt.
 *
 * Supported targets: workshop | course | research | advertisement
 */

const CreatorDraft       = require('../models/creatorDraftModel');
const CreatorContent     = require('../models/creatorContentModel');
const TransformedContent = require('../models/transformedContentModel');

// ── Public API ─────────────────────────────────────────────────────────────────

async function transformContent(cid, targetType, ownerId) {
  const SUPPORTED = ['workshop', 'course', 'research', 'advertisement'];
  if (!SUPPORTED.includes(targetType)) {
    throw Object.assign(
      new Error(`Unsupported target type "${targetType}". Valid: ${SUPPORTED.join(', ')}`),
      { status: 400 }
    );
  }

  const source = await _fetchSource(cid, ownerId);
  if (!source) throw Object.assign(new Error('Content not found'), { status: 404 });

  // Cache hit: source hasn't changed since last transform
  const cached = await TransformedContent.findOne({ cid, targetType }).lean();
  if (cached && _isFresh(cached.contentUpdatedAt, source.updatedAt)) {
    return {
      cid,
      targetType,
      version:  cached.version,
      data:     cached.data,
      status:   cached.status,
      message:  cached.message ?? undefined,
      fromCache: true,
    };
  }

  // Run deterministic transformation
  const result = _runTransform(source, targetType);

  // Upsert cache
  await TransformedContent.findOneAndUpdate(
    { cid, targetType },
    {
      $set: {
        version:          source.version ?? 1,
        data:             result.data,
        contentUpdatedAt: source.updatedAt,
        status:           result.status,
        message:          result.message ?? null,
      },
    },
    { upsert: true }
  );

  return {
    cid,
    targetType,
    version:   source.version ?? 1,
    data:      result.data,
    status:    result.status,
    message:   result.message,
    fromCache: false,
  };
}

// ── Dispatch ───────────────────────────────────────────────────────────────────

function _runTransform(source, targetType) {
  const blocks = [...(source.blocks ?? [])].sort((a, b) => a.order - b.order);
  const tags   = source.domainTags ?? [];

  if (!blocks.length) {
    return {
      status:  'needs_review',
      message: 'No content blocks found. Add headings and text to your content first.',
      data:    {},
    };
  }

  switch (targetType) {
    case 'workshop':      return _transformWorkshop(blocks, source.title, tags);
    case 'course':        return _transformCourse(blocks, source.title, tags);
    case 'research':      return _transformResearch(blocks, source.title, tags);
    case 'advertisement': return _transformAdvertisement(blocks, source.title, source.category);
  }
}

// ── Workshop ──────────────────────────────────────────────────────────────────
//
// Rules from spec:
//   - Split by headings; fallback: divide into 3 equal chunks
//   - Session 2 title MUST be "Hands On"
//   - Session 3 title MUST be "Project Discussion"

function _transformWorkshop(blocks, title) {
  const segments = _extractSegments(blocks);
  let rawSessions;

  if (segments.length >= 3) {
    rawSessions = segments.slice(0, 3);
  } else if (segments.length === 2) {
    const [s1, s2] = segments;
    const mid = Math.ceil(s2.blocks.length / 2);
    rawSessions = [
      s1,
      { heading: s2.heading, blocks: s2.blocks.slice(0, mid) },
      { heading: null,        blocks: s2.blocks.slice(mid)   },
    ];
  } else if (segments.length === 1) {
    rawSessions = _splitIntoChunks(segments[0].blocks, 3)
      .map(b => ({ heading: null, blocks: b }));
  } else {
    rawSessions = _splitIntoChunks(blocks, 3)
      .map(b => ({ heading: null, blocks: b }));
  }

  const sessions = rawSessions.map((seg, i) => ({
    order:       i + 1,
    title:       i === 1 ? 'Hands On'
                : i === 2 ? 'Project Discussion'
                : (seg.heading ?? `Session ${i + 1}`),
    description: _descriptionFromBlocks(seg.blocks),
  }));

  const hasContent = sessions.some(s => s.description.length > 0);
  return {
    status:  hasContent ? 'ok' : 'needs_review',
    message: hasContent
      ? undefined
      : 'Content is too sparse to generate meaningful sessions. Add more text or headings.',
    data: { sessions },
  };
}

// ── Course ────────────────────────────────────────────────────────────────────
//
// Each heading block → lecture.  Duration = text word count ÷ 200 + video count × 5 min.

function _transformCourse(blocks, title) {
  const segments = _extractSegments(blocks);

  if (!segments.length) {
    return {
      status:  'needs_review',
      message: 'Add <h2> or <h3> headings to your content to generate lectures.',
      data:    { lectures: [] },
    };
  }

  const lectures = segments.map(seg => {
    const textWords  = seg.blocks
      .filter(b => b.type === 'text')
      .reduce((n, b) => n + _wordCount(b.content?.html ?? ''), 0);
    const videoCount = seg.blocks.filter(b => b.type === 'video').length;
    const duration   = Math.max(1, Math.round(textWords / 200) + videoCount * 5);

    return {
      title:       seg.heading ?? title,
      description: _descriptionFromBlocks(seg.blocks),
      duration,    // estimated minutes
    };
  });

  return { status: 'ok', data: { lectures } };
}

// ── Research ──────────────────────────────────────────────────────────────────
//
// problem    → first non-heading text block (plain text, ≤ 500 chars)
// hypothesis → title + second text block summary
// keywords   → domainTags fallback to title words

function _transformResearch(blocks, title, tags) {
  const textBlocks = blocks
    .filter(b => b.type === 'text')
    .filter(b => !_isHeadingHtml(b.content?.html ?? ''));

  const problem    = _stripHtml(textBlocks[0]?.content?.html ?? '').slice(0, 500) || title;
  const secondText = _stripHtml(textBlocks[1]?.content?.html ?? '').slice(0, 300);
  const hypothesis = secondText ? `${title} — ${secondText}` : title;
  const keywords   = tags.length
    ? tags
    : title.split(/\s+/).filter(w => w.length > 3).slice(0, 5);

  return {
    status: 'ok',
    data: { problem, hypothesis, keywords },
  };
}

// ── Advertisement ─────────────────────────────────────────────────────────────
//
// title    → content.title
// mediaUrl → first video or image block src
// type     → inferred from category

function _transformAdvertisement(blocks, title, category) {
  const mediaBlock = blocks.find(b => b.type === 'video' || b.type === 'image');
  const mediaUrl   = (mediaBlock?.content?.src ?? '').toString();
  const adType     = _categoryToAdType(category);

  return {
    status:  mediaUrl ? 'ok' : 'needs_review',
    message: mediaUrl
      ? undefined
      : 'No image or video block found. Add media to generate an advertisement.',
    data: { title, mediaUrl, type: adType },
  };
}

// ── Segment extraction ─────────────────────────────────────────────────────────
//
// Splits an ordered block array into segments by heading (<h1>–<h3>) tags
// found at the start of text blocks.

function _extractSegments(blocks) {
  const segments = [];
  let current    = { heading: null, blocks: [] };

  for (const block of blocks) {
    if (block.type !== 'text') {
      current.blocks.push(block);
      continue;
    }

    const html = (block.content?.html ?? '').trim();
    const m    = html.match(/^<h[1-3][^>]*>(.*?)<\/h[1-3]>/i);

    if (m) {
      // Flush current segment before starting a new one
      if (current.heading !== null || current.blocks.length) {
        segments.push(current);
      }
      current = { heading: _stripHtml(m[1]), blocks: [] };

      // Content following the heading tag in the same block → first block of new segment
      const rest = html.replace(/^<h[1-3][^>]*>.*?<\/h[1-3]>/i, '').trim();
      if (rest) current.blocks.push({ ...block, content: { ...block.content, html: rest } });
    } else {
      current.blocks.push(block);
    }
  }

  if (current.heading !== null || current.blocks.length) segments.push(current);
  return segments;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _splitIntoChunks(arr, n) {
  const result = [];
  const size   = Math.ceil(arr.length / Math.max(n, 1));
  for (let i = 0; i < n; i++) result.push(arr.slice(i * size, (i + 1) * size));
  return result;
}

function _descriptionFromBlocks(blocks) {
  return (blocks ?? [])
    .filter(b => b.type === 'text')
    .map(b => _stripHtml(b.content?.html ?? ''))
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}

function _isHeadingHtml(html) {
  return /^<h[1-3][^>]*>/i.test((html ?? '').trim());
}

function _stripHtml(html) {
  return (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function _wordCount(html) {
  return (_stripHtml(html).match(/\S+/g) ?? []).length;
}

function _categoryToAdType(category) {
  const map = {
    course:        'educational',
    research:      'informational',
    workshop:      'skill-building',
    webinar:       'promotional',
    entertainment: 'entertainment',
    project:       'project-showcase',
  };
  return map[(category ?? '').toLowerCase()] ?? 'educational';
}

function _isFresh(cachedAt, sourceUpdatedAt) {
  if (!cachedAt || !sourceUpdatedAt) return false;
  return new Date(cachedAt) >= new Date(sourceUpdatedAt);
}

async function _fetchSource(cid, ownerId) {
  const draft = await CreatorDraft.findOne({ baseId: cid, ownerId }).lean();
  if (draft) return draft;
  return CreatorContent.findOne({ baseId: cid, ownerId }).lean();
}

module.exports = { transformContent };
