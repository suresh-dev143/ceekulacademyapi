'use strict';

const { runCoTeacher, runAdGenerator, runWorkshopGenerator } = require('../services/claudeService');
const { getOrCreateTwin }              = require('../services/digitalTwinService');

// POST /api/claude/co-teacher
async function coTeacher(req, res) {
  const { sessionId, userMessage, contentContext } = req.body;
  const userId = req.user._id;

  if (!userMessage) return res.status(400).json({ status: false, message: 'userMessage required' });

  const twinContext = await getOrCreateTwin(userId);

  const reply = await runCoTeacher({
    userId,
    sessionId: sessionId ?? `session_${userId}`,
    userMessage,
    contentContext: contentContext ?? {},
    twinContext
  });

  res.json({ status: true, data: { reply } });
}

// POST /api/claude/ad-copy
async function adCopy(req, res) {
  const { contentContext, adCriteria } = req.body;
  const userId = req.user._id;

  const twinContext = await getOrCreateTwin(userId);

  const ad = await runAdGenerator({ userId, contentContext, twinContext, adCriteria });

  res.json({ status: true, data: ad });
}

// POST /api/claude/generate-workshop
async function generateWorkshop(req, res) {
  const { topic, audience, language, mode } = req.body;

  if (!topic?.trim()) return res.status(400).json({ status: false, message: 'topic is required' });

  const validAudiences = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
  const validModes     = ['ONLINE', 'OFFLINE'];

  const resolvedAudience = validAudiences.includes(audience) ? audience : 'INTERMEDIATE';
  const resolvedMode     = validModes.includes(mode) ? mode : 'ONLINE';
  const resolvedLanguage = language?.trim() || 'English';

  const data = await runWorkshopGenerator({
    topic:    topic.trim(),
    audience: resolvedAudience,
    language: resolvedLanguage,
    mode:     resolvedMode
  });

  res.json({ status: true, data });
}

module.exports = { coTeacher, adCopy, generateWorkshop };
