'use strict';

/**
 * Socket.io singleton — four namespaces:
 *
 *  /          (default) — scheduler phase-change events
 *                         room key: `session:${sessionId}`
 *
 *  /editor              — live collaborative editing events
 *                         room key: `lecture:${lectureId}`
 *
 *  /chat                — real-time lecture chat with AI moderation
 *                         room key: `lecture:${lectureId}`
 *
 *  /adaptive            — real-time cognitive state + mode-switching events
 *                         room key: `adaptive:${userId}:${sessionId}`
 *
 * Adaptive namespace events (client → server):
 *   adaptive:join          { userId, sessionId, topicId }
 *   adaptive:signal        { interactionRate, scrollDepth, dwellTime, ... }
 *   adaptive:reward        { rewardType }
 *   adaptive:force-mode    { mode }
 *
 * Adaptive namespace events (server → client):
 *   adaptive:state         full UserState doc
 *   adaptive:mode-change   { mode, reason, transition, animationProfile }
 *   adaptive:tier-change   { newTier, prevTier, hint }
 *   adaptive:error         { message }
 */

const { Server } = require('socket.io');

let io             = null;
let editorNS       = null;
let chatNS         = null;
let adaptiveNS     = null;
let discussionNS   = null;
let liveNS         = null;

// channelName → Map<socketId, { userId, userName }>
const liveRooms = new Map();

// In-memory participant registry: lectureId → Map<socketId, participantInfo>
const editorRooms = new Map();

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] },
    path: '/socket.io'
  });

  // ── Default namespace — scheduler ────────────────────────────────────────
  io.on('connection', (socket) => {
    const sessionId = socket.handshake.query.sessionId;
    if (sessionId) {
      socket.join(`session:${sessionId}`);
      console.log(`[Socket] Client joined session:${sessionId}`);
    }
    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected — session:${sessionId}`);
    });
  });

  // ── /editor namespace — live collaborative editing ───────────────────────
  editorNS = io.of('/editor');

  editorNS.on('connection', (socket) => {
    const { lectureId, userId, userName, role } = socket.handshake.query;
    if (!lectureId) { socket.disconnect(true); return; }

    const room        = `lecture:${lectureId}`;
    const participant = { socketId: socket.id, userId, userName, role, joinedAt: Date.now() };

    // Join room
    socket.join(room);

    // Track participant
    if (!editorRooms.has(lectureId)) editorRooms.set(lectureId, new Map());
    editorRooms.get(lectureId).set(socket.id, participant);

    // Announce updated participants list to everyone in the room
    _broadcastParticipants(lectureId);
    console.log(`[Editor] ${role} ${userName} joined lecture:${lectureId}`);

    // ── Text operation (insert / delete / replace) ─────────────────────────
    // op: { segmentOrder, type:'insert'|'delete'|'replace', position, text, length, authorId }
    socket.on('editor:op', (op) => {
      socket.to(room).emit('editor:op', { ...op, authorId: userId, ts: Date.now() });
    });

    // ── Cursor position broadcast ──────────────────────────────────────────
    // cursor: { segmentOrder, position, selection: { start, end } }
    socket.on('editor:cursor', (cursor) => {
      socket.to(room).emit('editor:cursor', {
        ...cursor, userId, userName, role, ts: Date.now()
      });
    });

    // ── Highlight with annotation (teacher adds note/question) ─────────────
    // highlight: { segmentOrder, start, end, type:'note'|'question'|'highlight', text }
    socket.on('editor:highlight', (hl) => {
      editorNS.to(room).emit('editor:highlight', {
        ...hl, authorId: userId, userName, ts: Date.now()
      });
    });

    // ── AI suggestion request (teacher only) ──────────────────────────────
    // Payload forwarded to liveEditService; response arrives via editor:suggestion:ready
    socket.on('editor:suggestion:request', (payload) => {
      socket.emit('editor:suggestion:ack', { requestId: payload.requestId });
      // liveEditService listens for this event and emits editor:suggestion:ready back
      editorNS.emit('editor:suggestion:internal', {
        ...payload, requesterId: socket.id, lectureId
      });
    });

    // ── Teacher commits a segment edit (triggers debounced version save) ───
    socket.on('editor:commit', (data) => {
      editorNS.to(room).emit('editor:commit', {
        ...data, authorId: userId, ts: Date.now()
      });
      // liveEditService picks this up via the internal event
      editorNS.emit('editor:commit:internal', { ...data, lectureId, userId });
    });

    socket.on('disconnect', () => {
      const rooms = editorRooms.get(lectureId);
      if (rooms) {
        rooms.delete(socket.id);
        if (rooms.size === 0) editorRooms.delete(lectureId);
      }
      _broadcastParticipants(lectureId);
      console.log(`[Editor] ${userName} left lecture:${lectureId}`);
    });
  });

  // ── /chat namespace — real-time lecture chat ─────────────────────────────
  // All message handling and AI moderation is done in chatService.js.
  // The namespace is created here so getChatNS() is available immediately.
  chatNS = io.of('/chat');

  // ── /adaptive namespace — real-time cognitive state + mode switching ──────
  adaptiveNS = io.of('/adaptive');

  // ── /discussion namespace — universal topic-based chat ───────────────────
  discussionNS = io.of('/discussion');

  // ── /live namespace — cost-free live room chat (replaces Agora RTM) ───────
  liveNS = io.of('/live');

  liveNS.on('connection', (socket) => {
    const { channelName, userId, userName } = socket.handshake.query;
    if (!channelName) { socket.disconnect(true); return; }

    const room = `live:${channelName}`;
    socket.join(room);

    if (!liveRooms.has(channelName)) liveRooms.set(channelName, new Map());
    liveRooms.get(channelName).set(socket.id, { userId, userName });

    socket.to(room).emit('live:presence', { type: 'join', userId, userName });
    console.log(`[Live] ${userName} joined live:${channelName}`);

    socket.on('live:message', ({ text }) => {
      if (!text || typeof text !== 'string' || !text.trim()) return;
      const msg = {
        id:         `${userId}-${Date.now()}`,
        text:       text.trim(),
        senderId:   userId,
        senderName: userName,
        timestamp:  new Date().toISOString(),
        type:       'chat',
      };
      // Broadcast to all including sender so other tabs get it; sender uses optimistic append
      socket.to(room).emit('live:message', msg);
    });

    socket.on('disconnect', () => {
      const room_map = liveRooms.get(channelName);
      if (room_map) {
        room_map.delete(socket.id);
        if (room_map.size === 0) liveRooms.delete(channelName);
      }
      socket.to(room).emit('live:presence', { type: 'leave', userId, userName });
      console.log(`[Live] ${userName} left live:${channelName}`);
    });
  });

  console.log('[Socket] Socket.io initialised (default + /editor + /chat + /adaptive + /discussion + /live namespaces)');
  return io;
}

function _broadcastParticipants(lectureId) {
  const room  = `lecture:${lectureId}`;
  const pList = [...(editorRooms.get(lectureId)?.values() ?? [])];
  editorNS.to(room).emit('editor:participants', pList);
}

function getIO()       {
  if (!io)       throw new Error('[Socket] Not initialised');
  return io;
}
function getEditorNS() {
  if (!editorNS) throw new Error('[Socket] Editor namespace not initialised');
  return editorNS;
}
function getChatNS() {
  if (!chatNS) throw new Error('[Socket] Chat namespace not initialised');
  return chatNS;
}
function getAdaptiveNS() {
  if (!adaptiveNS) throw new Error('[Socket] Adaptive namespace not initialised');
  return adaptiveNS;
}
function getDiscussionNS() {
  if (!discussionNS) throw new Error('[Socket] Discussion namespace not initialised');
  return discussionNS;
}
function getLiveNS() {
  if (!liveNS) throw new Error('[Socket] Live namespace not initialised');
  return liveNS;
}

module.exports = { initSocket, getIO, getEditorNS, getChatNS, getAdaptiveNS, getDiscussionNS, getLiveNS, editorRooms, liveRooms };
