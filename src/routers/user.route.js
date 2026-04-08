const userRoute = require("express").Router();
const { updateUserProfile, updateProfile, sendOTP, verifyOTP, signup, login, getUserById, getAllUsers, changePassword, applyTeacher, sendEmailOTP, verifyEmailOTP } = require("../controllers/userController");
const { authenticateUser, fileUploader } = require("../middlewares");
const validateRequest = require("../middlewares/validateRequest");
const { signupSchema } = require("../validators");

//---------- Public routes (no auth required) ----------
/**
 * @swagger
 * /users/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Users]
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
 *       201: { description: User created successfully }
 */
userRoute.post("/signup", signup);

/**
 * @swagger
 * /users/login:
 *   post:
 *     summary: Log in a user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emailOrNumber, password]
 *             properties:
 *               emailOrNumber: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login successful }
 */
userRoute.post("/login", login);

/**
 * @swagger
 * /users/sendOTP:
 *   post:
 *     summary: Send OTP for mobile verification
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [number]
 *             properties:
 *               number: { type: string }
 *     responses:
 *       200: { description: OTP sent successfully }
 */
userRoute.post("/sendOTP", sendOTP);

/**
 * @swagger
 * /users/verifyOTP:
 *   post:
 *     summary: Verify mobile OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [number, otp]
 *             properties:
 *               number: { type: string }
 *               otp: { type: string }
 *     responses:
 *       200: { description: OTP verified successfully }
 */
userRoute.post("/verifyOTP", verifyOTP);

//---------- Protected routes (auth required) ----------
// Static routes must come before dynamic :userId routes
// userRoute.get("/", authenticateUser, getAllUsers);

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users (Admin)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of users }
 */
userRoute.get("/",  getAllUsers);

/**
 * @swagger
 * /users/update-profile-image:
 *   post:
 *     summary: Update profile image
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Image updated successfully }
 */
userRoute.post("/update-profile-image", authenticateUser, fileUploader);

userRoute.post("/updateprofile", authenticateUser, fileUploader(
    [
        { name: "avtar", maxCount: 1 },
    ],
    "User"
), updateProfile);

// Teacher application
userRoute.post("/apply-teacher", authenticateUser, applyTeacher);

// ==================== EMAIL VERIFICATION ====================
/**
 * @swagger
 * /users/send-email-otp:
 *   post:
 *     summary: Send OTP to authenticated email address
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Email OTP sent }
 */
userRoute.post("/send-email-otp", authenticateUser, sendEmailOTP);

/**
 * @swagger
 * /users/verify-email-otp:
 *   post:
 *     summary: Verify email OTP
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Email verified }
 */
userRoute.post("/verify-email-otp", authenticateUser, verifyEmailOTP);

// Dynamic routes with :userId parameter
userRoute.get("/:userId", authenticateUser, getUserById);
userRoute.put("/:userId/profile", authenticateUser, fileUploader([{ name: "profileImage", maxCount: 1 }], "User"), updateUserProfile);
userRoute.put("/:userId/change-password", authenticateUser, changePassword);

module.exports = userRoute;