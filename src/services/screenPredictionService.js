'use strict';

/**
 * Screen Prediction Service — Semantic Motion Prediction
 *
 * After every layout commit, pre-computes the N most probable next screen
 * layouts and commits them through UCE with trusted=true. No AI call, no new
 * document if the CID already exists — pure dedup at O(1).
 *
 * Pre-committed CIDs are:
 *   1. Stored in ScreenState.prefetchCids for REST polling fallback.
 *   2. Pushed to the active WebSocket client via screen:prefetch so Flutter
 *      can pre-load widget trees and Rive animations before the user acts.
 *
 * When the user navigates, the CID already exists in UCE — dedup returns
 * instantly, the animation is pre-loaded, and the transition feels prescient.
 *
 * The transition map is static for now. Replace with per-user learned patterns
 * once navigation telemetry volume is sufficient.
 */

const commitSvc   = require('./universalCommitService');
const ScreenState = require('../models/screenStateModel');
const {
  viewportWidthFromClass,
  defaultLayout,
  defaultComponents,
} = require('./screenLayoutHelpers');

// ── Transition probability map ────────────────────────────────────────────────
// context → probable next contexts, ordered by likelihood.
// 'search' is a base key — all 'search:*' contexts map to it.

const TRANSITIONS = {
  'home':         ['menu', 'research', 'innovation', 'creation'],
  'menu':         ['home', 'research', 'innovation', 'governance', 'creation'],
  'research':     ['home', 'menu', 'content', 'innovation'],
  'innovation':   ['home', 'menu', 'research', 'creation'],
  'governance':   ['home', 'menu', 'research'],
  'creation':     ['home', 'menu', 'innovation', 'research'],
  'profile':      ['home', 'settings', 'menu'],
  'settings':     ['home', 'profile', 'menu'],
  'content':      ['home', 'menu', 'research'],
  'search':       ['home', 'content', 'research', 'menu'],
  'next':         ['home', 'menu'],
  'prev':         ['home', 'menu'],
};

const MAX_PREDICTIONS = 4;

function _probableNextContexts(context) {
  const base = context.startsWith('search:') ? 'search' : context;
  return (TRANSITIONS[base] || TRANSITIONS['home']).slice(0, MAX_PREDICTIONS);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Pre-commit probable next layouts and push prefetch CIDs to the client.
 * Always fire-and-forget — never awaited by the caller.
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.userId
 * @param {string}  opts.deviceId
 * @param {string}  opts.deviceType
 * @param {string}  opts.viewportClass   — xs|sm|md|lg|xl
 * @param {string}  opts.context         — current layout context
 * @param {string|ObjectId} opts.ownerId — passed through to UCE commit
 */
async function precomputeNextLayouts({ userId, deviceId, deviceType, viewportClass, context, ownerId }) {
  const nextContexts  = _probableNextContexts(context);
  const viewportWidth = viewportWidthFromClass(viewportClass);
  const prefetchCids  = [];

  // Commit all probable next layouts in parallel — UCE dedup makes re-commits free
  await Promise.allSettled(nextContexts.map(async (nextContext) => {
    try {
      const result = await commitSvc.commit({
        source:      'screen-prediction',
        contentType: 'screen-layout',
        payload: {
          deviceType,
          viewport:   { width: viewportWidth },
          layoutType: defaultLayout(deviceType, nextContext),
          context:    nextContext,
          theme:      'default',
          components: defaultComponents(nextContext),
          keywords:   [nextContext, deviceType],
        },
        ownerId,
        trusted: true,  // no AI gate — prediction layouts are system-generated
      });

      prefetchCids.push({
        cid:        result.cid,
        context:    nextContext,
        fromDedupe: result.fromDedupe,
      });
    } catch {
      // Non-fatal — a missed prediction just means that transition won't be
      // pre-loaded; the client falls back to a normal commit on navigation.
    }
  }));

  if (prefetchCids.length === 0) return;

  // Persist in ScreenState so the REST prefetch endpoint can serve it too
  await ScreenState.findOneAndUpdate(
    { userId, deviceId },
    { $set: { prefetchCids, updatedAt: new Date() } }
  ).catch(() => {});

  // Lazy require breaks the circular dependency:
  //   screenSocketService → screenEvolutionService → screenPredictionService
  //                                                 ↑ (lazy, called at runtime)
  //                       ← screenSocketService ←──┘
  // By the time this function runs, screenSocketService is fully initialized.
  try {
    const { pushPrefetch } = require('./screenSocketService');
    pushPrefetch(String(userId), deviceId, prefetchCids);
  } catch {
    // Socket service not yet initialized — prefetch CIDs are still persisted
    // in ScreenState and will be returned by the REST endpoint.
  }
}

/**
 * Build a probability tree up to `depth` steps ahead.
 * Each level halves the probability (0.5^depth).
 * Returns a flat array of { context, depth, probability, via }.
 */
function buildHorizon(context, depth = 3) {
  const visited = new Set([context]);
  const result  = [];
  let frontier  = [{ context, probability: 1.0 }];

  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const nextFrontier = [];
    for (const { context: ctx, probability } of frontier) {
      const base    = ctx.startsWith('search:') ? 'search' : ctx;
      const nexts   = TRANSITIONS[base] || TRANSITIONS['home'];
      const p       = probability * 0.5;
      for (const n of nexts) {
        if (!visited.has(n)) {
          visited.add(n);
          result.push({ context: n, depth: d, probability: p, via: ctx });
          nextFrontier.push({ context: n, probability: p });
        }
      }
    }
    frontier = nextFrontier;
  }
  return result;
}

module.exports = { precomputeNextLayouts, buildHorizon };
