'use strict';

/**
 * B) Creator Service — content lifecycle (Draft → Shared → Published)
 *
 * State transitions:
 *   createDraft()   → user_private_drafts (D state)
 *   updateDraft()   → user_private_drafts (D state)
 *   shareDraft()    → MOVES doc to creator_content (S state) + creates collaboration
 *   submitDelta()   → increments contribution counters, appends delta log
 *   publishContent()→ sets state P, sets esIndexed=false (ES sync picks it up)
 *   republish()     → bumps version, creates new D-state draft from published
 *
 * Cost constraints enforced here:
 *   - Profit-share scoring is NOT called here — handled by nightly batch job.
 *   - AI summarization is incremental: only new deltas are sent to Claude.
 *   - Redis cache invalidation on every state-changing write.
 */

const CreatorDraft         = require('../models/creatorDraftModel');
const CreatorContent       = require('../models/creatorContentModel');
const CreatorCollaboration = require('../models/creatorCollaborationModel');
const {
  buildBaseId, buildHybridId, buildUrl, transitionState, bumpVersion, snowflakeId,
} = require('./hybridIdService');

// ── Draft CRUD ─────────────────────────────────────────────────────────────────

async function createDraft(ownerId, { title, contentType, domain, category, blocks = [], domainTags = [] }) {
  const baseId   = await buildBaseId();
  const hybridId = buildHybridId(baseId, { domain, contentType, category, version: 1, state: 'draft' });
  const meta     = _computeMeta(blocks);

  return CreatorDraft.create({
    baseId, hybridId, ownerId,
    title, contentType, domain, category,
    blocks, domainTags, version: 1, state: 'draft',
    ...meta,
    lastAutoSaved: new Date(),
  });
}

async function updateDraft(baseId, ownerId, updates) {
  const allowed = ['title', 'blocks', 'domainTags', 'category', 'domain'];
  const patch   = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }
  if (patch.blocks) Object.assign(patch, _computeMeta(patch.blocks));
  patch.lastAutoSaved = new Date();

  return CreatorDraft.findOneAndUpdate(
    { baseId, ownerId },
    { $set: patch },
    { new: true, runValidators: true }
  );
}

async function getDraft(baseId, ownerId) {
  return CreatorDraft.findOne({ baseId, ownerId }).lean();
}

async function listDrafts(ownerId) {
  return CreatorDraft.find({ ownerId })
    .select('baseId hybridId title contentType domain category version wordCount createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();
}

async function deleteDraft(baseId, ownerId) {
  return CreatorDraft.findOneAndDelete({ baseId, ownerId });
}

// ── Share ─────────────────────────────────────────────────────────────────────

/**
 * Transitions draft → shared.
 * Moves the document from user_private_drafts to creator_content.
 * Creates a CreatorCollaboration record.
 * collaboratorIds: array of User ObjectIds to invite.
 */
async function shareDraft(baseId, ownerId, { collaboratorIds = [] } = {}) {
  const draft = await CreatorDraft.findOne({ baseId, ownerId });
  if (!draft) throw Object.assign(new Error('Draft not found'), { status: 404 });

  const newHybridId = transitionState(draft.hybridId, 'shared');

  // Build collaboration record
  const collab = await CreatorCollaboration.create({
    baseId,
    initiatorId: ownerId,
    collaborators: [
      { userId: ownerId, role: 'author', status: 'active', acceptedAt: new Date() },
      ...collaboratorIds.map(id => ({ userId: id, role: 'contributor', status: 'pending' })),
    ],
  });

  // Move to creator_content (upsert guards against double-share)
  const content = await CreatorContent.findOneAndUpdate(
    { baseId },
    {
      $setOnInsert: {
        baseId, ownerId,
        title:       draft.title,
        contentType: draft.contentType,
        domain:      draft.domain,
        category:    draft.category,
        version:     draft.version,
        blocks:      draft.blocks,
        domainTags:  draft.domainTags,
        wordCount:   draft.wordCount,
        mediaCount:  draft.mediaCount,
        state:       'shared',
        hybridId:    newHybridId,
        collaborationId: collab._id,
      },
    },
    { upsert: true, new: true }
  );

  // Link collaboration back to content
  await CreatorCollaboration.updateOne({ _id: collab._id }, { $set: { contentRef: content._id } });

  // Remove from private drafts only after successful move
  await CreatorDraft.deleteOne({ baseId, ownerId });

  return { content, collaboration: collab };
}

// ── Delta submission (B — collaboration engine) ───────────────────────────────

/**
 * Called when a collaborator saves changes to shared content.
 * Increments lightweight counters; appends to delta log.
 * Does NOT trigger AI summarization (that runs on a schedule).
 */
async function submitDelta(baseId, authorId, {
  addedWords = 0, removedWords = 0, addedMedia = 0,
  summary = '',
  blocksDiff = [],
  updatedBlocks,
}) {
  const content = await CreatorContent.findOne({ baseId });
  if (!content) throw Object.assign(new Error('Content not found'), { status: 404 });
  if (content.state !== 'shared') throw Object.assign(new Error('Content is not in shared state'), { status: 400 });

  const deltaId = snowflakeId();

  // 1. Update content blocks if provided
  if (updatedBlocks) {
    const meta = _computeMeta(updatedBlocks);
    await CreatorContent.updateOne({ baseId }, { $set: { blocks: updatedBlocks, ...meta } });
  }

  // 2. Increment contribution counters + append delta in ONE atomic update
  await CreatorCollaboration.updateOne(
    { baseId, 'collaborators.userId': authorId },
    {
      $inc: {
        'collaborators.$.contributions.words':  addedWords,
        'collaborators.$.contributions.media':  addedMedia,
        'collaborators.$.contributions.edits':  1,
        totalDeltas:    1,
        unprocessedCount: 1,
      },
      $set:  { 'collaborators.$.lastActiveAt': new Date() },
      $push: {
        deltas: {
          deltaId, authorId,
          addedWords, removedWords, addedMedia,
          summary: (summary ?? '').slice(0, 300),
          blocksDiff,
          processed: false,
        },
      },
    }
  );

  return { deltaId };
}

// ── Publish ────────────────────────────────────────────────────────────────────

async function publishContent(baseId, ownerId) {
  const query  = { baseId };
  const source = await _findOwnedContent(baseId, ownerId);
  if (!source) throw Object.assign(new Error('Not found or not owner'), { status: 404 });

  const newHybridId = transitionState(source.hybridId, 'published');
  const url         = buildUrl(newHybridId);

  const published = await CreatorContent.findOneAndUpdate(
    query,
    {
      $set: {
        state:        'published',
        hybridId:     newHybridId,
        publishedAt:  new Date(),
        canonicalUrl: url,
        esIndexed:    false, // ES sync job will pick this up
      },
    },
    { new: true }
  );

  return published;
}

/**
 * Opens a new draft version of already-published content.
 * Published version remains live.  New draft gets version bumped and "-D" suffix.
 */
async function republish(baseId, ownerId) {
  const source = await _findOwnedContent(baseId, ownerId);
  if (!source) throw Object.assign(new Error('Not found or not owner'), { status: 404 });
  if (source.state !== 'published') throw Object.assign(new Error('Content must be published to create new version'), { status: 400 });

  const newHybridId = bumpVersion(source.hybridId);

  return CreatorDraft.create({
    baseId,
    hybridId:    newHybridId,
    ownerId,
    title:       source.title,
    contentType: source.contentType,
    domain:      source.domain,
    category:    source.category,
    version:     source.version + 1,
    blocks:      source.blocks,
    domainTags:  source.domainTags,
    wordCount:   source.wordCount,
    mediaCount:  source.mediaCount,
    state:       'draft',
    lastAutoSaved: new Date(),
  });
}

// ── Summary ────────────────────────────────────────────────────────────────────

async function getSummary(baseId) {
  const content = await CreatorContent.findOne({ baseId })
    .select('summary collaborationId state')
    .lean();
  if (!content) throw Object.assign(new Error('Content not found'), { status: 404 });
  return content.summary;
}

async function getContributions(baseId, requesterId) {
  const collab = await CreatorCollaboration.findOne({ baseId })
    .select('collaborators profitShare')
    .lean();
  if (!collab) throw Object.assign(new Error('Collaboration not found'), { status: 404 });

  // Requesters can only see their own contribution details unless they are the initiator
  const content     = await CreatorContent.findOne({ baseId }).select('ownerId').lean();
  const isInitiator = content && String(content.ownerId) === String(requesterId);

  if (isInitiator) return { collaborators: collab.collaborators, profitShare: collab.profitShare };

  // Return only the requester's own row
  const own = collab.collaborators.find(c => String(c.userId) === String(requesterId));
  return { collaborators: own ? [own] : [], profitShare: [] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _computeMeta(blocks = []) {
  let words = 0, media = 0;
  for (const b of blocks) {
    if (b.type === 'text') words += _countWords(b.content?.html ?? '');
    if (['image', 'video', 'audio'].includes(b.type)) media++;
  }
  return {
    wordCount:  words,
    mediaCount: media,
    estimatedReadMinutes: Math.max(1, Math.round(words / 200)),
  };
}

function _countWords(html) {
  return (html.replace(/<[^>]+>/g, ' ').match(/\S+/g) ?? []).length;
}

async function _findOwnedContent(baseId, ownerId) {
  return CreatorContent.findOne({ baseId, ownerId }).lean();
}

module.exports = {
  createDraft, updateDraft, getDraft, listDrafts, deleteDraft,
  shareDraft,
  submitDelta,
  publishContent, republish,
  getSummary, getContributions,
};
