const userRoute = require("express").Router();
const { updateUserProfile, updateProfile, sendOTP, verifyOTP, login, getUserById, getAllUsers, changePassword, applyTeacher, sendEmailOTP, verifyEmailOTP, ceebrainRegister, generateCeebrainId } = require("../controllers/userController");
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


/**
 * @swagger
 * /users/ceebrain-register:
 *   post:
 *     summary: Register a new user via Ceebrain ID flow (mobile + password)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobileNo, password, ceebrainId, agreeToFramework]
 *             properties:
 *               mobileNo: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               placeOfBirth: { type: string }
 *               identity: { type: string, enum: [homo_sapiens, others] }
 *               gender: { type: string, enum: [male, female, transgender] }
 *               bplCategory: { type: string, enum: [yes, no] }
 *               underprivilegedCategory: { type: string, enum: [yes, no] }
 *               password: { type: string }
 *               ceebrainId: { type: string }
 *               agreeToFramework: { type: boolean }
 *     responses:
 *       201: { description: User registered successfully }
 */
userRoute.post("/ceebrain-register", ceebrainRegister);

/**
 * @swagger
 * /users/ceebrain-id:
 *   get:
 *     summary: Generate a unique Ceebrain ID
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: A unique 12-digit Ceebrain ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean }
 *                 ceebrainId: { type: string }
 */
userRoute.get("/ceebrain-id", generateCeebrainId);

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