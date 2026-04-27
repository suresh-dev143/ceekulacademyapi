'use strict';

const SuccessStory = require('../../models/successStoryModel');

const likeStory = async (req, res) => {
  try {
    const userId = req.user._id;
    const story  = await SuccessStory.findById(req.params.id).select('likes likedBy');

    if (!story) {
      return res.status(404).json({ status: false, message: 'Story not found' });
    }

    const alreadyLiked = story.likedBy.some(id => id.equals(userId));

    if (alreadyLiked) {
      story.likedBy.pull(userId);
      story.likes = Math.max(0, story.likes - 1);
    } else {
      story.likedBy.push(userId);
      story.likes += 1;
    }

    await story.save();

    return res.status(200).json({
      status: true,
      data: { likes: story.likes, liked: !alreadyLiked }
    });
  } catch (err) {
    console.error('Like Story Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to toggle like' });
  }
};

module.exports = likeStory;
