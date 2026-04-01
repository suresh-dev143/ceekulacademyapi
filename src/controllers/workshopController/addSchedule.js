const mongoose = require('mongoose');
const Workshop = require('../../models/workshopModel');
const PartnerInfrastructure = require('../../models/partnerInfrastructure.model');
const { localToUTC, detectSessionConflicts } = require('../../utils/timezoneUtils');

/**
 * Add one or more schedules to an existing workshop in a single request.
 */
const addSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: false, message: 'Invalid workshop ID' });
    }

    const workshop = await Workshop.findById(id);

    if (!workshop) {
      return res.status(404).json({ status: false, message: 'Workshop not found' });
    }

    const { Enrollment } = require('../../models/authModels');
    const enrollment = await Enrollment.findOne({ workshopId: id, userId: req.user._id });
    const isOwner = workshop.createdBy.toString() === req.user._id.toString();

    if (!isOwner && (!enrollment || enrollment.role !== 'Instructor')) {
      return res.status(403).json({
        status: false,
        message: 'Access denied. You must be the owner or an enrolled Instructor to add schedules.'
      });
    }

    if (!['draft', 'published'].includes(workshop.status)) {
      return res.status(403).json({
        status: false,
        message: `Schedules can only be added to draft or published workshops. Current status: '${workshop.status}'.`
      });
    }

    const { schedules: newSchedules } = req.validatedBody; // always an array (min 1)

    const now = new Date();

    // 1. Role-based eligibility check & future date validation
    for (let i = 0; i < newSchedules.length; i++) {
      const s = newSchedules[i];
      
      const plan = workshop.threeHourPlan && workshop.threeHourPlan['hour' + s.sessionOrder];
      if (plan) {
        if (isOwner) {
          if (plan.expertAllowed === false) {
            return res.status(403).json({ status: false, message: `Experts are not allowed to schedule Session ${s.sessionOrder}.` });
          }
        } else {
          if (plan.instructorAllowed === false) {
            return res.status(403).json({ status: false, message: `Instructors are not allowed to schedule Session ${s.sessionOrder}.` });
          }
        }
      }

      const startUTC = localToUTC(s.date, s.startTime, workshop.timezone);
      if (startUTC <= now) {
        return res.status(400).json({
          status: false,
          message: `schedules[${i}]: start date/time must be in the future`
        });
      }

      // ── NEW: Strict Infrastructure Availability Check ───────────────────────
      if (s.mode === 'hybrid' && s.facilityId) {
        const infra = await PartnerInfrastructure.findOne({
          $or: [
            { 'classrooms._id': s.facilityId },
            { 'computerLabs._id': s.facilityId },
            { 'otherFacilities._id': s.facilityId }
          ]
        });

        if (!infra) {
          return res.status(404).json({ status: false, message: `schedules[${i}]: Selected facility not found` });
        }

        // Find the specific facility using Mongoose .id() helper for subdocs
        const facility = (infra.classrooms && infra.classrooms.id(s.facilityId)) || 
                         (infra.computerLabs && infra.computerLabs.id(s.facilityId)) || 
                         (infra.otherFacilities && infra.otherFacilities.id(s.facilityId));
        
        if (!facility) {
          return res.status(404).json({ status: false, message: `schedules[${i}]: Facility record inconsistent` });
        }

        // Check availabilitySchedule matching by Date or Day
        const searchDate = new Date(s.date);
        const dayName = searchDate.toLocaleDateString('en-US', { weekday: 'long' });
        
        const schedule = facility.availabilitySchedule.find(as => 
          as.date === s.date || as.day === dayName
        );

        if (!schedule || schedule.status === 'Closed') {
          return res.status(400).json({ 
            status: false, 
            message: `schedules[${i}]: Facility "${facility.name}" has no available schedule on ${s.date} (${dayName})` 
          });
        }

        // Verify specific granular slots if provided (selectedSlots)
        // This prevents instructors from manually extending times beyond what was selected
        const requestedSlots = s.facilityDetails?.selectedSlots || [];
        if (requestedSlots.length > 0) {
            const unavailable = requestedSlots.filter(t => {
                const match = (schedule.slots || []).find(sl => sl.time === t);
                return !match || match.status !== 'Available';
            });
            
            if (unavailable.length > 0) {
                return res.status(400).json({ 
                    status: false, 
                    message: `schedules[${i}]: Requested slots are unavailable or already booked: ${unavailable.join(', ')}` 
                });
            }
        }
      }
    }

    // 2. Overlap check across existing + all incoming schedules combined
    const existingForCheck = workshop.schedules.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      startTime: s.startTime,
      endTime: s.endTime,
      instructorId: s.instructorId,
      location: s.location || ''
    }));

    const incomingForCheck = newSchedules.map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      instructorId: req.user._id,
      location: s.location || ''
    }));

    const { hasConflict, conflictDetails } = detectSessionConflicts(
      [...existingForCheck, ...incomingForCheck],
      workshop.timezone
    );

    if (hasConflict) {
      return res.status(409).json({
        status: false,
        message: `Schedule conflict: ${conflictDetails}`
      });
    }

    // Map incoming schedules to the shape expected by the subdocument schema
    const scheduleDocs = newSchedules.map((s) => {
      const plan = workshop.threeHourPlan['hour' + s.sessionOrder];
      return {
        ...s,
        activity: plan ? plan.title : '',
        description: plan ? plan.description : '',
        instructorId: req.user._id,
        date: new Date(s.date),
        location: s.location || null
      };
    });

    // Push all new schedules atomically
    const updated = await Workshop.findByIdAndUpdate(
      id,
      { $push: { schedules: { $each: scheduleDocs } } },
      { new: true, runValidators: true }
    ).select('-__v');

    // Recalculate revenue (findByIdAndUpdate bypasses pre-save hook)
    const total = updated.schedules.reduce((sum, s) => sum + (s.fee || 0), 0);
    await Workshop.findByIdAndUpdate(id, { $set: { totalRevenuePotential: total } });
    updated.totalRevenuePotential = total;

    // Return only the newly added schedules (last N)
    const addedSchedules = updated.schedules.slice(-newSchedules.length);

    return res.status(201).json({
      status: true,
      message: `${newSchedules.length} schedule(s) added successfully`,
      data: {
        addedSchedules,
        totalSchedules: updated.schedules.length,
        totalRevenuePotential: total
      }
    });

  } catch (error) {
    console.error('Add Schedule Error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }

    return res.status(500).json({ status: false, message: 'Failed to add schedule(s)' });
  }
};

module.exports = addSchedule;
