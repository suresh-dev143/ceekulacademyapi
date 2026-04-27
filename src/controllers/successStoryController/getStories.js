'use strict';

const SuccessStory = require('../../models/successStoryModel');

const getStories = async (req, res) => {
  try {
    const { status = 'approved', limit = 30, page = 1, category } = req.query;

    const filter = { status };
    if (category) filter.category = category;

    const limitNum = Math.min(parseInt(limit) || 30, 100);
    const pageNum  = parseInt(page) || 1;
    const skip     = (pageNum - 1) * limitNum;

    const [stories, total] = await Promise.all([
      SuccessStory.find(filter)
        .populate('userId', 'name profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      SuccessStory.countDocuments(filter)
    ]);

    return res.status(200).json({
      status: true,
      data: stories,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('Get Stories Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to fetch stories' });
  }
};

module.exports = getStories;
