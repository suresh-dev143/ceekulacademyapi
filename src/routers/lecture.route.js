const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/lectureController');
const { authenticateUser, authenticateTeacher } = require('../middlewares');

// Public: list lectures
router.get('/', getLectures);

// Get M3U8 playlist (public — secured by session token)
router.get('/:lectureId/playlist', getPlaylist);

// Authenticated student routes
router.get('/:lectureId/watch', authenticateUser, watchLecture);
router.post('/:lectureId/leave', authenticateUser, leaveLecture);

// Teacher routes
router.post('/', authenticateTeacher, createLecture);
router.get('/teacher/mine', authenticateTeacher, getTeacherLectures);
router.post('/:lectureId/go-live', authenticateTeacher, goLive);
router.post('/:lectureId/end-live', authenticateTeacher, endLive);
router.patch('/:lectureId/publish', authenticateTeacher, publishLecture);
router.patch('/:lectureId/ad-preferences', authenticateTeacher, updateLectureAdPreferences);

module.exports = router;
