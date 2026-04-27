'use strict';

const SuccessStory = require('../../models/successStoryModel');

const getStoryById = async (req, res) => {
  try {
    const story = await SuccessStory.findById(req.params.id)
      .populate('userId', 'name profileImage')
      .lean();

    if (!story) {
      return res.status(404).json({ status: false, message: 'Story not found' });
    }

    return res.status(200).json({ status: true, data: story });
  } catch (err) {
    console.error('Get Story Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to fetch story' });
  }
};

module.exports = getStoryById;
