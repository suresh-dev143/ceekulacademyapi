'use strict';
const { buildHorizon } = require('../services/screenPredictionService');
const ScreenState       = require('../models/screenStateModel');

exports.horizon = async (req, res) => {
  const userId   = req.user._id;
  const deviceId = req.query.deviceId || null;
  const depth    = Math.min(parseInt(req.query.depth) || 3, 5);

  // Get current context from screen state, or fall back to query param
  let context = req.query.context || 'home';
  if (deviceId) {
    const state = await ScreenState.findOne({ userId, deviceId }).lean();
    if (state?.context) context = state.context;
  }

  const nodes = buildHorizon(context, depth);
  res.json({ status: true, data: { center: context, depth, nodes } });
};
