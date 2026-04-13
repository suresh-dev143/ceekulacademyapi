'use strict';

/**
 * Adaptive Socket Service — handles the /adaptive Socket.io namespace.
 *
 * Events (client → server):
 *   adaptive:join         { userId, sessionId, topicId }
 *   adaptive:signal       raw behavioural signals (merged by adaptiveEngineService)
 *   adaptive:reward       { rewardType }
 *   adaptive:force-mode   { mode }
 *
 * Events (server → client):
 *   adaptive:state        full UserState snapshot
 *   adaptive:mode-change  { mode, reason, transition, animationProfile }
 *   adaptive:tier-change  { newTier, prevTier, hint }
 *   adaptive:error        { message }
 */

const { getAdaptiveNS } = require('../socket');
const adaptiveEngine     = require('./adaptiveEngineService');
const engagementSvc      = require('./engagementService');
const userStateSvc       = require('./userStateService');

// In-memory map: socketId → { userId, sessionId, topicId }
const activeSessions = new Map();

function initAdaptiveService() {
  const ns = getAdaptiveNS();

  ns.on('connection', (socket) => {
    console.log(`[Adaptive] Client connected: ${socket.id}`);

    // ── Join ──────────────────────────────────────────────────────────────────
    socket.on('adaptive:join', async ({ userId, sessionId, topicId }) => {
      if (!userId || !sessionId) {
        socket.emit('adaptive:error', { message: 'userId and sessionId required' });
        return;
      }

      const room = `adaptive:${userId}:${sessionId}`;
      socket.join(room);
      activeSessions.set(socket.id, { userId, sessionId, topicId });

      // Send current state snapshot
      const state = await userStateSvc.getState(userId, sessionId);
      socket.emit('adaptive:state', state || { userId, sessionId, currentMode: 'idle' });

      // Update streak on session start
      await engagementSvc.updateStreak(userId);

      console.log(`[Adaptive] ${userId} joined session:${sessionId} topic:${topicId}`);
    });

    // ── Behavioural signal batch ───────────────────────────────────────────────
    socket.on('adaptive:signal', async (incomingSignals) => {
      const session = activeSessions.get(socket.id);
      if (!session) return;

      const { userId, sessionId, topicId } = session;
      const room = `adaptive:${userId}:${sessionId}`;

      try {
        const { state, modeDecision } = await adaptiveEngine.processSignals(
          userId, sessionId, incomingSignals, topicId
        );

        // Always send updated state
        ns.to(room).emit('adaptive:state', state);

        // If mode changed, send mode-change event with animation profile
        if (modeDecision) {
          const animProfile = adaptiveEngine.computeAnimationProfile(state.state);
          ns.to(room).emit('adaptive:mode-change', {
            mode:             modeDecision.mode,
            reason:           modeDecision.reason,
            transition:       modeDecision.transition,
            animationProfile: animProfile
          });

          // Check for tier change
          const prevTier = state.progressionTier;  // state is now after the update
          if (prevTier !== state.progressionTier) {
            const hint = engagementSvc.getProgressionHint(state.progressionTier, state.state);
            ns.to(room).emit('adaptive:tier-change', {
              newTier:  state.progressionTier,
              prevTier,
              hint
            });
          }
        }
      } catch (err) {
        socket.emit('adaptive:error', { message: err.message });
      }
    });

    // ── Reward event ──────────────────────────────────────────────────────────
    socket.on('adaptive:reward', async ({ rewardType }) => {
      const session = activeSessions.get(socket.id);
      if (!session) return;

      const { userId, sessionId } = session;
      const room = `adaptive:${userId}:${sessionId}`;

      try {
        const result = await engagementSvc.applyReward(userId, sessionId, rewardType);
        ns.to(room).emit('adaptive:state', await userStateSvc.getState(userId, sessionId));

        if (result.tierChanged) {
          const hint = engagementSvc.getProgressionHint(result.newTier, { motivation: result.newMotivation, researchOrientation: result.newResearchOri });
          ns.to(room).emit('adaptive:tier-change', {
            newTier:  result.newTier,
            prevTier: result.prevTier,
            hint
          });
        }
      } catch (err) {
        socket.emit('adaptive:error', { message: err.message });
      }
    });

    // ── Force mode (teacher override) ─────────────────────────────────────────
    socket.on('adaptive:force-mode', async ({ mode }) => {
      const session = activeSessions.get(socket.id);
      if (!session) return;

      const { userId, sessionId } = session;
      const room = `adaptive:${userId}:${sessionId}`;

      try {
        const { state, modeDecision } = await adaptiveEngine.forceMode(userId, sessionId, mode);
        const animProfile = adaptiveEngine.computeAnimationProfile(state.state);
        ns.to(room).emit('adaptive:state', state);
        ns.to(room).emit('adaptive:mode-change', {
          ...modeDecision,
          animationProfile: animProfile
        });
      } catch (err) {
        socket.emit('adaptive:error', { message: err.message });
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        console.log(`[Adaptive] ${session.userId} disconnected from session:${session.sessionId}`);
        activeSessions.delete(socket.id);
      }
    });
  });

  console.log('[Adaptive] /adaptive namespace event handlers attached');
}

module.exports = { initAdaptiveService };
