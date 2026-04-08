'use strict';

/**
 * Anti-Fraud Detection Service
 *
 * Detects:
 *   1. Bot traffic (rapid repeat views, no interaction)
 *   2. Fake students (no watch history, suspicious patterns)
 *   3. Repeated views (same ad + student within cooldown)
 *   4. Anomalous watch patterns
 *
 * Scoring: 0-100 (0 = clean, 100 = definite fraud)
 * Threshold: >70 = fraud, 40-70 = suspicious
 */

const AdImpression = require('../models/adImpressionModel');
const Wallet = require('../models/walletModel');

const FRAUD_THRESHOLD = 70;
const SUSPICIOUS_THRESHOLD = 40;

// Redis for real-time counters
let redisClient = null;
try {
  const redis = require('redis');
  redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  redisClient.connect().catch(() => { redisClient = null; });
} catch { /* no redis */ }

/**
 * Analyze an impression for fraud before recording revenue
 * @returns {{ isFraudulent: boolean, score: number, reasons: string[] }}
 */
async function analyzeImpression({
  studentId,
  adId,
  lectureId,
  deviceFingerprint,
  ipAddress,
  watchStartTime,
  sessionId
}) {
  const checks = await Promise.allSettled([
    checkRepeatViews(studentId, adId),
    checkRapidViews(studentId, ipAddress),
    checkDeviceAnomaly(deviceFingerprint, studentId),
    checkIpAnomaly(ipAddress),
    checkAccountAge(studentId)
  ]);

  let score = 0;
  const reasons = [];

  const [repeatResult, rapidResult, deviceResult, ipResult, accountResult] = checks;

  if (repeatResult.status === 'fulfilled') score += repeatResult.value.score;
  if (repeatResult.value?.reason) reasons.push(repeatResult.value.reason);

  if (rapidResult.status === 'fulfilled') score += rapidResult.value.score;
  if (rapidResult.value?.reason) reasons.push(rapidResult.value.reason);

  if (deviceResult.status === 'fulfilled') score += deviceResult.value.score;
  if (deviceResult.value?.reason) reasons.push(deviceResult.value.reason);

  if (ipResult.status === 'fulfilled') score += ipResult.value.score;
  if (ipResult.value?.reason) reasons.push(ipResult.value.reason);

  if (accountResult.status === 'fulfilled') score += accountResult.value.score;
  if (accountResult.value?.reason) reasons.push(accountResult.value.reason);

  score = Math.min(score, 100);
  const isFraudulent = score >= FRAUD_THRESHOLD;
  const isSuspicious = score >= SUSPICIOUS_THRESHOLD;

  if (isFraudulent) {
    await flagFraud(studentId, adId, score, reasons);
  }

  return { isFraudulent, isSuspicious, score, reasons };
}

/**
 * Check if same student watched same ad recently (cooldown: 24 hours)
 */
async function checkRepeatViews(studentId, adId) {
  const cooldownMs = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - cooldownMs);

  const count = await AdImpression.countDocuments({
    studentId,
    adId,
    startTime: { $gte: since },
    status: 'completed'
  });

  if (count > 3) return { score: 40, reason: `Repeated ad view: ${count} times in 24h` };
  if (count > 1) return { score: 15, reason: `Duplicate ad view: ${count} times` };
  return { score: 0 };
}

/**
 * Check for rapid-fire views from same IP (bot pattern)
 */
async function checkRapidViews(studentId, ipAddress) {
  if (!ipAddress) return { score: 0 };

  if (redisClient) {
    const key = `fraud:ip:${ipAddress}`;
    const count = await redisClient.incr(key);
    await redisClient.expire(key, 60); // 1-minute window

    if (count > 50) return { score: 50, reason: `Suspicious IP activity: ${count} req/min` };
    if (count > 20) return { score: 20, reason: `High IP frequency: ${count} req/min` };
  }

  return { score: 0 };
}

/**
 * Check device fingerprint consistency
 */
async function checkDeviceAnomaly(deviceFingerprint, studentId) {
  if (!deviceFingerprint) return { score: 10, reason: 'Missing device fingerprint' };

  // Check if this fingerprint has been used by many accounts
  const uniqueStudents = await AdImpression.distinct('studentId', {
    deviceFingerprint,
    startTime: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });

  if (uniqueStudents.length > 5) {
    return { score: 35, reason: `Device shared by ${uniqueStudents.length} accounts` };
  }

  return { score: 0 };
}

/**
 * Check IP against known VPN/proxy/datacenter ranges
 */
async function checkIpAnomaly(ipAddress) {
  if (!ipAddress) return { score: 5 };

  // Datacenter IP ranges (simplified heuristic)
  const datacenterPatterns = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
  for (const pattern of datacenterPatterns) {
    if (pattern.test(ipAddress)) {
      return { score: 15, reason: 'Private/datacenter IP detected' };
    }
  }

  return { score: 0 };
}

/**
 * Check account age and activity history
 */
async function checkAccountAge(studentId) {
  const { User } = require('../models/authModels');
  const user = await User.findById(studentId).select('createdAt').lean();
  if (!user) return { score: 20, reason: 'User not found' };

  const ageHours = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60);
  if (ageHours < 1) return { score: 30, reason: 'Account less than 1 hour old' };
  if (ageHours < 24) return { score: 15, reason: 'Account less than 24 hours old' };

  // Check if student has ever enrolled in any course
  const hasHistory = await AdImpression.exists({ studentId, status: 'completed' });
  if (!hasHistory && ageHours < 72) return { score: 10, reason: 'New account with no history' };

  return { score: 0 };
}

/**
 * Flag a student for fraud
 */
async function flagFraud(studentId, adId, score, reasons) {
  try {
    // Freeze wallet if score is very high
    if (score >= 85) {
      await Wallet.findOneAndUpdate(
        { userId: studentId },
        { $set: { isFrozen: true } }
      );
      console.warn(`[Fraud] Wallet frozen for student ${studentId}, score: ${score}`);
    }
  } catch (err) {
    console.error('[Fraud] Flag error:', err.message);
  }
}

/**
 * Get fraud report for an ad campaign
 */
async function getAdFraudReport(adId) {
  const stats = await AdImpression.aggregate([
    { $match: { adId: new (require('mongoose').Types.ObjectId)(adId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        fraudulent: { $sum: { $cond: ['$isFraudulent', 1, 0] } },
        avgFraudScore: { $avg: '$fraudScore' },
        blockedRevenue: {
          $sum: { $cond: ['$isFraudulent', '$totalRevenue', 0] }
        }
      }
    }
  ]);

  return stats[0] || { total: 0, fraudulent: 0, avgFraudScore: 0, blockedRevenue: 0 };
}

module.exports = {
  analyzeImpression,
  getAdFraudReport,
  FRAUD_THRESHOLD,
  SUSPICIOUS_THRESHOLD
};
