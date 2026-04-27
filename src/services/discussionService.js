'use strict';

/**
 * Discussion Service
 *
 * Attaches handlers to the /discussion Socket.io namespace.
 * Supports public, private, group, and contextual chat rooms.
 *
 * Events handled (client → server):
 *   discussion:create   — create a new room and auto-join
 *   discussion:join     — join an existing room by roomId
 *   discussion:leave    — leave a room
 *   discussion:message  — send a message to the active room
 *   discussion:typing   — broadcast typing indicator
 *
 * Events emitted (server → client):
 *   discussion:rooms       — list of public rooms (on connect)
 *   discussion:room        — room details after join/create
 *   discussion:history     — last 50 messages after join
 *   discussion:message     — broadcast of a new message
 *   discussion:typing      — typing indicator broadcast
 *   discussion:participants — updated participant list
 *   discussion:error       — error notification
 */

const { getDiscussionNS }  = require('../socket');
const DiscussionRoom       = require('../models/discussionRoomModel');
const DiscussionMessage    = require('../models/discussionMessageModel');

// roomId → Set<socketId> for tracking active sockets per room
const roomSockets = new Map();

// socketId → { userId, userName, userRole, roomId }
const socketMeta = new Map();

function initDiscussionService() {
  const ns = getDiscussionNS();
  if (!ns) {
    console.warn('[DiscussionService] /discussion namespace not available — skipping init');
    return;
  }

  ns.on('connection', async (socket) => {
    const { userId, userName, userRole = 'member' } = socket.handshake.query;
    if (!userId || !userName) { socket.disconnect(true); return; }

    socketMeta.set(socket.id, { userId, userName, userRole, roomId: null });
    console.log(`[Discussion] ${userName} connected`);

    // ── Send list of active public rooms on connect ───────────────────────────
    try {
      const rooms = await DiscussionRoom.find({ type: 'public', isActive: true })
        .sort({ lastMessageAt: -1 })
        .limit(30)
        .lean();
      socket.emit('discussion:rooms', rooms);
    } catch (err) {
      console.error('[Discussion] rooms fetch error', err);
    }

    // ── Create a new room ─────────────────────────────────────────────────────
    socket.on('discussion:create', async (payload) => {
      const { type = 'public', title, topic, contextId, contextType } = payload || {};
      if (!title?.trim()) {
        socket.emit('discussion:error', { message: 'Room title is required.' });
        return;
      }

      try {
        const room = await DiscussionRoom.create({
          type,
          title: title.trim(),
          topic: topic?.trim() || '',
          contextId: contextId || null,
          contextType: contextType || null,
          createdBy: { userId, userName },
          participants: [{ userId, userName }]
        });

        await _joinRoom(socket, room._id.toString(), userId, userName, userRole, ns);
      } catch (err) {
        console.error('[Discussion] create error', err);
        socket.emit('discussion:error', { message: 'Failed to create room.' });
      }
    });

    // ── Join an existing room ─────────────────────────────────────────────────
    socket.on('discussion:join', async ({ roomId } = {}) => {
      if (!roomId) {
        socket.emit('discussion:error', { message: 'roomId is required.' });
        return;
      }

      try {
        const room = await DiscussionRoom.findById(roomId).lean();
        if (!room) {
          socket.emit('discussion:error', { message: 'Room not found.' });
          return;
        }
        if (!room.isActive) {
          socket.emit('discussion:error', { message: 'Room is no longer active.' });
          return;
        }

        // Add participant if not already present
        await DiscussionRoom.updateOne(
          { _id: roomId, 'participants.userId': { $ne: userId } },
          { $push: { participants: { userId, userName } } }
        );

        await _joinRoom(socket, roomId, userId, userName, userRole, ns);
      } catch (err) {
        console.error('[Discussion] join error', err);
        socket.emit('discussion:error', { message: 'Failed to join room.' });
      }
    });

    // ── Leave a room ──────────────────────────────────────────────────────────
    socket.on('discussion:leave', () => {
      _leaveCurrentRoom(socket, ns);
    });

    // ── Send a message ────────────────────────────────────────────────────────
    socket.on('discussion:message', async (payload) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) {
        socket.emit('discussion:error', { message: 'Join a room before sending messages.' });
        return;
      }

      const { content, replyTo } = payload || {};
      if (!content?.trim() || content.length > 2000) {
        socket.emit('discussion:error', { message: 'Invalid message content.' });
        return;
      }

      try {
        const msg = await DiscussionMessage.create({
          roomId:     meta.roomId,
          senderId:   userId,
          senderName: userName,
          senderRole: userRole,
          content:    content.trim(),
          replyTo:    replyTo || null,
          status:     'sent'
        });

        // Update room stats
        await DiscussionRoom.updateOne(
          { _id: meta.roomId },
          { $inc: { messageCount: 1 }, $set: { lastMessageAt: new Date() } }
        );

        const roomKey = `discussion:${meta.roomId}`;
        ns.to(roomKey).emit('discussion:message', msg);
      } catch (err) {
        console.error('[Discussion] message error', err);
        socket.emit('discussion:error', { message: 'Failed to send message.' });
      }
    });

    // ── Typing indicator ──────────────────────────────────────────────────────
    socket.on('discussion:typing', ({ isTyping }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta?.roomId) return;
      socket.to(`discussion:${meta.roomId}`).emit('discussion:typing', {
        userId, userName, isTyping: !!isTyping
      });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      _leaveCurrentRoom(socket, ns);
      socketMeta.delete(socket.id);
      console.log(`[Discussion] ${userName} disconnected`);
    });
  });

  console.log('[DiscussionService] Attached to /discussion namespace');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _joinRoom(socket, roomId, userId, userName, userRole, ns) {
  // Leave any current room first
  _leaveCurrentRoom(socket, ns);

  const roomKey = `discussion:${roomId}`;
  socket.join(roomKey);

  // Update meta
  const meta = socketMeta.get(socket.id);
  if (meta) meta.roomId = roomId;

  // Track socket in room registry
  if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Set());
  roomSockets.get(roomId).add(socket.id);

  // Fetch fresh room doc and send to joining socket
  const room = await DiscussionRoom.findById(roomId).lean();
  socket.emit('discussion:room', room);

  // Send message history
  const history = await DiscussionMessage.find({ roomId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  socket.emit('discussion:history', history.reverse());

  // Broadcast updated online participants
  _broadcastParticipants(roomId, ns);
  console.log(`[Discussion] ${userName} joined room ${roomId}`);
}

function _leaveCurrentRoom(socket, ns) {
  const meta = socketMeta.get(socket.id);
  if (!meta?.roomId) return;

  const roomKey = `discussion:${meta.roomId}`;
  socket.leave(roomKey);

  const sockets = roomSockets.get(meta.roomId);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) roomSockets.delete(meta.roomId);
  }

  const prevRoomId = meta.roomId;
  meta.roomId = null;
  _broadcastParticipants(prevRoomId, ns);
}

function _broadcastParticipants(roomId, ns) {
  const sockets = roomSockets.get(roomId);
  const onlineCount = sockets?.size ?? 0;
  ns.to(`discussion:${roomId}`).emit('discussion:participants', { roomId, onlineCount });
}

module.exports = { initDiscussionService };
