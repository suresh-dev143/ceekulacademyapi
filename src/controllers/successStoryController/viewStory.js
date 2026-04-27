'use strict';

const SuccessStory = require('../../models/successStoryModel');

const viewStory = async (req, res) => {
  try {
    await SuccessStory.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
    return res.status(200).json({ status: true });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Failed to record view' });
  }
};

module.exports = viewStory;
