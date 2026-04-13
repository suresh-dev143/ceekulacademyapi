'use strict';

const ContentVersion = require('../models/contentVersionModel');
const Lecture        = require('../models/lectureModel');
const {
  runContentOptimizer,
  runResearchMapper,
  runMultimediaEnricher,
  runQualityChecker
} = require('./claudeService');

// Cognitive level ordering — used to pick the nearest available layer
const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced', 'expert'];
const LEVEL_TO_LAYER = {
  beginner:     'simplified',
  intermediate: null,          // use base content
  advanced:     'mathematical',
  expert:       'research'
};

// ── Get active version of a lecture ──────────────────────────────────────────

async function getActiveVersion(lectureId) {
  return ContentVersion.findOne({ lectureId, isActive: true })
    .sort({ version: -1 })
    .lean();
}

// ── Get all versions (history) ────────────────────────────────────────────────

async function getVersionHistory(lectureId) {
  return ContentVersion.find({ lectureId })
    .sort({ version: -1 })
    .select('version changeType changeReason createdAt isActive outcome triggerMetrics')
    .lean();
}

// ── Create initial version ────────────────────────────────────────────────────

async function createInitialVersion(lectureId, segments) {
  const existing = await ContentVersion.findOne({ lectureId }).lean();
  if (existing) throw new Error('Initial version already exists for this lecture');

  return ContentVersion.create({
    lectureId,
    version:    1,
    changeType: 'initial',
    segments:   segments.map((s, i) => ({ ...s, order: i + 1, changeFlag: 'added' })),
    isActive:   true
  });
}

// ── Trigger AI content optimisation ──────────────────────────────────────────

async function optimiseContent(lectureId, triggerMetrics) {
  const current = await getActiveVersion(lectureId);
  if (!current) throw new Error('No active version found for lecture');

  const segmentSummaries = current.segments.map(s => ({
    type:       s.type,
    title:      s.title,
    watchRatio: triggerMetrics.segmentWatchRatios?.[s.order] ?? null
  }));

  const optimisation = await runContentOptimizer({
    lectureId,
    triggerMetrics,
    segmentSummaries
  });

  // Build updated segments array, applying Claude's recommendations
  const changeMap = {};
  for (const ch of optimisation.changes ?? []) {
    changeMap[ch.segmentOrder] = ch;
  }

  const newSegments = current.segments.map(seg => {
    const ch = changeMap[seg.order];
    if (!ch) return { ...seg, changeFlag: 'unchanged' };

    return {
      ...seg,
      changeSummary: ch.detail,
      changeFlag:    'modified',
      // Store optimiser instruction in changeSummary; actual rewrite is async
    };
  });

  // Deactivate current version
  await ContentVersion.findByIdAndUpdate(current._id, { isActive: false });

  // Create new version
  const newVersion = await ContentVersion.create({
    lectureId,
    version:       (current.version ?? 1) + 1,
    changeType:    optimisation.changeType,
    changeReason:  optimisation.changeReason,
    triggerMetrics,
    segments:      newSegments,
    isActive:      true
  });

  return { version: newVersion.version, optimisation };
}

// ── Integrate new research paper ──────────────────────────────────────────────

async function integrateResearch(lectureId, { researchTitle, researchAbstract }) {
  const current = await getActiveVersion(lectureId);
  if (!current) throw new Error('No active version found for lecture');

  const mapping = await runResearchMapper({
    lectureTitle:     current.segments[0]?.title ?? 'Unknown',
    lectureCategory:  'general',
    existingSegments: current.segments,
    researchTitle,
    researchAbstract
  });

  if (mapping.relevanceScore < 3) {
    return { skipped: true, relevanceScore: mapping.relevanceScore };
  }

  // Apply citation + change flags to affected segments
  const affectedSet = new Set(mapping.affectedSegments ?? []);
  const newSegments = current.segments.map(seg => {
    if (!affectedSet.has(seg.order)) return { ...seg, changeFlag: 'unchanged' };

    const change = (mapping.suggestedChanges ?? []).find(c => c.segmentOrder === seg.order);
    const citation = {
      title:    researchTitle,
      authors:  '',
      summary:  mapping.researchSummary,
      addedAt:  new Date()
    };

    return {
      ...seg,
      citations:     [...(seg.citations ?? []), citation],
      changeFlag:    'modified',
      changeSummary: change?.detail ?? mapping.whatChanged
    };
  });

  // Deactivate current version
  await ContentVersion.findByIdAndUpdate(current._id, { isActive: false });

  // Create new version
  const newVersion = await ContentVersion.create({
    lectureId,
    version:      (current.version ?? 1) + 1,
    changeType:   'research_update',
    changeReason: mapping.whatChanged,
    segments:     newSegments,
    isActive:     true
  });

  return { version: newVersion.version, mapping };
}

// ── Get a specific depth layer for a segment ─────────────────────────────────

async function getSegmentForDepth(lectureId, segmentOrder, depth) {
  const version = await getActiveVersion(lectureId);
  if (!version) return null;

  const seg = version.segments.find(s => s.order === segmentOrder);
  if (!seg) return null;

  const layerContent = seg.layers?.[depth];
  return {
    order:   seg.order,
    title:   seg.title,
    type:    seg.type,
    content: layerContent || seg.content,   // fall back to base content
    depth,
    usingFallback: !layerContent
  };
}

// ── Record version outcome (after measuring next-week engagement) ─────────────

async function recordOutcome(lectureId, { avgWatchRatioDelta, avgQuizScoreDelta, completionRateDelta }) {
  const version = await getActiveVersion(lectureId);
  if (!version) throw new Error('No active version found');

  await ContentVersion.findByIdAndUpdate(version._id, {
    $set: {
      outcome: {
        avgWatchRatioDelta,
        avgQuizScoreDelta,
        completionRateDelta,
        evaluatedAt: new Date()
      }
    }
  });

  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════════════
// ADAPTIVE RENDER — fuse cognitive layer + media for a specific learner
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Returns the full content version rendered for a given learner profile.
 * For each segment:
 *  1. Selects the cognitive layer that best matches the learner's level
 *  2. Attaches mediaAssets (images, video clips, interactive elements)
 *  3. Filters out interactive elements that don't match the level
 *
 * @param {string} lectureId
 * @param {{ level: string, preferredDepth?: string }} learnerProfile
 *   level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
 *   preferredDepth: optional explicit override ('simplified'|'visual'|'mathematical'|'research')
 */
async function renderForLearner(lectureId, learnerProfile = {}) {
  const version = await getActiveVersion(lectureId);
  if (!version) throw new Error('No active content version for this lecture');

  const level        = learnerProfile.level || 'intermediate';
  const forcedDepth  = learnerProfile.preferredDepth;   // explicit override

  const renderedSegments = version.segments.map(seg => {
    // Pick content layer
    let renderedContent = seg.content;   // base fallback
    let usedDepth       = 'base';

    if (forcedDepth && seg.layers?.[forcedDepth]) {
      renderedContent = seg.layers[forcedDepth];
      usedDepth       = forcedDepth;
    } else {
      const targetLayer = LEVEL_TO_LAYER[level];
      if (targetLayer && seg.layers?.[targetLayer]) {
        renderedContent = seg.layers[targetLayer];
        usedDepth       = targetLayer;
      } else if (level === 'beginner' && seg.layers?.simplified) {
        renderedContent = seg.layers.simplified;
        usedDepth       = 'simplified';
      } else if (level === 'expert' && seg.layers?.research) {
        renderedContent = seg.layers.research;
        usedDepth       = 'research';
      }
    }

    // Filter interactive elements to learner's level
    const interactiveElements = (seg.mediaAssets?.interactiveElements ?? []).filter(el => {
      // quizzes and polls suit all levels; simulations and code-sandbox suit advanced+
      if (['quiz', 'poll', 'drag-drop'].includes(el.elementType)) return true;
      if (['simulation', 'code-sandbox'].includes(el.elementType)) {
        return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf('advanced');
      }
      return true;
    });

    return {
      order:               seg.order,
      type:                seg.type,
      title:               seg.title,
      content:             renderedContent,
      usedDepth,
      cognitiveTarget:     seg.cognitiveTarget,
      availableLayers:     Object.keys(seg.layers || {}).filter(k => !!seg.layers[k]),
      citations:           seg.citations ?? [],
      changeFlag:          seg.changeFlag,
      changeSummary:       seg.changeSummary,
      mediaAssets: {
        images:              seg.mediaAssets?.images       ?? [],
        videoClips:          seg.mediaAssets?.videoClips   ?? [],
        interactiveElements,
        animationCues:       seg.mediaAssets?.animationCues ?? []
      },
      qualityMetrics:      seg.qualityMetrics ?? null
    };
  });

  return {
    lectureId,
    version:          version.version,
    changeType:       version.changeType,
    qualityApproved:  version.qualityApproved,
    learnerLevel:     level,
    segments:         renderedSegments
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// MULTIMEDIA ENRICHMENT — Claude generates assets for a single segment
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Runs the multimedia enricher Claude agent for one segment,
 * saves the generated assets back to the active version (in-place update),
 * and creates a new version with changeType = 'media_enriched'.
 *
 * @param {string} lectureId
 * @param {number} segmentOrder   — 1-indexed segment order number
 */
async function enrichSegmentMedia(lectureId, segmentOrder) {
  const current = await getActiveVersion(lectureId);
  if (!current) throw new Error('No active version found for lecture');

  const lecture = await Lecture.findById(lectureId).select('title').lean();
  const seg     = current.segments.find(s => s.order === segmentOrder);
  if (!seg) throw new Error(`Segment ${segmentOrder} not found`);

  // Run Claude multimedia enricher
  const assets = await runMultimediaEnricher({
    lectureTitle: lecture?.title ?? 'Unknown',
    segment:      seg
  });

  // Map Claude output → mediaAssets schema
  const mediaAssets = {
    images: (assets.images ?? []).map((img, i) => ({
      url:     '',            // URL populated when teacher uploads/links the actual image
      alt:     img.alt,
      caption: img.caption,
      order:   img.order ?? i + 1
    })),
    videoClips: (assets.videoClips ?? []).map(vc => ({
      url:      '',           // filled when teacher links the clip
      startSec: vc.startSec,
      endSec:   vc.endSec,
      label:    vc.label
    })),
    interactiveElements: (assets.interactiveElements ?? []).map(el => ({
      elementType: el.elementType,
      prompt:      el.prompt,
      config:      el.config ?? {}
    })),
    animationCues: (assets.animationCues ?? []).map(ac => ({
      triggerWord: ac.triggerWord,
      cueType:     ac.cueType,
      target:      ac.target
    }))
  };

  // Build updated segments — only the enriched segment changes
  const newSegments = current.segments.map(s =>
    s.order === segmentOrder
      ? { ...s.toObject?.() ?? s, mediaAssets, changeFlag: 'modified', changeSummary: 'Media assets enriched by AI' }
      : { ...s.toObject?.() ?? s, changeFlag: 'unchanged' }
  );

  await ContentVersion.findByIdAndUpdate(current._id, { isActive: false });

  const newVersion = await ContentVersion.create({
    lectureId,
    version:      (current.version ?? 1) + 1,
    changeType:   'media_enriched',
    changeReason: `Segment ${segmentOrder} enriched with multimedia assets`,
    segments:     newSegments,
    isActive:     true
  });

  return { version: newVersion.version, segmentOrder, assets };
}

// ═════════════════════════════════════════════════════════════════════════════
// QUALITY CHECK — grammar + clarity scoring for all segments
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Runs the quality checker Claude agent over every segment of the active version.
 * Segments with overallVerdict !== 'pass' get their content replaced with the
 * revised version and a 'quality_improved' version is created.
 *
 * @param {string} lectureId
 * @returns {{ version, results: Array<{ order, grammarScore, clarityScore, verdict, issueCount }> }}
 */
async function checkQuality(lectureId) {
  const current = await getActiveVersion(lectureId);
  if (!current) throw new Error('No active version found for lecture');

  const results   = [];
  let anyImproved = false;

  const newSegments = await Promise.all(
    current.segments.map(async seg => {
      const qc = await runQualityChecker({ segment: seg });

      const qualityMetrics = {
        grammarScore: qc.grammarScore,
        clarityScore: qc.clarityScore,
        checkedAt:    new Date(),
        issues:       (qc.issues ?? []).map(i => ({
          issueType:  i.issueType,
          location:   i.location,
          suggestion: i.suggestion
        }))
      };

      results.push({
        order:        seg.order,
        title:        seg.title,
        grammarScore: qc.grammarScore,
        clarityScore: qc.clarityScore,
        verdict:      qc.overallVerdict,
        issueCount:   (qc.issues ?? []).length
      });

      const improved = qc.overallVerdict !== 'pass' && qc.revisedContent;
      if (improved) anyImproved = true;

      const base = seg.toObject?.() ?? seg;
      return {
        ...base,
        content:        improved ? qc.revisedContent : seg.content,
        qualityMetrics,
        changeFlag:     improved ? 'modified' : 'unchanged',
        changeSummary:  improved ? `Quality improved: ${qc.overallVerdict} → pass` : undefined
      };
    })
  );

  // Determine if all segments now pass quality gate
  const allPassed = results.every(
    r => r.grammarScore >= 70 && r.clarityScore >= 70
  );

  await ContentVersion.findByIdAndUpdate(current._id, { isActive: false });

  const newVersion = await ContentVersion.create({
    lectureId,
    version:         (current.version ?? 1) + 1,
    changeType:      anyImproved ? 'quality_improved' : 'error_corrected',
    changeReason:    anyImproved ? 'AI quality check: content revised' : 'AI quality check: no changes needed',
    segments:        newSegments,
    qualityApproved: allPassed,
    isActive:        true
  });

  return { version: newVersion.version, qualityApproved: allPassed, results };
}

module.exports = {
  getActiveVersion,
  getVersionHistory,
  createInitialVersion,
  optimiseContent,
  integrateResearch,
  getSegmentForDepth,
  recordOutcome,
  renderForLearner,
  enrichSegmentMedia,
  checkQuality
};
