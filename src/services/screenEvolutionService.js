'use strict';

/**
 * Screen Evolution Service
 *
 * Processes a user instruction and evolves the active screen layout.
 * Every layout and instruction passes through UCE — dedup, versioning,
 * reference graph, and AI gate apply automatically. Repeated identical
 * states cost O(1) (dedup hit, no AI call, no new document).
 *
 * Flow:
 *   1. Commit ui-instruction to UCE (fromCid = current layout CID)
 *   2. Derive the next layout
 *   3. Commit screen-layout to UCE (parentCid = previous layout CID)
 *   4. Update ScreenState document for this user/device
 *   5. Fire-and-forget: precomputeNextLayouts for prescient prefetch
 *   6. Return { instructionCid, layoutCid, layout, fromDedupe }
 */

const commitSvc      = require('./universalCommitService');
const { normalize }  = require('./normalizerService');
const predictionSvc  = require('./screenPredictionService');
const ScreenState    = require('../models/screenStateModel');
const {
  viewportClassFromWidth,
  popContext,
  defaultLayout,
  defaultComponents,
} = require('./screenLayoutHelpers');

// ── Layout resolver ───────────────────────────────────────────────────────────

function _resolveNextLayout(currentState, instruction) {
  const deviceType  = currentState?.deviceType    || 'mobile';
  const context     = currentState?.context       || 'home';
  const viewport    = currentState?.viewport      || { width: 640 };

  const target = (instruction.target || '').toLowerCase();
  const value  = (instruction.value  || '').toLowerCase();
  const itype  = (instruction.instructionType || '').toLowerCase();

  let nextContext = context;

  if (itype === 'tap' || itype === 'click') {
    if (target.includes('menu') || target.includes('nav')) nextContext = 'menu';
    else if (target.includes('back'))                       nextContext = popContext(context);
    else if (target)                                        nextContext = target;
  } else if (itype === 'navigate') {
    // Direct context jump — used by prefetch chips and workspace panel selectors
    if (target) nextContext = target;
  } else if (itype === 'input' || itype === 'voice') {
    if (value) nextContext = `search:${value.slice(0, 30)}`;
  } else if (itype === 'swipe') {
    if (target === 'left')  nextContext = 'next';
    if (target === 'right') nextContext = 'prev';
  }

  return {
    deviceType,
    viewport,
    layoutType: defaultLayout(deviceType, nextContext),
    context:    nextContext,
    theme:      'default',
    components: defaultComponents(nextContext),
    keywords:   [nextContext, deviceType],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

async function processInstruction({ userId, deviceId, deviceType, viewportWidth, context, instruction, sessionId }) {
  const state = await ScreenState.findOne({ userId, deviceId }).lean();

  const currentCid     = state?.currentCid || null;
  const currentContext = state?.context     || context || 'home';
  const currentDevice  = state?.deviceType  || deviceType || 'mobile';

  const stateForResolver = {
    deviceType: currentDevice,
    context:    currentContext,
    viewport:   { width: viewportWidth || 640 },
  };

  // ── Step 1: Commit the instruction ───────────────────────────────────────
  const instrPayload = {
    instructionType: instruction.type   || 'tap',
    target:          instruction.target || '',
    context:         currentContext,
    value:           instruction.value  || '',
    fromCid:         currentCid || '',
  };

  const instrResult = await commitSvc.commit({
    source:      'screen',
    contentType: 'ui-instruction',
    payload:     instrPayload,
    ownerId:     userId,
    trusted:     true,
  });

  // ── Step 2: Derive next layout ────────────────────────────────────────────
  const nextLayoutPayload = _resolveNextLayout(stateForResolver, instrPayload);

  // ── Step 3: Commit the new layout ─────────────────────────────────────────
  const layoutResult = await commitSvc.commit({
    source:      'screen',
    contentType: 'screen-layout',
    payload:     nextLayoutPayload,
    ownerId:     userId,
    parentCid:   currentCid || null,
    trusted:     true,
  });

  // ── Step 4: Update ScreenState ────────────────────────────────────────────
  const viewportClass = viewportClassFromWidth(
    nextLayoutPayload.viewport?.width || viewportWidth || 640
  );

  await ScreenState.findOneAndUpdate(
    { userId, deviceId },
    {
      $set: {
        userId,
        deviceId,
        deviceType:         currentDevice,
        sessionId:          sessionId || null,
        currentCid:         layoutResult.cid,
        previousCid:        currentCid,
        viewportClass,
        context:            nextLayoutPayload.context,
        lastInstructionCid: instrResult.cid,
        updatedAt:          new Date(),
      },
    },
    { upsert: true, new: true }
  );

  // ── Step 5: Predict & prefetch next probable layouts ──────────────────────
  predictionSvc.precomputeNextLayouts({
    userId,
    deviceId,
    deviceType:   currentDevice,
    viewportClass,
    context:      nextLayoutPayload.context,
    ownerId:      userId,
  }).catch(() => {});

  return {
    instructionCid: instrResult.cid,
    layoutCid:      layoutResult.cid,
    layout:         nextLayoutPayload,
    context:        nextLayoutPayload.context,
    fromDedupe:     layoutResult.fromDedupe,
  };
}

async function initScreen({ userId, deviceId, deviceType, viewportWidth, context, sessionId }) {
  const existing = await ScreenState.findOne({ userId, deviceId }).lean();
  if (existing?.currentCid) {
    return { layoutCid: existing.currentCid, context: existing.context, fromCache: true };
  }

  const homePayload = {
    deviceType:  deviceType || 'mobile',
    viewport:    { width: viewportWidth || 640 },
    layoutType:  'stack',
    context:     context || 'home',
    theme:       'default',
    components:  defaultComponents(context || 'home'),
    keywords:    [context || 'home', deviceType || 'mobile'],
  };

  const layoutResult = await commitSvc.commit({
    source:      'screen',
    contentType: 'screen-layout',
    payload:     homePayload,
    ownerId:     userId,
    trusted:     true,
  });

  const viewportClass = viewportClassFromWidth(viewportWidth || 640);

  await ScreenState.findOneAndUpdate(
    { userId, deviceId },
    {
      $set: {
        userId, deviceId,
        deviceType:  deviceType || 'mobile',
        sessionId:   sessionId || null,
        currentCid:  layoutResult.cid,
        previousCid: null,
        viewportClass,
        context:     homePayload.context,
        updatedAt:   new Date(),
      },
    },
    { upsert: true, new: true }
  );

  // Predict next layouts from home immediately on init
  predictionSvc.precomputeNextLayouts({
    userId,
    deviceId,
    deviceType:   deviceType || 'mobile',
    viewportClass,
    context:      homePayload.context,
    ownerId:      userId,
  }).catch(() => {});

  return { layoutCid: layoutResult.cid, context: homePayload.context, fromCache: false };
}

async function getState(userId, deviceId) {
  return ScreenState.findOne({ userId, deviceId }).lean();
}

module.exports = { processInstruction, initScreen, getState };
