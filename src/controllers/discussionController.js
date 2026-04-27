'use strict';

const DiscussionRoom    = require('../models/discussionRoomModel');
const DiscussionMessage = require('../models/discussionMessageModel');

// GET /api/discussion/rooms?type=public&contextId=xxx
async function listRooms(req, res) {
  try {
    const { type, contextId, contextType, limit = 30, skip = 0 } = req.query;
    const filter = { isActive: true };
    if (type)        filter.type        = type;
    if (contextId)   filter.contextId   = contextId;
    if (contextType) filter.contextType = contextType;

    const rooms = await DiscussionRoom.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip(Number(skip))
      .limit(Math.min(Number(limit), 50))
      .lean();

    res.json({ status: true, data: rooms });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// GET /api/discussion/rooms/:roomId
async function getRoom(req, res) {
  try {
    const room = await DiscussionRoom.findById(req.params.roomId).lean();
    if (!room) return res.status(404).json({ status: false, message: 'Room not found' });
    res.json({ status: true, data: room });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// POST /api/discussion/rooms
async function createRoom(req, res) {
  try {
    const { type = 'public', title, topic, contextId, contextType } = req.body;
    if (!title?.trim()) return res.status(400).json({ status: false, message: 'title is required' });

    const userId   = req.user?._id?.toString() || req.user?.id;
    const userName = req.user?.name || 'Anonymous';

    const room = await DiscussionRoom.create({
      type,
      title: title.trim(),
      topic: topic?.trim() || '',
      contextId: contextId || null,
      contextType: contextType || null,
      createdBy: { userId, userName },
      participants: [{ userId, userName }]
    });

    res.status(201).json({ status: true, data: room });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// GET /api/discussion/rooms/:roomId/messages?limit=50&before=<messageId>
async function getMessages(req, res) {
  try {
    const { limit = 50, before } = req.query;
    const filter = { roomId: req.params.roomId };
    if (before) filter._id = { $lt: before };

    const messages = await DiscussionMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit), 100))
      .lean();

    res.json({ status: true, data: messages.reverse() });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// POST /api/discussion/rooms/:roomId/join
async function joinRoom(req, res) {
  try {
    const userId   = req.user?._id?.toString() || req.user?.id;
    const userName = req.user?.name || 'Anonymous';

    const room = await DiscussionRoom.findByIdAndUpdate(
      req.params.roomId,
      { $addToSet: { participants: { userId, userName } } },
      { new: true }
    ).lean();

    if (!room) return res.status(404).json({ status: false, message: 'Room not found' });
    res.json({ status: true, data: room });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

module.exports = { listRooms, getRoom, createRoom, getMessages, joinRoom };
