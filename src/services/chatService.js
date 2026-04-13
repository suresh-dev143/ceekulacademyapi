'use strict';

/**
 * Chat Service
 *
 * Attaches handlers to the /chat Socket.io namespace.
 *
 * Events handled (client → server):
 *   chat:message          — send a new message (auto-moderated)
 *   chat:summarize        — teacher requests AI summary
 *   chat:insights:request — teacher requests insight extraction
 *
 * Events emitted (server → client):
 *   chat:history          — last 50 approved/flagged messages on join
 *   chat:message          — broadcast of a new approved/flagged message
 *   chat:blocked          — sent to sender only when their message is blocked
 *   chat:summary          — AI-generated summary (broadcast to room)
 *   chat:insights         — AI-generated insights (teacher only)
 *   chat:error            — error notification
 */

const { getChatNS }           = require('../socket');
const ChatMessage             = require('../models/chatMessageModel');
const ChatSummary             = require('../models/chatSummaryModel');
const {
  runChatModerator,
  runChatSummarizer,
  runInsightExtractor
} = require('./claudeService');

// Auto-summarise after every N approved messages per room
const AUTO_SUMMARIZE_EVERY = 50;

// lectureId → count of messages since last auto-summary
const roomMessageCount = new Map();

// ── Init ──────────────────────────────────────────────────────────────────────

function initChatService() {
  const chatNS = getChatNS();
  if (!chatNS) {
    console.warn('[ChatService] /chat namespace not available — skipping init');
    return;
  }

  chatNS.on('connection', (socket) => {
    const { lectureId, userId, userName, role, lectureTitle } = socket.handshake.query;
    if (!lectureId) { socket.disconnect(true); return; }

    const room = `lecture:${lectureId}`;
    socket.join(room);
    console.log(`[Chat] ${role} ${userName} joined lecture:${lectureId}`);

    // ── Send recent message history on join ───────────────────────────────────
    ChatMessage.find({
      lectureId,
      'moderation.status': { $ne: 'blocked' }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .then(msgs => socket.emit('chat:history', msgs.reverse()))
      .catch(err => console.error('[Chat] history fetch error', err));

    // ── Incoming message ──────────────────────────────────────────────────────
    socket.on('chat:message', async (payload) => {
      const { content, replyTo } = payload || {};
      if (!content?.trim() || content.length > 1000) return;

      try {
        // 1. Run AI moderation
        const mod = await runChatModerator({
          message:        content,
          authorName:     userName,
          lectureContext: lectureTitle || ''
        });

        // 2. Persist message
        const msg = await ChatMessage.create({
          lectureId,
          authorId:   userId,
          authorName: userName,
          role:       role || 'student',
          content,
          replyTo:    replyTo || null,
          isQuestion: mod.isQuestion ?? false,
          sentiment:  mod.sentiment  ?? 'neutral',
          keywords:   mod.keywords   ?? [],
          moderation: {
            status:      mod.status,
            score:       mod.score       ?? 0,
            flags:       mod.flags       ?? [],
            reason:      mod.reason      ?? '',
            moderatedAt: new Date()
          }
        });

        // 3. Broadcast (skip blocked messages)
        if (mod.status !== 'blocked') {
          chatNS.to(room).emit('chat:message', msg);

          // 4. Auto-summarise threshold
          const count = (roomMessageCount.get(lectureId) ?? 0) + 1;
          roomMessageCount.set(lectureId, count);
          if (count % AUTO_SUMMARIZE_EVERY === 0) {
            _autoSummary(lectureId, lectureTitle || 'Lecture', chatNS).catch(() => {});
          }
        } else {
          // Notify only the blocked sender
          socket.emit('chat:blocked', { reason: mod.reason });
        }

      } catch (err) {
        console.error('[Chat] message processing error', err);
        socket.emit('chat:error', { message: 'Failed to send message. Try again.' });
      }
    });

    // ── Teacher: request summary ──────────────────────────────────────────────
    socket.on('chat:summarize', async () => {
      if (role !== 'teacher') return;
      try {
        const summary = await _autoSummary(lectureId, lectureTitle || 'Lecture', chatNS);
        if (!summary) socket.emit('chat:error', { message: 'No messages to summarise yet.' });
      } catch (err) {
        console.error('[Chat] summarize error', err);
        socket.emit('chat:error', { message: 'Summarisation failed.' });
      }
    });

    // ── Teacher: request insights ─────────────────────────────────────────────
    socket.on('chat:insights:request', async () => {
      if (role !== 'teacher') return;
      try {
        const messages = await ChatMessage.find({
          lectureId,
          'moderation.status': { $ne: 'blocked' }
        })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean();

        if (!messages.length) {
          socket.emit('chat:error', { message: 'No messages available for insight extraction.' });
          return;
        }

        const insights = await runInsightExtractor({
          messages:     messages.reverse(),
          lectureTitle: lectureTitle || 'Lecture'
        });

        socket.emit('chat:insights', insights);
      } catch (err) {
        console.error('[Chat] insights error', err);
        socket.emit('chat:error', { message: 'Insight extraction failed.' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Chat] ${userName} left lecture:${lectureId}`);
    });
  });

  console.log('[ChatService] Attached to /chat namespace');
}

// ── Auto-summary helper ───────────────────────────────────────────────────────

async function _autoSummary(lectureId, lectureTitle, chatNS) {
  const messages = await ChatMessage.find({
    lectureId,
    'moderation.status': { $ne: 'blocked' }
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  if (!messages.length) return null;

  const result = await runChatSummarizer({
    messages:     messages.reverse(),
    lectureTitle
  });

  const saved = await ChatSummary.create({
    lectureId,
    messageCount: messages.length,
    summary:      result.summary      || '',
    keyQuestions: result.keyQuestions || [],
    themes:       result.themes       || [],
    generatedAt:  new Date()
  });

  chatNS.to(`lecture:${lectureId}`).emit('chat:summary', saved);
  return saved;
}

module.exports = { initChatService };
