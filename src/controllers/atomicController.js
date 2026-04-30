'use strict';

const AtomicContent = require('../models/atomicContentModel');
const Course = require('../models/courseModel');
const Workshop = require('../models/workshopModel');

/**
 * THE SAVE ENGINE: Debounced Autosave
 * Targets the 'currentDraft' object to minimize write-amplification.
 * Uses $set to overwrite only the draft layer, preserving the base.
 */
exports.autosave = async (req, res) => {
  try {
    const { id, draft } = req.body;
    
    const content = await AtomicContent.findByIdAndUpdate(
      id,
      { $set: { currentDraft: draft } },
      { new: true }
    );

    if (!content) {
      return res.status(404).json({ error: 'Atomic content not found' });
    }

    res.status(200).json({ status: 'synced', timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * THE EVOLUTION ENGINE: Layered Updates
 * Stores user edits and AI research as independent arrays targeting segmentId.
 * Implements history capping to prevent document growth issues.
 */
exports.addUpdate = async (req, res) => {
  try {
    const { id, segmentId, content, type } = req.body; // type: 'user' | 'ai'
    const updateField = type === 'ai' ? 'aiUpdates' : 'userUpdates';
    
    // 1. Push the new update
    const doc = await AtomicContent.findById(id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    doc[updateField].push({ segmentId, content, timestamp: new Date() });

    // 2. Capping Logic: Maintain only the last 50 updates per layer
    // This ensures document integrity while preventing the 16MB limit breach.
    if (doc[updateField].length > 50) {
      doc[updateField] = doc[updateField].slice(-50);
    }

    await doc.save();

    res.status(200).json({ 
      status: 'evolution_recorded', 
      layer: type,
      historyCount: doc[updateField].length 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET ATOMIC EVOLUTION
 * Retrieves the base layer + current draft + update history.
 */
exports.getEvolution = async (req, res) => {
  try {
    const content = await AtomicContent.findById(req.params.id);
    if (!content) return res.status(404).json({ error: 'Not found' });
    
    res.status(200).json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * THE GLOBAL DISPATCHER (USE & SEND)
 * Universal API endpoint to link Content IDs to Containers.
 * Uses $addToSet to ensure unique references without data duplication.
 */
exports.dispatch = async (req, res) => {
  try {
    const { contentId, containerId, containerType, role, metadata } = req.body;
    
    let Model;
    switch (containerType) {
      case 'Course': Model = Course; break;
      case 'Workshop': Model = Workshop; break;
      default: return res.status(400).json({ error: 'Invalid container type' });
    }

    // 1. Check if Atomic Content exists
    const exists = await AtomicContent.exists({ _id: contentId });
    if (!exists) return res.status(404).json({ error: 'Source Atomic Content not found' });

    // 2. Add reference to container using $addToSet (ensures uniqueness)
    const container = await Model.findByIdAndUpdate(
      containerId,
      { 
        $addToSet: { 
          linkedAtomicContent: { 
            contentId, 
            role, 
            metadata: metadata || {} 
          } 
        } 
      },
      { new: true }
    );

    if (!container) return res.status(404).json({ error: 'Target container not found' });

    res.status(200).json({ 
      status: 'dispatched', 
      contentId, 
      containerId, 
      role 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * LIST MY ATOMIC CONTENT
 * Retrieves all atomic content owned by the authenticated user.
 */
exports.listMyContent = async (req, res) => {
  try {
    const list = await AtomicContent.find({ ownerId: req.user._id })
      .sort({ updatedAt: -1 })
      .select('prefix subPath activity title updatedAt isPublished isShared');
    
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE ATOMIC CONTENT
 * Removes the atomic content document and its history.
 */
exports.deleteContent = async (req, res) => {
  try {
    const content = await AtomicContent.findOneAndDelete({ 
      _id: req.params.id, 
      ownerId: req.user._id 
    });

    if (!content) return res.status(404).json({ error: 'Content not found or unauthorized' });

    res.status(200).json({ status: 'deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
