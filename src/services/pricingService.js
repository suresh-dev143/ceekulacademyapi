'use strict';

/**
 * Dynamic Pricing Service
 * effective_rate = base_rate × multiplier
 *
 * Multipliers:
 *  - Live streaming: configurable (default 2.0x)
 *  - Recorded content: 1.0x
 *  - Peak hours (6pm-10pm IST): +0.5x bonus
 *  - Weekend: +0.25x bonus
 */

const PRICING_CONFIG = {
  liveMultiplier: parseFloat(process.env.LIVE_AD_MULTIPLIER || '2.0'),
  recordedMultiplier: 1.0,
  peakHoursBonus: parseFloat(process.env.PEAK_HOURS_BONUS || '0.5'),
  weekendBonus: parseFloat(process.env.WEEKEND_BONUS || '0.25'),
  peakHourStart: parseInt(process.env.PEAK_HOUR_START || '18', 10), // 6 PM IST
  peakHourEnd: parseInt(process.env.PEAK_HOUR_END || '22', 10),     // 10 PM IST
};

/**
 * Calculate effective ad rate
 * @param {number} baseRate - base rate per second per student in Neurons
 * @param {boolean} isLive - whether the lecture is live
 * @param {Date} timestamp - time of ad play (defaults to now)
 * @returns {{ effectiveRate: number, multiplier: number, breakdown: object }}
 */
function calculateEffectiveRate(baseRate, isLive = false, timestamp = new Date()) {
  let multiplier = isLive ? PRICING_CONFIG.liveMultiplier : PRICING_CONFIG.recordedMultiplier;

  const istHour = getISTHour(timestamp);
  const dayOfWeek = getISTDay(timestamp); // 0=Sunday, 6=Saturday

  const isPeakHour = istHour >= PRICING_CONFIG.peakHourStart && istHour < PRICING_CONFIG.peakHourEnd;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isPeakHour) {
    multiplier += PRICING_CONFIG.peakHoursBonus;
  }
  if (isWeekend) {
    multiplier += PRICING_CONFIG.weekendBonus;
  }

  const effectiveRate = parseFloat((baseRate * multiplier).toFixed(6));

  return {
    effectiveRate,
    multiplier: parseFloat(multiplier.toFixed(4)),
    breakdown: {
      baseRate,
      isLive,
      isPeakHour,
      isWeekend,
      liveBonus: isLive ? PRICING_CONFIG.liveMultiplier - 1 : 0,
      peakBonus: isPeakHour ? PRICING_CONFIG.peakHoursBonus : 0,
      weekendBonus: isWeekend ? PRICING_CONFIG.weekendBonus : 0
    }
  };
}

/**
 * Calculate revenue split for a given amount
 * 33% teacher, 66% student, 1% platform
 */
function splitRevenue(totalRevenue) {
  const teacherShare = parseFloat((totalRevenue * 0.33).toFixed(6));
  const platformShare = parseFloat((totalRevenue * 0.01).toFixed(6));
  const studentShare = parseFloat((totalRevenue - teacherShare - platformShare).toFixed(6));

  return { teacherShare, studentShare, platformShare };
}

/**
 * Calculate revenue for a single second of ad playback
 */
function calculateSecondRevenue(baseRate, studentCount, isLive, timestamp) {
  const { effectiveRate, multiplier } = calculateEffectiveRate(baseRate, isLive, timestamp);
  const totalRevenue = parseFloat((effectiveRate * studentCount).toFixed(6));
  const split = splitRevenue(totalRevenue);

  return {
    effectiveRate,
    multiplier,
    studentCount,
    totalRevenue,
    ...split
  };
}

/**
 * Get current pricing multiplier for a lecture
 */
function getLectureMultiplier(lecture) {
  const isLive = lecture.isLive || lecture.type === 'live';
  const { multiplier } = calculateEffectiveRate(1, isLive);
  return multiplier;
}

/**
 * Update pricing config (admin use)
 */
function updateConfig(newConfig) {
  Object.assign(PRICING_CONFIG, newConfig);
}

function getConfig() {
  return { ...PRICING_CONFIG };
}

// ---- Helpers ----
function getISTHour(date) {
  const utcHour = date.getUTCHours();
  const istHour = (utcHour + 5 + (date.getUTCMinutes() >= 30 ? 1 : 0)) % 24;
  return istHour;
}

function getISTDay(date) {
  // IST = UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  return istDate.getUTCDay();
}

module.exports = {
  calculateEffectiveRate,
  splitRevenue,
  calculateSecondRevenue,
  getLectureMultiplier,
  updateConfig,
  getConfig
};
