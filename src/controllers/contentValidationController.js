'use strict';

const { validateContent } = require('../services/contentValidationService');

const validateStoryContent = async (req, res) => {
  try {
    const userId = req.user._id;
    const { title, description, category } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({
        status: false,
        message: 'title, description, and category are required.'
      });
    }

    const result = await validateContent({ userId, title, description, category });
    return res.status(200).json({ status: true, data: result });
  } catch (err) {
    console.error('Content validation error:', err);
    return res.status(500).json({ status: false, message: 'Content validation failed.' });
  }
};

module.exports = { validateStoryContent };
