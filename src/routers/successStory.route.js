'use strict';

const router = require('express').Router();
const {
  uploadStoryMedia,
  createStory,
  getStories,
  getStoryById,
  viewStory,
  likeStory
} = require('../controllers/successStoryController');
const { authenticateUser } = require('../middlewares');

// Public: list approved stories (with optional category filter)
router.get('/', getStories);

// Public: get single story
router.get('/:id', getStoryById);

// Authenticated: submit a new story (with optional media upload)
router.post('/', authenticateUser, uploadStoryMedia, createStory);

// Public: increment view count (fire-and-forget from client)
router.patch('/:id/view', viewStory);

// Authenticated: toggle like/unlike
router.patch('/:id/like', authenticateUser, likeStory);

module.exports = router;
