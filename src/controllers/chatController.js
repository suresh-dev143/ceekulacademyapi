'use strict';

const ChatMessage = require('../models/chatMessageModel');
const ChatSummary = require('../models/chatSummaryModel');

// GET /api/chat/:lectureId/history?limit=50&before=<messageId>
async function getHistory(req, res, next) {
  try {
    const { lectureId }  = req.params;
    const limit          = Math.min(parseInt(req.query.limit) || 50, 200);
    const before         = req.query.before;

    const filter = {
      lectureId,
      'moderation.status': { $ne: 'blocked' }
    };
    if (before) filter._id = { $lt: before };

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ status: true, data: messages.reverse() });
  } catch (err) {
    next(err);
  }
}

// GET /api/chat/:lectureId/summary
async function getSummary(req, res, next) {
  try {
    const { lectureId } = req.params;
    const summary = await ChatSummary.findOne({ lectureId })
      .sort({ generatedAt: -1 })
      .lean();

    res.json({ status: true, data: summary });
  } catch (err) {
    next(err);
  }
}

// GET /api/chat/:lectureId/stats
async function getStats(req, res, next) {
  try {
    const { lectureId } = req.params;

    const [total, questions, flagged, blocked] = await Promise.all([
      ChatMessage.countDocuments({ lectureId }),
      ChatMessage.countDocuments({ lectureId, isQuestion: true }),
      ChatMessage.countDocuments({ lectureId, 'moderation.status': 'flagged' }),
      ChatMessage.countDocuments({ lectureId, 'moderation.status': 'blocked' })
    ]);

    const uniqueAuthors = await ChatMessage.distinct('authorId', { lectureId });

    res.json({
      status: true,
      data: {
        total,
        questions,
        flagged,
        blocked,
        approved: total - flagged - blocked,
        uniqueParticipants: uniqueAuthors.length
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHistory, getSummary, getStats };
