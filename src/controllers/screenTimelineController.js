'use strict';
const UceContent = require('../models/uceContentModel');

exports.timeline = async (req, res) => {
  const userId = req.user._id;
  const limit  = Math.min(parseInt(req.query.limit) || 40, 100);
  const from   = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to     = req.query.to   ? new Date(req.query.to)   : new Date();

  const commits = await UceContent.find({
    ownerId:   userId,
    createdAt: { $gte: from, $lte: to },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('cid contentType payload createdAt')
    .lean();

  const points = commits.map(c => ({
    cid:         c.cid,
    contentType: c.contentType,
    context:     c.payload?.context || c.payload?.instructionType || c.contentType,
    label:       _label(c),
    ts:          c.createdAt,
    agentType:   c.payload?.agentType || 'human',
  }));

  res.json({ status: true, data: { points, from, to, total: points.length } });
};

function _label(c) {
  if (c.payload?.context) return c.payload.context;
  if (c.payload?.value)   return `search: ${String(c.payload.value).slice(0, 24)}`;
  return c.contentType;
}
