const workshopRoute = require('express').Router();
const {
  getAllWorkshops,
  createWorkshop,
  getMyWorkshops,
  getWorkshop,
  updateWorkshop,
  cancelWorkshop,
  addSchedule,
  deleteSchedule,
  deleteWorkshop,
  enrollWorkshop,
  getMyEnrolledWorkshops,
  getWorkshopEnrollees,
  getAgoraToken
} = require('../controllers/workshopController');
const { authenticateUser } = require('../middlewares');
const validateRequest = require('../middlewares/validateRequest');
const { addSchedulesSchema, createWorkshopSchema, updateWorkshopSchema } = require('../validators/workshopValidator');


/**
 * @route   GET /api/v1/workshops
 * @desc    Get all public workshops (published or active)
 * @access  Public
 */
workshopRoute.get('/', getAllWorkshops);

/**
 * @route   POST /api/v1/workshops
 * @desc    Create a new workshop
 * @access  User
 */
workshopRoute.post(
  '/',
  authenticateUser,
  validateRequest(createWorkshopSchema),
  createWorkshop
);

/**
 * @route   GET /api/v1/workshops/my
 * @desc    Get all workshops created by the logged-in teacher
 * @access  User
 */
workshopRoute.get('/my', authenticateUser, getMyWorkshops);

/**
 * @route   GET /api/v1/workshops/:id
 * @desc    Get a single workshop by ID (owner only)
 * @access  User
 */
workshopRoute.get('/:id', authenticateUser, getWorkshop);

/**
 * @route   PUT /api/v1/workshops/:id
 * @desc    Update a workshop (draft status only)
 * @access  User — owner only
 */
workshopRoute.put(
  '/:id',
  authenticateUser,
  validateRequest(updateWorkshopSchema),
  updateWorkshop
);

/**
 * @route   PATCH /api/v1/workshops/:id/cancel
 * @desc    Cancel a workshop (soft delete)
 * @access  User — owner only
 */
workshopRoute.patch('/:id/cancel', authenticateUser, cancelWorkshop);

/**
 * @route   DELETE /api/v1/workshops/:id
 * @desc    Delete a workshop (hard delete)
 * @access  User — owner only, draft or cancelled status only
 */
workshopRoute.delete('/:id', authenticateUser, deleteWorkshop);

/**
 * @route   POST /api/v1/workshops/:workshopId/enroll
 * @desc    Enroll in a workshop as a student or instructor
 * @access  User
 */
workshopRoute.post('/:workshopId/enroll', authenticateUser, enrollWorkshop);

/**
 * @route   GET /api/v1/workshops/enrolled/my
 * @desc    Get all workshops where the current user is enrolled
 * @access  User
 */
workshopRoute.get('/enrolled/my', authenticateUser, getMyEnrolledWorkshops);

/**
 * @route   GET /api/v1/workshops/:id/enrollees
 * @desc    Get all enrollees for a workshop (owner only)
 * @access  User
 */
workshopRoute.get('/:id/enrollees', authenticateUser, getWorkshopEnrollees);

// ==================== SCHEDULE MANAGEMENT ====================

/**
 * @route   POST /api/v1/workshops/:id/schedules
 * @desc    Add one or more schedules to a draft/published workshop in a single request.
 *          Body: { "schedules": [ {...}, {...} ] }
 *          Validates role-based scheduling + instructor/facility overlap.
 * @access  User — owner or enrolled instructor
 */
workshopRoute.post(
  '/:id/schedules',
  authenticateUser,
  validateRequest(addSchedulesSchema),
  addSchedule
);

/**
 * @route   DELETE /api/v1/workshops/:id/schedules/:scheduleId
 * @desc    Remove a schedule from a workshop by its subdocument _id.
 * @access  User — owner or enrolled instructor
 */
workshopRoute.delete(
  '/:id/schedules/:scheduleId',
  authenticateUser,
  deleteSchedule
);

/**
 * @route   GET /api/v1/workshops/:workshopId/schedules/:scheduleId/agora-token
 * @desc    Generate a short-lived Agora RTC token for a live session.
 *          Role (host/audience) is determined by the caller's enrollment:
 *            - Workshop creator / Expert / Instructor → host (PUBLISHER)
 *            - Student in live_broadcast              → audience (SUBSCRIBER)
 *            - Student in interactive_class           → host (PUBLISHER, full-duplex)
 * @access  User — must be enrolled or be the workshop creator
 */
workshopRoute.get(
  '/:workshopId/schedules/:scheduleId/agora-token',
  authenticateUser,
  getAgoraToken
);

module.exports = workshopRoute;
