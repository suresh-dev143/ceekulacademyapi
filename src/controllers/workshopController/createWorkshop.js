const Workshop = require('../../models/workshopModel');
const { localToUTC, detectSessionConflicts } = require('../../utils/timezoneUtils');

/**
 * Create a new workshop
 * POST /api/v1/workshops
 * @access Teacher (verified)
 */
const createWorkshop = async (req, res) => {
  try {
    const createdBy = req.user._id;
    const {
      workshopTitle,
      workshopDescription,
      expertDescription,
      threeHourPlan,
      contentRef,
      schedules = []
    } = req.validatedBody;

    // Validate each schedule date is not in the past (timezone-aware)
    const now = new Date();
    if (schedules && schedules.length > 0) {
      for (let i = 0; i < schedules.length; i++) {
        const s = schedules[i];
        const startUTC = localToUTC(s.date, s.startTime, s.timezone);
        if (startUTC <= now) {
          return res.status(400).json({
            status: false,
            message: `Schedule ${i + 1} start date/time must be in the future`
          });
        }
      }

      // Detect schedule time overlaps
      const { hasConflict, conflictDetails } = detectSessionConflicts(schedules);
      if (hasConflict) {
        return res.status(409).json({
          status: false,
          message: `Schedule conflict detected: ${conflictDetails}`
        });
      }
    }

    // Map schedules: convert date string to Date object
    const mappedSchedules = (schedules || []).map((s) => {
      const plan = threeHourPlan && threeHourPlan['hour' + s.sessionOrder];
      return {
        ...s,
        activity: plan ? plan.title : '',
        description: plan ? plan.description : '',
        date: new Date(s.date),
        location: s.location || null,
        instructorId: createdBy
      };
    });

    const workshop = new Workshop({
      workshopTitle,
      workshopDescription,
      expertDescription,
      createdBy,
      threeHourPlan,
      contentRef: contentRef || null,
      schedules: mappedSchedules,
      status: 'draft'
    });

    await workshop.save();

    // Automatically enroll the creator as the 'expert'
    const { Enrollment } = require('../../models/authModels');
    await Enrollment.create({
      workshopId: workshop._id,
      userId: createdBy,
      role: 'Expert',
      status: 'active'
    });

    return res.status(201).json({
      status: true,
      message: 'Workshop created successfully',
      data: workshop
    });
  } catch (error) {
    console.error('Create Workshop Error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }

    return res.status(500).json({ status: false, message: 'Failed to create workshop' });
  }
};

module.exports = createWorkshop;
