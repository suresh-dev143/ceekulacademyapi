'use strict';
const ScreenState = require('../models/screenStateModel');

exports.resonance = async (req, res) => {
  // Active = updated in the last 20 minutes
  const since    = new Date(Date.now() - 20 * 60 * 1000);
  const contexts = (req.query.contexts || '').split(',').filter(Boolean);

  // Aggregate: count agents per context, active since threshold
  const pipeline = [
    { $match: { updatedAt: { $gte: since } } },
    { $group: { _id: '$context', count: { $sum: 1 } } },
  ];
  if (contexts.length) {
    pipeline[0].$match.context = { $in: contexts };
  }

  const raw = await ScreenState.aggregate(pipeline);

  // Normalize: density = count / (max count across all contexts), range 0–1
  const max = raw.reduce((m, r) => Math.max(m, r.count), 1);
  const density = {};
  raw.forEach(r => { density[r._id] = { count: r.count, density: r.count / max }; });

  res.json({ status: true, data: { density, windowMinutes: 20, since } });
};
