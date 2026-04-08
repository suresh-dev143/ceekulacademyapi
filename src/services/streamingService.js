'use strict';

/**
 * Video Streaming Service
 *
 * Features:
 *   - HLS (HTTP Live Streaming) for adaptive bitrate
 *   - Server-Side Ad Insertion (SSAI)
 *   - Live stream management
 *   - Ad slot trigger after 50 minutes
 *
 * For production: integrate with AWS IVS, Mux, or NGINX RTMP
 */

const crypto = require('crypto');
const Lecture = require('../models/lectureModel');
const { matchAdsForStudent } = require('./adMatchingService');
const { startAdImpression } = require('./accountingService');
const { analyzeImpression } = require('./fraudDetectionService');
const { publishEvent, EVENT_TYPES } = require('./eventService');

const AD_TRIGGER_MINUTES = 50; // Trigger ad slot after 50 minutes
const STREAM_KEY_EXPIRY = 12 * 60 * 60; // 12 hours in seconds

/**
 * Generate a secure stream key for a teacher
 */
function generateStreamKey(lectureId, teacherId) {
  const data = `${lectureId}:${teacherId}:${Date.now()}`;
  return crypto.createHmac('sha256', process.env.STREAM_SECRET || 'default_secret')
    .update(data)
    .digest('hex')
    .substring(0, 32);
}

/**
 * Start a live lecture
 */
async function startLiveLecture(lectureId, teacherId) {
  const lecture = await Lecture.findOne({ _id: lectureId, teacherId });
  if (!lecture) throw new Error('Lecture not found');
  if (lecture.isLive) throw new Error('Lecture is already live');

  const streamKey = generateStreamKey(lectureId, teacherId);

  lecture.streamKey = streamKey;
  lecture.streamUrl = `${process.env.RTMP_SERVER_URL || 'rtmp://stream.platform.com'}/live/${streamKey}`;
  lecture.hlsPlaylistUrl = `${process.env.HLS_SERVER_URL || 'https://hls.platform.com'}/live/${streamKey}/index.m3u8`;
  lecture.isLive = true;
  lecture.status = 'live';
  lecture.startedAt = new Date();
  await lecture.save();

  // Schedule ad slot trigger after AD_TRIGGER_MINUTES
  scheduleAdSlot(lectureId, AD_TRIGGER_MINUTES * 60 * 1000);

  await publishEvent(EVENT_TYPES.LECTURE_STARTED, {
    lectureId,
    teacherId,
    streamKey,
    hlsUrl: lecture.hlsPlaylistUrl,
    timestamp: new Date().toISOString()
  });

  return {
    streamKey,
    rtmpUrl: lecture.streamUrl,
    hlsUrl: lecture.hlsPlaylistUrl,
    adSlotAt: AD_TRIGGER_MINUTES
  };
}

/**
 * End a live lecture
 */
async function endLiveLecture(lectureId, teacherId) {
  const lecture = await Lecture.findOne({ _id: lectureId, teacherId });
  if (!lecture) throw new Error('Lecture not found');

  lecture.isLive = false;
  lecture.status = 'processing';
  lecture.endedAt = new Date();
  await lecture.save();

  await publishEvent(EVENT_TYPES.LECTURE_ENDED, {
    lectureId,
    teacherId,
    duration: (lecture.endedAt - lecture.startedAt) / 60000, // minutes
    timestamp: new Date().toISOString()
  });

  return lecture;
}

/**
 * Get personalized HLS playlist with SSAI (Server-Side Ad Insertion)
 *
 * Returns an M3U8 manifest with ad segments spliced in after the main content.
 * In production this would proxy through an ad stitching server.
 */
async function getPersonalizedPlaylist(lectureId, studentId, options = {}) {
  const lecture = await Lecture.findById(lectureId).lean();
  if (!lecture) throw new Error('Lecture not found');

  // Get matched ads for this student
  const matchResult = await matchAdsForStudent(studentId, lectureId);

  const baseHlsUrl = lecture.hlsPlaylistUrl || lecture.videoUrl;
  const adManifest = buildAdManifest(matchResult.ads);

  // SSAI: Build combined M3U8
  const manifest = buildSSAIManifest(baseHlsUrl, adManifest, {
    adSlotAt: AD_TRIGGER_MINUTES * 60, // seconds
    totalDuration: lecture.duration * 60
  });

  // Start impression sessions for each ad
  const impressionSessions = [];
  for (const ad of matchResult.ads) {
    const fraudCheck = await analyzeImpression({
      studentId,
      adId: ad.adId.toString(),
      lectureId,
      deviceFingerprint: options.deviceFingerprint,
      ipAddress: options.ipAddress,
      sessionId: options.sessionId
    });

    if (!fraudCheck.isFraudulent) {
      const session = await startAdImpression({
        sessionId: `${options.sessionId || crypto.randomUUID()}_${ad.adId}`,
        adId: ad.adId.toString(),
        lectureId,
        studentId,
        teacherId: lecture.teacherId.toString(),
        isLive: lecture.isLive,
        adDuration: ad.duration,
        ratePerSecond: ad.effectiveRate,
        multiplier: ad.multiplier,
        effectiveRate: ad.effectiveRate,
        deviceFingerprint: options.deviceFingerprint,
        ipAddress: options.ipAddress
      });
      impressionSessions.push(session);
    }
  }

  return {
    manifest,
    ads: matchResult.ads,
    impressionSessions: impressionSessions.map(s => ({
      sessionId: s.sessionId,
      adId: s.adId
    })),
    adSlotAt: AD_TRIGGER_MINUTES * 60
  };
}

/**
 * Build SSAI M3U8 manifest (simplified)
 * In production: use AWS MediaTailor or Wowza
 */
function buildSSAIManifest(baseHlsUrl, adManifest, { adSlotAt, totalDuration }) {
  return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-DISCONTINUITY-SEQUENCE:0

# Main lecture content (0 to ${adSlotAt}s)
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
${baseHlsUrl}?t=0&end=${adSlotAt}

# === AD BREAK START ===
#EXT-X-DISCONTINUITY
#EXT-X-CUE-IN
${adManifest}
#EXT-X-CUE-OUT
#EXT-X-DISCONTINUITY

# Resume lecture content
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
${baseHlsUrl}?t=${adSlotAt}&end=${totalDuration}

#EXT-X-ENDLIST`;
}

function buildAdManifest(ads) {
  return ads.map(ad => `
#EXT-X-TARGETDURATION:${ad.duration}
#EXTINF:${ad.duration}.0,
${ad.videoUrl}
`).join('\n');
}

/**
 * Schedule ad slot trigger for a live lecture
 */
function scheduleAdSlot(lectureId, delayMs) {
  setTimeout(async () => {
    try {
      await publishEvent('ad_slot_triggered', {
        lectureId,
        timestamp: new Date().toISOString(),
        duration: 10 * 60 // 10 minutes
      });
      console.log(`[Streaming] Ad slot triggered for lecture ${lectureId}`);
    } catch (err) {
      console.error('[Streaming] Ad slot trigger error:', err.message);
    }
  }, delayMs);
}

/**
 * Student joins a lecture
 */
async function studentJoinLecture(lectureId, studentId) {
  await Lecture.findByIdAndUpdate(lectureId, {
    $inc: { liveViewerCount: 1 }
  });

  await publishEvent(EVENT_TYPES.STUDENT_JOINED, {
    lectureId,
    studentId,
    timestamp: new Date().toISOString()
  });
}

/**
 * Student leaves a lecture
 */
async function studentLeaveLecture(lectureId, studentId) {
  await Lecture.findByIdAndUpdate(lectureId, {
    $inc: { liveViewerCount: -1, viewCount: 1 }
  });

  await publishEvent(EVENT_TYPES.STUDENT_LEFT, {
    lectureId,
    studentId,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  generateStreamKey,
  startLiveLecture,
  endLiveLecture,
  getPersonalizedPlaylist,
  studentJoinLecture,
  studentLeaveLecture
};
