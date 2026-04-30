'use strict';

const Supply = require('../models/supplyModel');

// GET /api/supply?category=education&status=active
async function listSupplies(req, res) {
  try {
    const { category, status = 'active', limit = 20, skip = 0 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status   = status;

    const supplies = await Supply.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Math.min(Number(limit), 50))
      .lean();

    res.json({ status: true, data: supplies });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// GET /api/supply/:id
async function getSupply(req, res) {
  try {
    const supply = await Supply.findById(req.params.id).lean();
    if (!supply) return res.status(404).json({ status: false, message: 'Supply not found' });
    res.json({ status: true, data: supply });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// POST /api/supply
async function createSupply(req, res) {
  try {
    const userId   = req.user?._id?.toString() || req.user?.id;
    const userName = req.user?.name || 'Anonymous';

    const { category, title } = req.body;
    if (!category || !title?.trim()) {
      return res.status(400).json({ status: false, message: 'category and title are required' });
    }

    const supply = await Supply.create({
      ...req.body,
      providerId:   userId,
      providerName: userName,
      title:        title.trim()
    });

    res.status(201).json({ status: true, data: supply });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// PUT /api/supply/:id
async function updateSupply(req, res) {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    const supply = await Supply.findOne({ _id: req.params.id, providerId: userId });
    if (!supply) return res.status(404).json({ status: false, message: 'Supply not found or unauthorized' });

    Object.assign(supply, req.body);
    await supply.save();
    res.json({ status: true, data: supply });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// POST /api/supply/:id/resource
async function addResource(req, res) {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    const supply = await Supply.findOne({ _id: req.params.id, providerId: userId });
    if (!supply) return res.status(404).json({ status: false, message: 'Supply not found or unauthorized' });

    supply.resources.push(req.body);
    await supply.save();
    res.json({ status: true, data: supply.resources });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// DELETE /api/supply/:id/resource/:resourceId
async function removeResource(req, res) {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    await Supply.updateOne(
      { _id: req.params.id, providerId: userId },
      { $pull: { resources: { _id: req.params.resourceId } } }
    );
    res.json({ status: true, message: 'Resource removed' });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

// DELETE /api/supply/:id
async function deleteSupply(req, res) {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    await Supply.deleteOne({ _id: req.params.id, providerId: userId });
    res.json({ status: true, message: 'Supply deleted' });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
}

module.exports = { listSupplies, getSupply, createSupply, updateSupply, addResource, removeResource, deleteSupply };
