'use strict';

/**
 * Device Ingestion Service — WebSocket Protocol Adapter
 *
 * Adds a /ingest Socket.io namespace so any device that can open a WebSocket
 * (mobile app, wearable, edge sensor, industrial machine, browser) can submit
 * UCE commits without going through the HTTP REST layer.
 *
 * Why WebSocket instead of REST for constrained devices:
 *   - One persistent connection — no TCP/TLS handshake overhead per request
 *   - Binary frame support — compact payloads for bandwidth-constrained devices
 *   - Works through most firewalls and NAT (unlike raw TCP/UDP)
 *   - Already deployed via Socket.io — zero new dependencies
 *
 * Authentication: JWT passed in socket.handshake.auth.token (preferred) or
 * socket.handshake.query.token (for clients that can't set auth headers).
 *
 * Client events (device → server):
 *   ingest:commit   { contentType, payload, parentCid?, correlationId? }
 *                   correlationId is echoed back so the device can match async responses.
 *
 * Server events (server → device):
 *   ingest:result   { correlationId, cid, version, logicalId, status, fromDedupe, capabilityVerified }
 *   ingest:error    { correlationId, message, code }
 *   ingest:ready    — emitted once on connect to signal the channel is open
 *
 * Call initDeviceIngestion() after initSocket() in index.js.
 */

const jwt       = require('jsonwebtoken');
const { User }  = require('../models/authModels');
const commitSvc = require('./universalCommitService');
const { getIO } = require('../socket');

// ── Auth middleware ───────────────────────────────────────────────────────────

async function resolveToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user    = await User.findById(decoded.id).select('_id ceebrainId status').lean();
    if (!user || user.status === 'Inactive' || user.status === 'Suspended') return null;
    return user;
  } catch {
    return null;
  }
}

// ── Namespace initialiser ─────────────────────────────────────────────────────

function initDeviceIngestion() {
  const io       = getIO();
  const ingestNS = io.of('/ingest');

  // Auth handshake — reject unauthenticated connections immediately
  ingestNS.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const user  = await resolveToken(token).catch(() => null);
    if (!user) return next(new Error('Authentication required'));
    socket.data.user = user;
    next();
  });

  ingestNS.on('connection', (socket) => {
    const user = socket.data.user;
    socket.emit('ingest:ready', { userId: String(user._id) });

    // ── ingest:commit ──────────────────────────────────────────────────────
    socket.on('ingest:commit', async (data) => {
      const { contentType, payload, parentCid, correlationId = null } = data || {};

      if (!contentType || !payload || typeof payload !== 'object') {
        return socket.emit('ingest:error', {
          correlationId,
          message: 'contentType and payload (object) are required',
          code:    'INVALID_INPUT',
        });
      }

      try {
        const result = await commitSvc.commit({
          source:    'device-websocket',
          contentType,
          payload,
          ownerId:   user._id,
          parentCid: parentCid || null,
          traceId:   socket.id,
        });

        socket.emit('ingest:result', { correlationId, ...result });
      } catch (err) {
        socket.emit('ingest:error', {
          correlationId,
          message: err.message,
          code:    err.status === 403 ? 'CAPABILITY_DENIED'
                 : err.status === 422 ? 'CONTENT_BLOCKED'
                 : err.status === 400 ? 'INVALID_INPUT'
                 : 'INTERNAL_ERROR',
        });
      }
    });

    socket.on('disconnect', () => {
      // Connection cleanup is automatic — nothing to persist
    });
  });

  console.log('[DeviceIngestion] /ingest WebSocket namespace ready');
}

module.exports = { initDeviceIngestion };
