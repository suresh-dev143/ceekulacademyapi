'use strict';

const MyActivities = require('../../models/myActivitiesModel');

// POST /api/my-activities — create or overwrite (upsert by userId)
const saveActivities = async (req, res) => {
  try {
    const userId    = req.user._id;
    const { activities } = req.body;

    if (!Array.isArray(activities)) {
      return res.status(400).json({ status: false, message: 'activities must be an array' });
    }

    const doc = await MyActivities.findOneAndUpdate(
      { userId },
      { $set: { activities } },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      status: true,
      message: 'Activities saved successfully',
      data: doc
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }
    console.error('Save Activities Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to save activities' });
  }
};

module.exports = saveActivities;
