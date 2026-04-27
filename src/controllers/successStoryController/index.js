'use strict';

const { uploadStoryMedia, createStory } = require('./createStory');
const getStories    = require('./getStories');
const getStoryById  = require('./getStoryById');
const viewStory     = require('./viewStory');
const likeStory     = require('./likeStory');

module.exports = { uploadStoryMedia, createStory, getStories, getStoryById, viewStory, likeStory };
