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
const { authenticateAny } = require('../middlewares');
const validateRequest = require('../middlewares/validateRequest');
const { addSchedulesSchema, createWorkshopSchema, updateWorkshopSchema } = require('../validators/workshopValidator');

/**
 * @swagger
 * components:
 *   schemas:
 *     HourPlan:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         expertAllowed:
 *           type: boolean
 *         instructorAllowed:
 *           type: boolean
 *
 *     Schedule:
 *       type: object
 *       required: [date, startTime, endTime, sessionOrder, fee, mode, timezone]
 *       properties:
 *         _id:
 *           type: string
 *           description: Auto-generated ID of the schedule (for updates/deletion)
 *         date:
 *           type: string
 *           format: date
 *           example: "2024-05-20"
 *         startTime:
 *           type: string
 *           description: "HH:mm format"
 *           example: "10:00"
 *         endTime:
 *           type: string
 *           description: "HH:mm format"
 *           example: "13:00"
 *         sessionOrder:
 *           type: integer
 *           enum: [1, 2, 3]
 *           description: "1 = Hour 1, 2 = Hour 2, 3 = Hour 3"
 *         activity:
 *           type: string
 *           maxLength: 200
 *         fee:
 *           type: number
 *           minimum: 0
 *         mode:
 *           type: string
 *           enum: [online, hybrid]
 *         streamMode:
 *           type: string
 *           enum: [live_broadcast, interactive_class]
 *           nullable: true
 *         location:
 *           type: string
 *           description: Required for hybrid sessions
 *           nullable: true
 *         instructorId:
 *           type: string
 *           description: User ID of the instructor assigned
 *         timezone:
 *           type: string
 *           description: IANA timezone string (e.g., Asia/Kolkata)
 *
 *     Workshop:
 *       type: object
 *       required: [workshopTitle, workshopDescription, createdBy]
 *       properties:
 *         _id:
 *           type: string
 *         workshopTitle:
 *           type: string
 *           minLength: 5
 *           maxLength: 120
 *         workshopDescription:
 *           type: string
 *         expertDescription:
 *           type: string
 *         createdBy:
 *           type: string
 *           description: User ID of the owner
 *         status:
 *           type: string
 *           enum: [draft, published, cancelled]
 *         threeHourPlan:
 *           type: object
 *           properties:
 *             hour1:
 *               $ref: '#/components/schemas/HourPlan'
 *             hour2:
 *               $ref: '#/components/schemas/HourPlan'
 *             hour3:
 *               $ref: '#/components/schemas/HourPlan'
 *         schedules:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Schedule'
 *         totalRevenuePotential:
 *           type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     CreateWorkshopRequest:
 *       type: object
 *       required: [workshopTitle, workshopDescription]
 *       properties:
 *         workshopTitle:
 *           type: string
 *         workshopDescription:
 *           type: string
 *         expertDescription:
 *           type: string
 *         threeHourPlan:
 *           type: object
 *         schedules:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Schedule'
 *
 *     UpdateWorkshopRequest:
 *       type: object
 *       properties:
 *         workshopTitle:
 *           type: string
 *         workshopDescription:
 *           type: string
 *         expertDescription:
 *           type: string
 *         status:
 *           type: string
 *           enum: [draft, published, cancelled]
 *
 *     AddSchedulesRequest:
 *       type: object
 *       required: [schedules]
 *       properties:
 *         schedules:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Schedule'
 */
/**
 * @swagger
 * /api/v1/workshops:
 *   get:
 *     summary: Get all public workshops
 *     description: Retrieve a list of workshops that are either published or active.
 *     tags: [Workshops]
 *     responses:
 *       200:
 *         description: A list of workshops
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Workshop'
 */
workshopRoute.get('/', getAllWorkshops);

/**
 * @swagger
 * /api/v1/workshops:
 *   post:
 *     summary: Create a new workshop
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWorkshopRequest'
 *     responses:
 *       201:
 *         description: Workshop created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Workshop'
 *       400:
 *         description: Validation error
 */
workshopRoute.post(
  '/',
  authenticateAny,
  validateRequest(createWorkshopSchema),
  createWorkshop
);

/**
 * @swagger
 * /api/v1/workshops/my:
 *   get:
 *     summary: Get workshops created by the logged-in user
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of workshops owned by the teacher
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Workshop'
 */
workshopRoute.get('/my', authenticateAny, getMyWorkshops);

/**
 * @swagger
 * /api/v1/workshops/{id}:
 *   get:
 *     summary: Get a single workshop by ID
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The workshop ID
 *     responses:
 *       200:
 *         description: Workshop details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Workshop'
 *       404:
 *         description: Workshop not found
 */
workshopRoute.get('/:id', authenticateAny, getWorkshop);

/**
 * @swagger
 * /api/v1/workshops/{id}:
 *   put:
 *     summary: Update a workshop
 *     description: Update workshop details. Only allowed for owners while in draft status.
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateWorkshopRequest'
 *     responses:
 *       200:
 *         description: Workshop updated successfully
 *       403:
 *         description: Unauthorized or not in draft status
 */
workshopRoute.put(
  '/:id',
  authenticateAny,
  validateRequest(updateWorkshopSchema),
  updateWorkshop
);

/**
 * @swagger
 * /api/v1/workshops/{id}/cancel:
 *   patch:
 *     summary: Cancel a workshop
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workshop cancelled (soft delete)
 */
workshopRoute.patch('/:id/cancel', authenticateAny, cancelWorkshop);

/**
 * @swagger
 * /api/v1/workshops/{id}:
 *   delete:
 *     summary: Delete a workshop
 *     description: Hard delete a workshop. Only allowed if in draft or cancelled status.
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workshop deleted successfully
 */
workshopRoute.delete('/:id', authenticateAny, deleteWorkshop);

/**
 * @swagger
 * /api/v1/workshops/{workshopId}/enroll:
 *   post:
 *     summary: Enroll in a workshop
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: workshopId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Enrolled successfully
 */
workshopRoute.post('/:workshopId/enroll', authenticateAny, enrollWorkshop);

/**
 * @swagger
 * /api/v1/workshops/enrolled/my:
 *   get:
 *     summary: Get my enrolled workshops
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of workshops the user is enrolled in
 */
workshopRoute.get('/enrolled/my', authenticateAny, getMyEnrolledWorkshops);

/**
 * @swagger
 * /api/v1/workshops/{id}/enrollees:
 *   get:
 *     summary: Get enrollees for a workshop
 *     tags: [Workshops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of enrollees (User objects)
 */
workshopRoute.get('/:id/enrollees', authenticateAny, getWorkshopEnrollees);

// ==================== SCHEDULE MANAGEMENT ====================

/**
 * @swagger
 * /api/v1/workshops/{id}/schedules:
 *   post:
 *     summary: Add schedules to a workshop
 *     description: Add one or more schedules. Validates for instructor/facility overlap.
 *     tags: [Workshop Schedules]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddSchedulesRequest'
 *     responses:
 *       200:
 *         description: Schedules added successfully
 */
workshopRoute.post(
  '/:id/schedules',
  authenticateAny,
  validateRequest(addSchedulesSchema),
  addSchedule
);

/**
 * @swagger
 * /api/v1/workshops/{id}/schedules/{scheduleId}:
 *   delete:
 *     summary: Remove a schedule from a workshop
 *     tags: [Workshop Schedules]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule removed successfully
 */
workshopRoute.delete(
  '/:id/schedules/:scheduleId',
  authenticateAny,
  deleteSchedule
);

/**
 * @swagger
 * /api/v1/workshops/{workshopId}/schedules/{scheduleId}/agora-token:
 *   get:
 *     summary: Generate Agora RTC token
 *     description: Generate a token for a live session based on the caller's enrollment role.
 *     tags: [Workshop Live]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: workshopId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agora token generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 */
workshopRoute.get(
  '/:workshopId/schedules/:scheduleId/agora-token',
  authenticateAny,
  getAgoraToken
);

module.exports = workshopRoute;
