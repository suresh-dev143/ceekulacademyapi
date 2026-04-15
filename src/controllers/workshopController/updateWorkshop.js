const Workshop = require('../../models/workshopModel');
const { localToUTC, detectSessionConflicts } = require('../../utils/timezoneUtils');
const mongoose = require('mongoose');

/**
 * Update a workshop (only allowed in 'draft' status)
 * PUT /api/v1/workshops/:id
 * @access Teacher (verified) — owner only
 */
const updateWorkshop = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: false, message: 'Invalid workshop ID' });
    }

    const workshop = await Workshop.findById(id);

    if (!workshop) {
      return res.status(404).json({ status: false, message: 'Workshop not found' });
    }

    if (workshop.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: false,
        message: 'Access denied. Only the workshop owner can update it.'
      });
    }

    if (!['draft', 'published'].includes(workshop.status)) {
      return res.status(403).json({
        status: false,
        message: `Workshop cannot be edited in '${workshop.status}' status. Only draft or published workshops can be edited.`
      });
    }

    const updates = req.validatedBody;

    // If schedules are being updated, run timezone-aware validations
    if (updates.schedules && updates.schedules.length > 0) {
      const now = new Date();

      for (let i = 0; i < updates.schedules.length; i++) {
        const s = updates.schedules[i];
        const startUTC = localToUTC(s.date, s.startTime, s.timezone);
        if (startUTC <= now) {
          return res.status(400).json({
            status: false,
            message: `Schedule ${i + 1} start date/time must be in the future`
          });
        }
      }

      const { hasConflict, conflictDetails } = detectSessionConflicts(updates.schedules);
      if (hasConflict) {
        return res.status(409).json({
          status: false,
          message: `Schedule conflict detected: ${conflictDetails}`
        });
      }

      const planSource = updates.threeHourPlan || workshop.threeHourPlan;
      updates.schedules = updates.schedules.map((s) => {
        const plan = planSource && planSource['hour' + s.sessionOrder];
        return {
          ...s,
          activity: plan ? plan.title : '',
          description: plan ? plan.description : '',
          date: new Date(s.date),
          location: s.location || null,
          instructorId: s.instructorId || workshop.createdBy
        };
      });
    } else if (updates.schedules && updates.schedules.length === 0) {
        updates.schedules = [];
    }

    // Ensure instructorId is set on all schedules when publishing
    if (updates.status === 'published' || workshop.status === 'published') {
      const schedulesToCheck = updates.schedules || workshop.schedules;
      schedulesToCheck.forEach(s => {
        if (!s.instructorId) s.instructorId = workshop.createdBy;
      });
    }

    Object.assign(workshop, updates);
    await workshop.save();

    return res.status(200).json({
      status: true,
      message: 'Workshop updated successfully',
      data: workshop
    });
  } catch (error) {
    console.error('Update Workshop Error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }

    return res.status(500).json({ status: false, message: 'Failed to update workshop' });
  }
};

module.exports = updateWorkshop;
