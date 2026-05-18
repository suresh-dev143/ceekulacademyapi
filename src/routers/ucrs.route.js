'use strict';

/**
 * UCRS Interaction Commit Router
 *
 * POST  /api/ucrs                    — store a semantic interaction commit
 * GET   /api/ucrs/content/:cid       — all UCRS commits that wrapped a UCE content CID (bridge query)
 * GET   /api/ucrs/:sessionRef        — all commits for a session reference
 * GET   /api/ucrs/ledger/:actorId    — actor event timeline
 */

const express    = require('express');
const router     = express.Router();
const UCRSCommit = require('../models/ucrsCommitModel');
const ledger     = require('../services/ucrsLedgerService');
const { authenticateUser } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); } catch (err) { next(err); }
  };
}

// POST /api/ucrs — fire-and-forget persist; idempotent on duplicate commitId
router.post('/', authenticateUser, h(async (req, res) => {
  const {
    commitId, type, sessionRef, speakerId, speakerName,
    content, semanticTags, parentCommit, reference, contentCid, metadata,
  } = req.body;

  if (!commitId || !type || !sessionRef || !speakerId || !reference) {
    return res.status(400).json({ status: false, message: 'commitId, type, sessionRef, speakerId, reference are required' });
  }

  try {
    const commit = await UCRSCommit.create({
      commitId, type, sessionRef, speakerId,
      speakerName:  speakerName || 'Unknown',
      content:      content     || '',
      semanticTags: Array.isArray(semanticTags) ? semanticTags : [],
      parentCommit: parentCommit || null,
      reference,
      contentCid:   contentCid  || null,
      metadata:     metadata    || {},
    });

    ledger.emit({
      eventType:  'COMMIT_CREATED',
      actorId:    speakerId,
      actorType:  'citizen',
      resourceId: commitId,
      sessionRef,
      payload:    { type, reference, contentCid: contentCid || null },
      ipHash:     req.ipHash ?? null,
      userAgent:  req.headers['user-agent'] ?? null,
    }).catch((err) => console.error('[ucrs] ledger.emit failed:', err.message));

    res.status(201).json({ status: true, data: commit });
  } catch (err) {
    if (err.code === 11000) {
      // Idempotent — commit already stored
      const existing = await UCRSCommit.findOne({ commitId }).lean();
      return res.status(200).json({ status: true, data: existing });
    }
    throw err;
  }
}));

// GET /api/ucrs/content/:cid — bridge query: all UCRS interactions that wrapped a UCE CID.
// Must be declared before GET /:sessionRef to avoid the catch-all param matching "content".
// Answers: "what was the interaction context at the time this content was committed?"
router.get('/content/:cid', authenticateUser, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before ? new Date(req.query.before) : undefined;

  const filter = { contentCid: req.params.cid };
  if (before) filter.createdAt = { $lt: before };

  const commits = await UCRSCommit
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({ status: true, data: commits });
}));

// GET /api/ucrs/:sessionRef — all commits for a session, oldest first
router.get('/:sessionRef', authenticateUser, h(async (req, res) => {
  const commits = await UCRSCommit
    .find({ sessionRef: decodeURIComponent(req.params.sessionRef) })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ status: true, data: commits });
}));

// GET /api/ucrs/ledger/:actorId — actor event timeline (newest first, paginated)
router.get('/ledger/:actorId', authenticateUser, h(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const before = req.query.before ? new Date(req.query.before) : undefined;
  const events = await ledger.getActorEvents(req.params.actorId, { limit, before });
  res.json({ status: true, data: events });
}));

module.exports = router;
