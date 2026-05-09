'use strict';

/**
 * UCRS Interaction Commit Router
 *
 * POST  /api/ucrs          — store a semantic interaction commit (chat, stream events, etc.)
 * GET   /api/ucrs/:sessionRef  — retrieve all commits for a session reference
 */

const express    = require('express');
const router     = express.Router();
const UCRSCommit = require('../models/ucrsCommitModel');
const { authenticateUser } = require('../middlewares');

function h(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); } catch (err) { next(err); }
  };
}

// POST /api/ucrs — fire-and-forget persist; idempotent on duplicate commitId
router.post('/', authenticateUser, h(async (req, res) => {
  const { commitId, type, sessionRef, speakerId, speakerName, content, semanticTags, parentCommit, reference, metadata } = req.body;

  if (!commitId || !type || !sessionRef || !speakerId || !reference) {
    return res.status(400).json({ status: false, message: 'commitId, type, sessionRef, speakerId, reference are required' });
  }

  try {
    const commit = await UCRSCommit.create({
      commitId, type, sessionRef, speakerId,
      speakerName: speakerName || 'Unknown',
      content:     content     || '',
      semanticTags: Array.isArray(semanticTags) ? semanticTags : [],
      parentCommit: parentCommit || null,
      reference,
      metadata:    metadata || {},
    });
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

// GET /api/ucrs/:sessionRef — all commits for a session, oldest first
router.get('/:sessionRef', authenticateUser, h(async (req, res) => {
  const commits = await UCRSCommit
    .find({ sessionRef: decodeURIComponent(req.params.sessionRef) })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ status: true, data: commits });
}));

module.exports = router;
