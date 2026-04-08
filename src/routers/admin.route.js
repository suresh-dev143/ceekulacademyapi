const adminRoute = require("express").Router();
const { authenticateAdmin } = require("../middlewares");
const { login, profile, update, register, forgetPassword, verifyOTP, resetPassword }
= require('../controllers/adminController');
const { validateRequest } = require("../middlewares");
const { adminRegisterSchema } = require("../validators");
const {
  getPendingCourses,
  getCourseForReview,
  startReview,
  approveCourse,
  rejectCourse,
  requestChanges,
  toggleFeature,
  getAllCoursesAdmin
} = require('../controllers/courseController');

// ==================== ADMIN AUTH ====================
/**
 * @swagger
 * /admin/register:
 *   post:
 *     summary: Register a new admin
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, number]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *               number: { type: string }
 *     responses:
 *       201: { description: Admin registered successfully }
 */
adminRoute.post("/register", validateRequest(adminRegisterSchema), register);

/**
 * @swagger
 * /admin/login:
 *   post:
 *     summary: Admin login
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login successful }
 */
adminRoute.post("/login", login);

/**
 * @swagger
 * /admin/profile:
 *   get:
 *     summary: Get admin profile
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Admin profile details }
 */
adminRoute.get("/profile", authenticateAdmin, profile);

/**
 * @swagger
 * /admin/update:
 *   put:
 *     summary: Update admin profile
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile updated }
 */
adminRoute.put("/update", authenticateAdmin, update);

/**
 * @swagger
 * /admin/forgetPassword:
 *   post:
 *     summary: Request password reset for admin
 *     tags: [Admin]
 *     responses:
 *       200: { description: Reset OTP sent }
 */
adminRoute.post("/forgetPassword", forgetPassword);

/**
 * @swagger
 * /admin/verifyOTP:
 *   post:
 *     summary: Verify reset OTP for admin
 *     tags: [Admin]
 *     responses:
 *       200: { description: OTP verified }
 */
adminRoute.post("/verifyOTP", verifyOTP);

/**
 * @swagger
 * /admin/resetPassword:
 *   post:
 *     summary: Reset admin password
 *     tags: [Admin]
 *     responses:
 *       200: { description: Password reset successful }
 */
adminRoute.post("/resetPassword", resetPassword);

// ==================== COURSE MANAGEMENT ====================

/**
 * @route   GET /api/admin/courses
 * @desc    Get all courses (admin view)
 * @access  Admin
 */
adminRoute.get("/courses", authenticateAdmin, getAllCoursesAdmin);

/**
 * @route   GET /api/admin/courses/pending
 * @desc    Get courses pending review
 * @access  Admin
 */
adminRoute.get("/courses/pending", authenticateAdmin, getPendingCourses);

/**
 * @route   GET /api/admin/courses/:id/review
 * @desc    Get course details for review
 * @access  Admin
 */
adminRoute.get("/courses/:id/review", authenticateAdmin, getCourseForReview);

/**
 * @route   POST /api/admin/courses/:id/start-review
 * @desc    Start reviewing a course
 * @access  Admin
 */
adminRoute.post("/courses/:id/start-review", authenticateAdmin, startReview);

/**
 * @route   POST /api/admin/courses/:id/approve
 * @desc    Approve a course
 * @access  Admin
 */
adminRoute.post("/courses/:id/approve", authenticateAdmin, approveCourse);

/**
 * @route   POST /api/admin/courses/:id/reject
 * @desc    Reject a course
 * @access  Admin
 */
adminRoute.post("/courses/:id/reject", authenticateAdmin, rejectCourse);

/**
 * @route   POST /api/admin/courses/:id/request-changes
 * @desc    Request changes on a course
 * @access  Admin
 */
adminRoute.post("/courses/:id/request-changes", authenticateAdmin, requestChanges);

/**
 * @route   POST /api/admin/courses/:id/feature
 * @desc    Feature/unfeature a course
 * @access  Admin
 */
adminRoute.post("/courses/:id/feature", authenticateAdmin, toggleFeature);

// ==================== USER MANAGEMENT ====================
const {
  verifyTeacher,
  manageTeacher,
  listUsers,
} = require('../controllers/adminController/userManagement');

/**
 * @route   GET /admin/users
 * @desc    List users with filters (role, verificationStatus, search)
 * @access  Admin
 */
adminRoute.get("/users", authenticateAdmin, listUsers);

/**
 * @route   PUT /admin/users/:userId/manage
 * @desc    Admin oversight: suspend | activate | revoke | force_verify a teacher
 * @access  Admin
 */
adminRoute.put("/users/:userId/manage", authenticateAdmin, manageTeacher);

module.exports = adminRoute;
