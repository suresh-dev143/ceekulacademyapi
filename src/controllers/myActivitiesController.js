'use strict';

const MyActivities = require('../models/myActivitiesModel');

/**
 * GET /api/my-activities
 * Returns the calling user's schedule_overrides keyed by hour.
 */
const getActivities = async (req, res) => {
  try {
    const doc = await MyActivities.findOne({ userId: req.user._id }).lean();
    return res.status(200).json({
      status: true,
      schedule_overrides: doc?.schedule_overrides ?? {},
      ceebrainId: doc?.ceebrainId ?? null,
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};

/**
 * POST /api/my-activities
 * Upserts the user's entire schedule_overrides map.
 * Body: { schedule_overrides: Record<string, { user_override?, custom_content? }>, ceebrainId? }
 */
const saveActivities = async (req, res) => {
  try {
    const { schedule_overrides = {}, ceebrainId } = req.body;
    const update = { $set: { schedule_overrides } };
    if (ceebrainId) update.$set.ceebrainId = ceebrainId;

    const doc = await MyActivities.findOneAndUpdate(
      { userId: req.user._id },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ status: true, message: 'Schedule saved', _id: doc._id });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};

/**
 * PUT /api/my-activities/:id
 * Updates a single hour's override entry.
 * Body: { hour: number, override: { user_override?, custom_content? } | null }
 * Passing override: null removes that hour's entry.
 */
const updateActivities = async (req, res) => {
  try {
    const { hour, override } = req.body;
    if (hour === undefined || hour === null) {
      return res.status(400).json({ status: false, message: 'hour is required' });
    }
    const key = `schedule_overrides.${hour}`;
    const update = (override !== undefined && override !== null)
      ? { $set: { [key]: override } }
      : { $unset: { [key]: '' } };

    await MyActivities.findOneAndUpdate(
      { userId: req.user._id },
      update,
      { upsert: true, new: true }
    );
    return res.status(200).json({ status: true, message: 'Hour updated' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};

module.exports = { getActivities, saveActivities, updateActivities };
