'use strict';

const express = require('express');
const router  = express.Router();
const UserExperienceProfile = require('../models/userExperienceProfileModel');
const { computeEffectiveTier } = require('../services/cinematicMetaService');
const {
  ANIMATION_LEVELS,
  XR_INTERESTS,
  COLOR_SCHEMES,
} = require('../models/userExperienceProfileModel');

function requireAuth(req, res, next) {
  if (!req.user?._id) {
    return res.status(401).json({ status: false, message: 'Authentication required' });
  }
  next();
}

/**
 * GET /api/me/experience
 *
 * Return the current user's experience profile and the server-computed
 * effective rendering tier (which may differ from stated animationLevel
 * due to device/battery/network constraints).
 */
router.get('/experience', requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user._id);

    let profile = await UserExperienceProfile.findOne({ userId }).lean();

    if (!profile) {
      // Return defaults — profile is created lazily on first PUT
      profile = {
        animationLevel:  'standard',
        xrInterest:      'none',
        colorScheme:     'auto',
        reducedMotion:   false,
        highContrast:    false,
        device:          {},
        hasCompletedOnboarding: false,
        onboardingStep:  0,
        consentNeedIntelligence: false,
        consentPedagogySignals:  false,
      };
    }

    const effectiveTier = computeEffectiveTier(profile, {});

    res.status(200).json({
      status: true,
      data: {
        profile,
        effectiveTier,
        enums: { ANIMATION_LEVELS, XR_INTERESTS, COLOR_SCHEMES },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/me/experience
 *
 * Update the user's experience preferences.
 * Writable fields: animationLevel, xrInterest, colorScheme, reducedMotion,
 *                  highContrast, consentNeedIntelligence, consentPedagogySignals.
 *
 * Body (all optional, only provided fields are updated):
 * {
 *   animationLevel: 'standard',
 *   xrInterest: 'none',
 *   colorScheme: 'auto',
 *   reducedMotion: false,
 *   highContrast: false,
 *   consentNeedIntelligence: false,
 *   consentPedagogySignals: false
 * }
 */
router.put('/experience', requireAuth, async (req, res, next) => {
  try {
    const userId    = String(req.user._id);
    const citizenId = req.user.citizenId || `CB${userId}`;

    const ALLOWED = [
      'animationLevel', 'xrInterest', 'colorScheme',
      'reducedMotion', 'highContrast',
      'consentNeedIntelligence', 'consentPedagogySignals',
    ];

    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    // Validate enum fields
    if (update.animationLevel && !ANIMATION_LEVELS.includes(update.animationLevel)) {
      return res.status(400).json({
        status: false,
        message: `animationLevel must be one of: ${ANIMATION_LEVELS.join(', ')}`,
      });
    }
    if (update.xrInterest && !XR_INTERESTS.includes(update.xrInterest)) {
      return res.status(400).json({
        status: false,
        message: `xrInterest must be one of: ${XR_INTERESTS.join(', ')}`,
      });
    }
    if (update.colorScheme && !COLOR_SCHEMES.includes(update.colorScheme)) {
      return res.status(400).json({
        status: false,
        message: `colorScheme must be one of: ${COLOR_SCHEMES.join(', ')}`,
      });
    }

    if (update.animationLevel) {
      update.preferenceSetAt = new Date();
    }

    const profile = await UserExperienceProfile.findOneAndUpdate(
      { userId },
      {
        $set: { ...update, citizenId },
        $setOnInsert: { userId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const effectiveTier = computeEffectiveTier(profile, {});

    res.status(200).json({ status: true, data: { profile, effectiveTier } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/me/device
 *
 * Register or update the device capability snapshot.
 * Called by the app on every launch with current hardware state.
 *
 * Body:
 * {
 *   platform: 'ios' | 'android' | 'web' | 'desktop' | 'unknown',
 *   performanceTier: 'low' | 'mid' | 'high' | 'flagship',
 *   hasAR: false,
 *   hasVR: false,
 *   hasWebXR: false,
 *   has3DAccel: true,
 *   screenWidth: 390,
 *   screenHeight: 844,
 *   pixelRatio: 2,
 *   networkQuality: 'good',
 *   batteryLevel: 0.85
 * }
 */
router.post('/device', requireAuth, async (req, res, next) => {
  try {
    const userId    = String(req.user._id);
    const citizenId = req.user.citizenId || `CB${userId}`;

    const DEVICE_FIELDS = [
      'platform', 'performanceTier',
      'hasAR', 'hasVR', 'hasWebXR', 'has3DAccel',
      'screenWidth', 'screenHeight', 'pixelRatio',
      'networkQuality', 'batteryLevel',
    ];

    const deviceUpdate = { 'device.registeredAt': new Date() };
    for (const key of DEVICE_FIELDS) {
      if (req.body[key] !== undefined) deviceUpdate[`device.${key}`] = req.body[key];
    }

    const profile = await UserExperienceProfile.findOneAndUpdate(
      { userId },
      {
        $set: { ...deviceUpdate, citizenId },
        $setOnInsert: { userId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // Return the effective tier based on the freshly registered device state
    const effectiveTier = computeEffectiveTier(profile, {});

    res.status(200).json({
      status: true,
      data: {
        device:      profile.device,
        effectiveTier,
        message: 'Device capabilities registered',
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/me/experience/onboarding
 *
 * Mark onboarding step progress or completion.
 * Body: { step: number, completed: boolean }
 */
router.post('/experience/onboarding', requireAuth, async (req, res, next) => {
  try {
    const userId = String(req.user._id);
    const { step, completed } = req.body;

    const update = {};
    if (step !== undefined) update.onboardingStep = parseInt(step, 10) || 0;
    if (completed === true) update.hasCompletedOnboarding = true;

    const profile = await UserExperienceProfile.findOneAndUpdate(
      { userId },
      { $set: { ...update, citizenId: req.user.citizenId || `CB${userId}` }, $setOnInsert: { userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.status(200).json({ status: true, data: { onboardingStep: profile.onboardingStep, hasCompletedOnboarding: profile.hasCompletedOnboarding } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
