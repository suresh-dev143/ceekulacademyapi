'use strict';

const MyActivities = require('../../models/myActivitiesModel');

// PUT /api/my-activities/:id — update by doc _id (must belong to calling user)
const updateActivities = async (req, res) => {
  try {
    const userId    = req.user._id;
    const { id }    = req.params;
    const { activities } = req.body;

    if (!Array.isArray(activities)) {
      return res.status(400).json({ status: false, message: 'activities must be an array' });
    }

    const doc = await MyActivities.findOneAndUpdate(
      { _id: id, userId },
      { $set: { activities } },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({ status: false, message: 'Activities document not found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Activities updated successfully',
      data: doc
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }
    console.error('Update Activities Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to update activities' });
  }
};

module.exports = updateActivities;
