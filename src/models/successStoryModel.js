'use strict';

const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'video'], required: true },
    url:  { type: String, required: true }
  },
  { _id: false }
);

const successStorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required']
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [5,   'Title must be at least 5 characters'],
      maxlength: [120, 'Title cannot exceed 120 characters']
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      minlength: [50,   'Description must be at least 50 characters'],
      maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: ['education', 'career', 'growth', 'technology', 'community', 'health', 'business']
    },
    subCategory: {
      type: String,
      trim: true,
      maxlength: [60, 'Sub-category cannot exceed 60 characters'],
      default: null
    },
    media: {
      type: [mediaSchema],
      default: []
    },
    likes: {
      type: Number,
      default: 0,
      min: 0
    },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    views: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    }
  },
  {
    timestamps: true,
    collection: 'successstories'
  }
);

successStorySchema.index({ status: 1, createdAt: -1 });
successStorySchema.index({ userId: 1, createdAt: -1 });
successStorySchema.index({ category: 1, status: 1 });

module.exports = mongoose.model('SuccessStory', successStorySchema);
