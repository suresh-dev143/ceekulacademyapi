'use strict';

const Lecture = require('../models/lectureModel');
const Preferences = require('../models/preferencesModel');
const {
  startLiveLecture,
  endLiveLecture,
  getPersonalizedPlaylist,
  studentJoinLecture,
  studentLeaveLecture
} = require('../services/streamingService');
const { publishEvent, EVENT_TYPES } = require('../services/eventService');

/**
 * POST /api/lectures
 * Teacher creates a lecture
 */
async function createLecture(req, res, next) {
  try {
    const teacherId = req.user._id;
    const {
      title, description, category, tags, type,
      videoUrl, duration, adSlotDuration,
      adControl, preferredAdCategories, blockedAdCategories,
      minimumAdRate, scheduledAt, courseId
    } = req.body;

    const lecture = await Lecture.create({
      teacherId,
      courseId,
      title, description, category, tags,
      type: type || 'recorded',
      videoUrl,
      duration: duration || 50,
      adSlotDuration: adSlotDuration || 10,
      adControl: adControl || 'teacher',
      preferredAdCategories: preferredAdCategories || [],
      blockedAdCategories: blockedAdCategories || [],
      minimumAdRate: minimumAdRate || 0,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: type === 'live' ? 'scheduled' : 'draft'
    });

    res.status(201).json({ status: true, message: 'Lecture created', data: lecture });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/lectures/:lectureId/go-live
 * Teacher starts live streaming
 */
async function goLive(req, res, next) {
  try {
    const { lectureId } = req.params;
    const teacherId = req.user._id;

    const result = await startLiveLecture(lectureId, teacherId);

    res.json({
      status: true,
      message: 'Live stream started',
      data: result,
      instructions: {
        obs: `Set OBS stream URL to: ${result.rtmpUrl}`,
        hlsPlayback: result.hlsUrl,
        adSlotAt: `Ad slot will auto-trigger at ${result.adSlotAt} minutes`
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/lectures/:lectureId/end-live
 * Teacher ends live stream
 */
async function endLive(req, res, next) {
  try {
    const { lectureId } = req.params;
    const teacherId = req.user._id;

    const lecture = await endLiveLecture(lectureId, teacherId);
    res.json({ status: true, message: 'Live stream ended', data: lecture });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/lectures/:lectureId/watch
 * Student gets personalized playlist (with SSAI)
 */
async function watchLecture(req, res, next) {
  try {
    const { lectureId } = req.params;
    const studentId = req.user._id;
    const {
      deviceFingerprint,
      sessionId = require('crypto').randomUUID()
    } = req.query;

    const ipAddress = req.ip || req.connection.remoteAddress;

    const result = await getPersonalizedPlaylist(lectureId, studentId, {
      deviceFingerprint,
      ipAddress,
      sessionId
    });

    await studentJoinLecture(lectureId, studentId);

    res.json({
      status: true,
      data: {
        manifest: result.manifest,
        hlsUrl: `/api/lectures/${lectureId}/playlist?studentId=${studentId}&sessionId=${sessionId}`,
        ads: result.ads,
        impressionSessions: result.impressionSessions,
        adSlotAt: result.adSlotAt,
        sessionId
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/lectures/:lectureId/playlist
 * Returns the actual M3U8 playlist (SSAI stitched)
 */
async function getPlaylist(req, res, next) {
  try {
    const { lectureId } = req.params;
    const { studentId, sessionId } = req.query;
    const ipAddress = req.ip;

    const result = await getPersonalizedPlaylist(lectureId, studentId, {
      ipAddress,
      sessionId
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(result.manifest);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/lectures/:lectureId/leave
 * Student leaves lecture
 */
async function leaveLecture(req, res, next) {
  try {
    const { lectureId } = req.params;
    const studentId = req.user._id;

    await studentLeaveLecture(lectureId, studentId);
    res.json({ status: true, message: 'Left lecture' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/lectures
 * Public: list published lectures
 */
async function getLectures(req, res, next) {
  try {
    const { page = 1, limit = 20, category, type, teacherId, search } = req.query;
    const filter = { status: { $in: ['published', 'live'] } };

    if (category) filter.category = category;
    if (type) filter.type = type;
    if (teacherId) filter.teacherId = teacherId;
    if (search) filter.$text = { $search: search };

    const [lectures, total] = await Promise.all([
      Lecture.find(filter)
        .populate('teacherId', 'name avatar')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      Lecture.countDocuments(filter)
    ]);

    res.json({ status: true, data: { lectures, total } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/teacher/lectures
 * Teacher's own lectures
 */
async function getTeacherLectures(req, res, next) {
  try {
    const teacherId = req.user._id;
    const { page = 1, limit = 20, status } = req.query;
    const filter = { teacherId };
    if (status) filter.status = status;

    const [lectures, total] = await Promise.all([
      Lecture.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)).lean(),
      Lecture.countDocuments(filter)
    ]);

    res.json({ status: true, data: { lectures, total } });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/lectures/:lectureId/preferences
 * Teacher updates ad preferences for a lecture
 */
async function updateLectureAdPreferences(req, res, next) {
  try {
    const { lectureId } = req.params;
    const teacherId = req.user._id;
    const { adControl, preferredAdCategories, blockedAdCategories, minimumAdRate } = req.body;

    const lecture = await Lecture.findOne({ _id: lectureId, teacherId });
    if (!lecture) return res.status(404).json({ status: false, message: 'Lecture not found' });

    if (adControl !== undefined) lecture.adControl = adControl;
    if (preferredAdCategories) lecture.preferredAdCategories = preferredAdCategories;
    if (blockedAdCategories) lecture.blockedAdCategories = blockedAdCategories;
    if (minimumAdRate !== undefined) lecture.minimumAdRate = minimumAdRate;

    await lecture.save();
    res.json({ status: true, message: 'Ad preferences updated', data: lecture });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/lectures/:lectureId/publish
 */
async function publishLecture(req, res, next) {
  try {
    const { lectureId } = req.params;
    const teacherId = req.user._id;

    const lecture = await Lecture.findOne({ _id: lectureId, teacherId });
    if (!lecture) return res.status(404).json({ status: false, message: 'Lecture not found' });

    lecture.status = 'published';
    lecture.isPublished = true;
    lecture.publishedAt = new Date();
    await lecture.save();

    res.json({ status: true, message: 'Lecture published', data: lecture });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createLecture,
  goLive,
  endLive,
  watchLecture,
  getPlaylist,
  leaveLecture,
  getLectures,
  getTeacherLectures,
  updateLectureAdPreferences,
  publishLecture
};
