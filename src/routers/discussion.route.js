'use strict';

const express    = require('express');
const router     = express.Router();
const { listRooms, getRoom, createRoom, getMessages, joinRoom } = require('../controllers/discussionController');
const authenticateAny = require('../middlewares/authenticateAny');

// Public: anyone can list/view rooms and messages
router.get('/rooms',                    listRooms);
router.get('/rooms/:roomId',            getRoom);
router.get('/rooms/:roomId/messages',   getMessages);

// Auth required: create or join rooms
router.post('/rooms',                   authenticateAny, createRoom);
router.post('/rooms/:roomId/join',      authenticateAny, joinRoom);

module.exports = router;
