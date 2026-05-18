'use strict';

/**
 * Cinematic Metadata Service
 *
 * Attaches deterministic visual/rendering metadata to schedules and programs
 * for the cinematic homepage experience. Pure functions — no DB calls, no AI.
 *
 * Each program and schedule gets:
 *   colorPalette   — primary, secondary, accent, gradient stops
 *   animationHint  — what motion style to use (surge, flow, pulse, drift, ascend)
 *   heroTier       — featured | prominent | standard (based on enrolment rank)
 *   depthTier      — 1 | 2 | 3 (parallax depth layer in 3D space)
 *   xrMeta         — placeholder for AR/VR asset references (null until content has 3D assets)
 *   particleDensity — how many particles to render at this tier (0 = none)
 *   entryTransition — how the card enters the viewport
 *
 * Color palettes are perceptually balanced and work in both light and dark mode.
 * Gradients are expressed as [from, via, to] stop arrays for flexible rendering.
 */

// ── Category palettes ─────────────────────────────────────────────────────────

const CATEGORY_PALETTES = {
  course: {
    primary:    '#6C63FF',
    secondary:  '#3F3D56',
    accent:     '#FF6584',
    gradient:   ['#6C63FF', '#9C95FF', '#C4C0FF'],
    darkGradient: ['#3B3680', '#6C63FF', '#9C95FF'],
  },
  workshop: {
    primary:    '#F4A261',
    secondary:  '#264653',
    accent:     '#2A9D8F',
    gradient:   ['#E76F51', '#F4A261', '#FAC899'],
    darkGradient: ['#7B3E2A', '#E76F51', '#F4A261'],
  },
  webinar: {
    primary:    '#4CC9F0',
    secondary:  '#4361EE',
    accent:     '#7209B7',
    gradient:   ['#4361EE', '#4CC9F0', '#A8EDFF'],
    darkGradient: ['#1A2B8C', '#4361EE', '#4CC9F0'],
  },
  research: {
    primary:    '#2B9348',
    secondary:  '#007F5F',
    accent:     '#AACC00',
    gradient:   ['#007F5F', '#2B9348', '#80B918'],
    darkGradient: ['#004030', '#007F5F', '#2B9348'],
  },
  project: {
    primary:    '#FB5607',
    secondary:  '#FF006E',
    accent:     '#FFBE0B',
    gradient:   ['#FF006E', '#FB5607', '#FFBE0B'],
    darkGradient: ['#7A002E', '#FF006E', '#FB5607'],
  },
  advertisement: {
    primary:    '#E63946',
    secondary:  '#457B9D',
    accent:     '#1D3557',
    gradient:   ['#457B9D', '#E63946', '#FF6B7A'],
    darkGradient: ['#1D3557', '#457B9D', '#E63946'],
  },
  'vision-flow': {
    primary:    '#9B5DE5',
    secondary:  '#F15BB5',
    accent:     '#00BBF9',
    gradient:   ['#9B5DE5', '#F15BB5', '#FEE440'],
    darkGradient: ['#4A1080', '#9B5DE5', '#F15BB5'],
  },
  other: {
    primary:    '#606C70',
    secondary:  '#9BA4B5',
    accent:     '#394867',
    gradient:   ['#394867', '#606C70', '#9BA4B5'],
    darkGradient: ['#1A2333', '#394867', '#606C70'],
  },
};

// ── Category animation hints ──────────────────────────────────────────────────

const CATEGORY_ANIMATIONS = {
  course:         { hint: 'flow',   entry: 'slide-up',   exit: 'fade-down', particle: 'none'    },
  workshop:       { hint: 'surge',  entry: 'zoom-in',    exit: 'zoom-out',  particle: 'sparks'  },
  webinar:        { hint: 'pulse',  entry: 'fade-in',    exit: 'fade-out',  particle: 'dots'    },
  research:       { hint: 'drift',  entry: 'slide-left', exit: 'slide-right', particle: 'grid'  },
  project:        { hint: 'surge',  entry: 'zoom-in',    exit: 'slide-down', particle: 'flames' },
  advertisement:  { hint: 'flash',  entry: 'zoom-in',    exit: 'fade-out',  particle: 'none'    },
  'vision-flow':  { hint: 'ascend', entry: 'rise',       exit: 'descend',   particle: 'stars'   },
  other:          { hint: 'fade',   entry: 'fade-in',    exit: 'fade-out',  particle: 'none'    },
};

// ── Particle density per animation level ──────────────────────────────────────

const PARTICLE_COUNT = {
  baseline:  { sparks: 0,  dots: 0,  grid: 0,  flames: 0,  stars: 0  },
  standard:  { sparks: 0,  dots: 12, grid: 0,  flames: 0,  stars: 20 },
  cinematic: { sparks: 40, dots: 30, grid: 20, flames: 25, stars: 60 },
  immersive: { sparks: 80, dots: 60, grid: 50, flames: 60, stars: 120 },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get color palette for a category.
 * Returns the default 'other' palette for unknown categories.
 */
function getPalette(category) {
  return CATEGORY_PALETTES[category] || CATEGORY_PALETTES.other;
}

/**
 * Get animation metadata for a category.
 */
function getAnimation(category) {
  return CATEGORY_ANIMATIONS[category] || CATEGORY_ANIMATIONS.other;
}

/**
 * Compute hero tier for a schedule/program based on its rank in a list.
 *
 * @param {number} enrolmentCount
 * @param {number} maxEnrolmentCount  — highest count in the current set
 */
function getHeroTier(enrolmentCount, maxEnrolmentCount) {
  const ratio = maxEnrolmentCount > 0 ? enrolmentCount / maxEnrolmentCount : 0;
  if (ratio >= 0.7) return 'featured';
  if (ratio >= 0.35) return 'prominent';
  return 'standard';
}

/**
 * Compute parallax depth tier (1 = far/background, 3 = near/foreground).
 * Featured content sits in the foreground; standard content recedes.
 */
function getDepthTier(heroTier) {
  return heroTier === 'featured' ? 3 : heroTier === 'prominent' ? 2 : 1;
}

/**
 * Attach full cinematic metadata to an array of schedule/program objects.
 *
 * @param {object[]} items          — array of schedule or program objects
 * @param {string}   animationLevel — user's experience level
 * @param {string}   [enrolCountKey] — field name for enrolment count (default 'enrolmentCount')
 * @param {string}   [categoryKey]   — field name for category (default 'category')
 * @returns {object[]} items with .cinematic property attached
 */
function enrichWithCinematicMeta(items, animationLevel = 'standard', {
  enrolCountKey = 'enrolmentCount',
  categoryKey   = 'category',
} = {}) {
  if (!items?.length) return [];

  const maxCount = Math.max(...items.map(i => i[enrolCountKey] || 0), 1);
  const particleDensity = PARTICLE_COUNT[animationLevel] || PARTICLE_COUNT.standard;

  return items.map((item, idx) => {
    const category  = item[categoryKey] || 'other';
    const count     = item[enrolCountKey] || 0;
    const palette   = getPalette(category);
    const anim      = getAnimation(category);
    const heroTier  = getHeroTier(count, maxCount);
    const depthTier = getDepthTier(heroTier);
    const pCount    = particleDensity[anim.particle] || 0;

    return {
      ...item,
      cinematic: {
        heroTier,
        depthTier,
        colorPalette: palette,
        animationHint:  anim.hint,
        entryTransition: anim.entry,
        exitTransition:  anim.exit,
        particleType:    animationLevel === 'baseline' ? 'none' : anim.particle,
        particleCount:   pCount,
        listIndex:       idx,
        // XR anchor placeholder — populated when content has associated 3D assets
        xrMeta: item.xrAssetUrl
          ? { type: 'ar-anchor', assetUrl: item.xrAssetUrl, scale: 1.0 }
          : null,
      },
    };
  });
}

/**
 * Compute the effective rendering tier the server recommends for a client.
 *
 * Rules (in priority order):
 *   1. reducedMotion → always 'baseline' (accessibility)
 *   2. batteryLevel < 0.15 → cap at 'standard'
 *   3. networkQuality = 'poor' → cap at 'standard'
 *   4. performanceTier = 'low' → cap at 'standard'
 *   5. xrInterest ≠ 'none' but !hasAR && !hasVR → downgrade xr interest to 'none'
 *   6. Otherwise → use stated animationLevel
 *
 * @param {object} profile  — UserExperienceProfile document
 * @param {object} device   — current device snapshot (may differ from stored)
 * @returns {{ tier, xrActive, colorScheme, reducedMotion, recommendations }}
 */
function computeEffectiveTier(profile, deviceOverride = {}) {
  const stored  = profile?.device || {};
  const device  = { ...stored, ...deviceOverride };
  const stated  = profile?.animationLevel || 'standard';

  if (profile?.reducedMotion) {
    return { tier: 'baseline', xrActive: false, colorScheme: profile.colorScheme || 'auto',
      reducedMotion: true, recommendations: ['reducedMotion_override'] };
  }

  const recommendations = [];
  let tier = stated;

  if ((device.batteryLevel ?? 1) < 0.15) {
    if (tier === 'immersive' || tier === 'cinematic') { tier = 'standard'; recommendations.push('low_battery'); }
  }

  if (device.networkQuality === 'poor') {
    if (tier === 'immersive' || tier === 'cinematic') { tier = 'standard'; recommendations.push('poor_network'); }
  }

  if (device.performanceTier === 'low') {
    if (tier === 'immersive' || tier === 'cinematic') { tier = 'standard'; recommendations.push('low_performance'); }
  }

  // Resolve XR
  const wantsXR  = profile?.xrInterest && profile.xrInterest !== 'none';
  const canXR    = device.hasAR || device.hasVR || device.hasWebXR;
  const xrActive = tier === 'immersive' && wantsXR && canXR;

  if (wantsXR && !canXR) recommendations.push('xr_unavailable_on_device');

  return { tier, xrActive, colorScheme: profile?.colorScheme || 'auto', reducedMotion: false, recommendations };
}

module.exports = {
  enrichWithCinematicMeta,
  computeEffectiveTier,
  getPalette,
  getAnimation,
  CATEGORY_PALETTES,
  CATEGORY_ANIMATIONS,
};
