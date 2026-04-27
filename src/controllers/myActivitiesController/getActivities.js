'use strict';

const MyActivities = require('../../models/myActivitiesModel');

const getActivities = async (req, res) => {
  try {
    const userId = req.user._id;

    const doc = await MyActivities.findOne({ userId }).lean();

    return res.status(200).json({
      status: true,
      data: doc ?? null
    });
  } catch (err) {
    console.error('Get Activities Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to fetch activities' });
  }
};

module.exports = getActivities;
