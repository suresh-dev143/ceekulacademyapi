'use strict';

/**
 * User Experience Profile — persistent rendering preference layer
 *
 * This is the USER'S CHOICE about what experience they want to see.
 * It is distinct from:
 *   - userStateModel.currentMode  — real-time adaptive cognitive state (per session)
 *   - preferencesModel            — content/ad category preferences
 *
 * The experience profile drives how the frontend renders the homepage and all
 * content screens. It is the "settings page" that persists across sessions.
 *
 * Experience levels (progressive enhancement):
 *   baseline  — clean semantic content, no animations (accessibility-first)
 *   standard  — subtle 2D transitions, fade/slide (default)
 *   cinematic — parallax depth, particle effects, fluid 3D card transitions
 *   immersive — full AR/VR/XR environment, spatial UI, depth-of-field
 *
 * The frontend should always respect reducedMotion regardless of animationLevel.
 * The server enforces this by returning effective tier in the home feed response.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const ANIMATION_LEVELS = Object.freeze(['baseline', 'standard', 'cinematic', 'immersive']);
const XR_INTERESTS     = Object.freeze(['none', 'ar', 'vr', 'xr']);
const COLOR_SCHEMES    = Object.freeze(['light', 'dark', 'auto', 'deep-dark', 'cosmic']);
const PLATFORMS        = Object.freeze(['ios', 'android', 'web', 'desktop', 'unknown']);
const PERF_TIERS       = Object.freeze(['low', 'mid', 'high', 'flagship']);

const userExperienceProfileSchema = new Schema(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    citizenId:  { type: String, required: true, index: true },  // CB-prefixed

    // ── User's stated experience preference ────────────────────────────────────
    animationLevel: { type: String, enum: ANIMATION_LEVELS, default: 'standard' },
    xrInterest:     { type: String, enum: XR_INTERESTS, default: 'none' },
    colorScheme:    { type: String, enum: COLOR_SCHEMES, default: 'auto' },

    // Accessibility override — server always enforces this regardless of animationLevel
    reducedMotion: { type: Boolean, default: false },

    // High contrast mode (accessibility)
    highContrast: { type: Boolean, default: false },

    // ── Last registered device capability snapshot ─────────────────────────────
    // Updated by POST /api/me/device when app launches.
    // Server uses this to validate whether stated xrInterest is achievable.
    device: {
      platform:       { type: String, enum: PLATFORMS, default: 'unknown' },
      performanceTier: { type: String, enum: PERF_TIERS, default: 'mid' },
      hasAR:          { type: Boolean, default: false },  // ARKit/ARCore available
      hasVR:          { type: Boolean, default: false },  // Cardboard/standalone VR
      hasWebXR:       { type: Boolean, default: false },  // WebXR API available
      has3DAccel:     { type: Boolean, default: true  },  // GPU 3D acceleration
      screenWidth:    { type: Number, default: 390 },
      screenHeight:   { type: Number, default: 844 },
      pixelRatio:     { type: Number, default: 2 },
      networkQuality: { type: String, enum: ['poor', 'fair', 'good', 'excellent'], default: 'good' },
      batteryLevel:   { type: Number, default: 1.0, min: 0, max: 1 },
      registeredAt:   { type: Date, default: null },
      _id: false,
    },

    // ── Onboarding state ───────────────────────────────────────────────────────
    hasCompletedOnboarding: { type: Boolean, default: false },
    onboardingStep:         { type: Number, default: 0 },
    preferenceSetAt:        { type: Date, default: null },

    // ── Consent flags ──────────────────────────────────────────────────────────
    consentNeedIntelligence: { type: Boolean, default: false },
    consentPedagogySignals:  { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'user_experience_profiles',
  }
);

module.exports = mongoose.model('UserExperienceProfile', userExperienceProfileSchema);
module.exports.ANIMATION_LEVELS = ANIMATION_LEVELS;
module.exports.XR_INTERESTS     = XR_INTERESTS;
module.exports.COLOR_SCHEMES    = COLOR_SCHEMES;
