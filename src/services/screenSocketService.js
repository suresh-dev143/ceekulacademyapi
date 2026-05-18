'use strict';

/**
 * Screen Socket Service — /screen WebSocket namespace
 *
 * Client → Server events:
 *   screen:init        { deviceId, deviceType, viewportWidth, context }
 *   screen:instruction { deviceId, instruction: { type, target, value } }
 *
 * Server → Client events:
 *   screen:ack         { layoutCid, context, fromDedupe, fromCache? }
 *   screen:sync        { layoutCid, context, layout }       (full push)
 *   screen:error       { code, message }
 *
 * Error codes: AUTH_REQUIRED, INVALID_INPUT, INTERNAL_ERROR
 *
 * Auth: JWT in handshake auth.token or query.token.
 * Call initScreenService() after initSocket() in index.js.
 */

const jwt       = require('jsonwebtoken');
const { User }  = require('../models/authModels');
const screenSvc = require('./screenEvolutionService');
const { getIO } = require('../socket');

async function resolveToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user    = await User.findById(decoded.id).select('_id status').lean();
    if (!user || user.status === 'Inactive' || user.status === 'Suspended') return null;
    return user;
  } catch {
    return null;
  }
}

function initScreenService() {
  const io = getIO();
  const ns = io.of('/screen');

  // Auth middleware — reject unauthenticated connections immediately
  ns.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const user  = await resolveToken(token).catch(() => null);
    if (!user) return next(new Error('AUTH_REQUIRED'));
    socket.data.user = user;
    next();
  });

  ns.on('connection', (socket) => {
    const userId = socket.data.user._id;

    // ── screen:init ──────────────────────────────────────────────────────────
    socket.on('screen:init', async (data) => {
      try {
        const { deviceId, deviceType, viewportWidth, context } = data || {};
        if (!deviceId) {
          return socket.emit('screen:error', { code: 'INVALID_INPUT', message: 'deviceId is required' });
        }

        const result = await screenSvc.initScreen({
          userId,
          deviceId,
          deviceType:    deviceType    || 'mobile',
          viewportWidth: viewportWidth || 640,
          context:       context       || 'home',
          sessionId:     socket.id,
        });

        // Join a room keyed to user/device so server-side pushes are targeted
        socket.join(`${userId}:${deviceId}`);

        socket.emit('screen:ack', {
          layoutCid:  result.layoutCid,
          context:    result.context,
          fromCache:  result.fromCache,
          fromDedupe: false,
        });

        if (!result.fromCache) {
          socket.emit('screen:sync', { layoutCid: result.layoutCid, context: result.context });
        }
      } catch (err) {
        socket.emit('screen:error', { code: 'INTERNAL_ERROR', message: err.message });
      }
    });

    // ── screen:instruction ───────────────────────────────────────────────────
    socket.on('screen:instruction', async (data) => {
      try {
        const { deviceId, instruction, viewportWidth } = data || {};
        if (!deviceId || !instruction?.type) {
          return socket.emit('screen:error', {
            code:    'INVALID_INPUT',
            message: 'deviceId and instruction.type are required',
          });
        }

        const result = await screenSvc.processInstruction({
          userId,
          deviceId,
          instruction,
          viewportWidth: viewportWidth || 640,
          sessionId:     socket.id,
        });

        socket.emit('screen:ack', {
          layoutCid:      result.layoutCid,
          instructionCid: result.instructionCid,
          context:        result.context,
          fromDedupe:     result.fromDedupe,
        });

        // Broadcast the evolved layout to all sockets for this user/device pair
        ns.to(`${userId}:${deviceId}`).emit('screen:sync', {
          layoutCid: result.layoutCid,
          context:   result.context,
          layout:    result.layout,
        });
      } catch (err) {
        const code = err.status === 422 ? 'CONTENT_BLOCKED'
                   : err.status === 403 ? 'AUTH_REQUIRED'
                   :                      'INTERNAL_ERROR';
        socket.emit('screen:error', { code, message: err.message });
      }
    });
  });
}

// Push a layout update to a specific user/device from outside the socket layer
function pushLayout(userId, deviceId, payload) {
  try {
    const io = getIO();
    io.of('/screen').to(`${String(userId)}:${deviceId}`).emit('screen:sync', payload);
  } catch {
    // getIO throws if socket server not yet initialized — safe to ignore
  }
}

// Push pre-committed prefetch CIDs so the client can pre-load widget trees.
// Emits screen:prefetch — distinct from screen:sync so the client never
// animates a prefetch push as if it were a real navigation event.
function pushPrefetch(userId, deviceId, prefetchCids) {
  try {
    const io = getIO();
    io.of('/screen').to(`${String(userId)}:${deviceId}`).emit('screen:prefetch', { layouts: prefetchCids });
  } catch {
    // Safe to ignore — prefetch is a performance optimisation, not a requirement
  }
}

module.exports = { initScreenService, pushLayout, pushPrefetch };
