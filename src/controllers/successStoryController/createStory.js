'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const sharp  = require('sharp');
const SuccessStory = require('../../models/successStoryModel');
const { validateContent, toStoryStatus } = require('../../services/contentValidationService');

// Separate multer config — 50 MB limit to support video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/stories';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `story-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/ogg'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and videos are allowed.'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
}).fields([{ name: 'media', maxCount: 10 }]);

const uploadStoryMedia = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);

    // Compress images > 5 MB
    if (req.files?.media) {
      const tasks = req.files.media.map(async (file) => {
        if (file.mimetype.startsWith('image/') && file.size > 5 * 1024 * 1024) {
          const outPath = path.join(file.destination, `compressed-${file.filename}`);
          await sharp(file.path).resize(1080).jpeg({ quality: 70 }).toFile(outPath);
          fs.unlinkSync(file.path);
          file.path     = outPath;
          file.filename = `compressed-${file.filename}`;
        }
      });
      await Promise.all(tasks);
    }

    next();
  });
};

const createStory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { title, description, category, subCategory } = req.body;

    // AI content validation — gate before any DB write
    let validation;
    try {
      validation = await validateContent({ userId, title, description, category });
    } catch (validationErr) {
      console.error('Content validation service error:', validationErr);
      // Fail open: treat as NEEDS_REVIEW so content isn't silently lost
      validation = { status: 'NEEDS_REVIEW', reason: 'Validation service unavailable.' };
    }

    if (validation.status === 'REJECTED') {
      // Clean up any uploaded files before returning
      if (req.files?.media) {
        for (const file of req.files.media) {
          fs.unlink(file.path, () => {});
        }
      }
      return res.status(400).json({
        status: false,
        message: `Content rejected: ${validation.reason}`,
        validation
      });
    }

    const media = [];
    if (req.files?.media) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      for (const file of req.files.media) {
        const rel  = file.path.replace(/\\/g, '/').replace(/^public\//, '');
        const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
        media.push({ type, url: `${baseUrl}/public/${rel}` });
      }
    }

    const storyStatus = toStoryStatus(validation.status);

    const story = await SuccessStory.create({
      userId,
      title,
      description,
      category,
      subCategory: subCategory || null,
      media,
      status: storyStatus
    });

    const message = storyStatus === 'approved'
      ? 'Story published successfully.'
      : 'Story submitted successfully and is awaiting approval.';

    return res.status(201).json({
      status: true,
      message,
      data: story,
      validation
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }
    console.error('Create Story Error:', err);
    return res.status(500).json({ status: false, message: 'Failed to create story' });
  }
};

module.exports = { uploadStoryMedia, createStory };
