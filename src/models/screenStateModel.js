'use strict';

/**
 * Screen State — one document per user/device, updated in-place.
 *
 * Tracks the live screen context for each device session. When the layout
 * evolves the document is patched (not replaced) so the history of CID
 * transitions lives in the UCE version chain, not here.
 *
 * deviceType: mobile | tablet | laptop | desktop | wearable | machine
 * inputCapabilities: what interaction modes this device supports
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const screenStateSchema = new Schema(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId:   { type: String, required: true, index: true },
    deviceType: { type: String, default: 'mobile' },
    sessionId:  { type: String, default: null },

    // UCE content addresses for the active and previous layout
    currentCid:  { type: String, default: null, index: true },
    previousCid: { type: String, default: null },

    // Viewport bucket (xs/sm/md/lg/xl) — not raw pixels
    viewportClass: { type: String, default: 'sm' },

    // Current route / page context
    context: { type: String, default: 'home' },

    // Last instruction committed (CID of the ui-instruction payload)
    lastInstructionCid: { type: String, default: null },

    // Input modes available on this device
    inputCapabilities: {
      type: [String],
      default: ['tap', 'input'],
    },

    // Pre-committed CIDs for probable next layouts — populated by screenPredictionService.
    // Flutter reads these on screen:prefetch to pre-load widget trees before the user acts.
    prefetchCids: {
      type: [{ cid: String, context: String, fromDedupe: Boolean }],
      default: [],
    },

    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection:  'screen_states',
    timestamps:  false,   // manual updatedAt so we control the field
  }
);

// One active state per user/device pair
screenStateSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

module.exports = mongoose.model('ScreenState', screenStateSchema);
