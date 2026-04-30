'use strict';

const mongoose = require('mongoose');

const scheduleRowSchema = new mongoose.Schema({
  day:      { type: String, default: '' },
  time:     { type: String, default: '' },
  location: { type: String, default: '' }
}, { _id: false });

const resourceSchema = new mongoose.Schema({
  resourceType:      { type: String, default: '' },
  resourceName:      { type: String, default: '' },
  details:           { type: String, default: '' },
  possibleUses:      { type: String, default: '' },
  discussionEnabled: { type: Boolean, default: false },
  gradingEnabled:    { type: Boolean, default: false }
}, { _id: true, timestamps: true });

const supplySchema = new mongoose.Schema({
  providerId:   { type: String, required: true, index: true },
  providerName: { type: String, default: '' },
  category: {
    type: String,
    enum: ['education', 'healthcare', 'justice', 'infrastructure', 'service', 'product'],
    required: true
  },
  title:       { type: String, required: true, maxlength: 200 },
  ceebrainId:  { type: String, default: '' },
  status:      { type: String, enum: ['active', 'inactive', 'draft'], default: 'active' },

  // Education / generic details
  details: {
    area:           { type: String, default: '' },
    providerDetails:{ type: String, default: '' },
    mode:           { type: String, enum: ['online', 'offline', 'hybrid', ''], default: '' },
    serviceType:    { type: String, default: '' },
    specialistInfo: { type: String, default: '' },
    experience:     { type: String, default: '' },
    caseCategories: { type: String, default: '' },
    capacity:       { type: String, default: '' },
    description:    { type: String, default: '' },
    useCases:       { type: String, default: '' },
    deliveryMode:   { type: String, default: '' }
  },

  schedule: {
    rows:         { type: [scheduleRowSchema], default: [] },
    durationFrom: { type: String, default: '' },
    durationTo:   { type: String, default: '' }
  },

  pricing: {
    fees:         { type: Number, default: 0 },
    concession:   { type: Number, default: 0, min: 0, max: 100 },
    revenueShare: { type: Number, default: 0, min: 0, max: 100 },
    pricingModel: { type: String, default: '' },
    bplFemale:    { type: Boolean, default: false },
    bplMale:      { type: Boolean, default: false }
  },

  contact: {
    phone:   { type: String, default: '' },
    email:   { type: String, default: '' },
    address: { type: String, default: '' }
  },

  resources: { type: [resourceSchema], default: [] }
}, { timestamps: true });

supplySchema.index({ category: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Supply', supplySchema);
