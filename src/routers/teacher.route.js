const teacherRoute = require("express").Router();
const {
  createCourse,
  updateCourse,
  updateSyllabus,
  getCourseForTeacher,
  getTeacherCourses,
  deleteCourse,
  archiveCourse,
  restoreCourse,
  submitForReview,
  publishCourse,
  unpublishCourse,
  withdrawFromReview,
  cloneCourse,
} = require("../controllers/courseController");
const {
  authenticateTeacher,
  verifyCourseOwnership,
  verifyCourseEditable,
  fileUploader,
} = require("../middlewares");

// ==================== COURSE MANAGEMENT ====================

/**
 * @route   POST /api/teacher/courses
 * @desc    Create a new course
 * @access  Teacher (verified)
 */
/**
 * @swagger
 * /api/teacher/courses:
 *   post:
 *     summary: Create a new course
 *     tags: [Teacher]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Course created }
 *   get:
 *     summary: Get all courses for the logged-in teacher
 *     tags: [Teacher]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of courses }
 */
teacherRoute.post("/courses", authenticateTeacher, createCourse);
teacherRoute.get("/courses", authenticateTeacher, getTeacherCourses);

/**
 * @swagger
 * /api/teacher/courses/{id}:
 *   get:
 *     summary: Get course details
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course details }
 *   put:
 *     summary: Update course details
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course updated }
 *   delete:
 *     summary: Delete a course
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course deleted }
 */
teacherRoute.get(
  "/courses/:id",
  authenticateTeacher,
  verifyCourseOwnership,
  getCourseForTeacher,
);
teacherRoute.put(
  "/courses/:id",
  authenticateTeacher,
  verifyCourseOwnership,
  verifyCourseEditable,
  updateCourse,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/syllabus:
 *   put:
 *     summary: Update course syllabus
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Syllabus updated }
 */
teacherRoute.put(
  "/courses/:id/syllabus",
  authenticateTeacher,
  verifyCourseOwnership,
  verifyCourseEditable,
  updateSyllabus,
);

teacherRoute.delete(
  "/courses/:id",
  authenticateTeacher,
  verifyCourseOwnership,
  deleteCourse,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/submit:
 *   post:
 *     summary: Submit course for review
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course submitted }
 */
teacherRoute.post(
  "/courses/:id/submit",
  authenticateTeacher,
  verifyCourseOwnership,
  submitForReview,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/withdraw:
 *   post:
 *     summary: Withdraw course from review
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course withdrawn }
 */
teacherRoute.post(
  "/courses/:id/withdraw",
  authenticateTeacher,
  verifyCourseOwnership,
  withdrawFromReview,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/publish:
 *   post:
 *     summary: Publish an approved course
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course published }
 */
teacherRoute.post(
  "/courses/:id/publish",
  authenticateTeacher,
  verifyCourseOwnership,
  publishCourse,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/unpublish:
 *   post:
 *     summary: Unpublish a course
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course unpublished }
 */
teacherRoute.post(
  "/courses/:id/unpublish",
  authenticateTeacher,
  verifyCourseOwnership,
  unpublishCourse,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/archive:
 *   post:
 *     summary: Archive a course
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course archived }
 */
teacherRoute.post(
  "/courses/:id/archive",
  authenticateTeacher,
  verifyCourseOwnership,
  archiveCourse,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/restore:
 *   post:
 *     summary: Restore an archived course
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course restored }
 */
teacherRoute.post(
  "/courses/:id/restore",
  authenticateTeacher,
  verifyCourseOwnership,
  restoreCourse,
);

/**
 * @swagger
 * /api/teacher/courses/{id}/clone:
 *   post:
 *     summary: Clone a course
 *     tags: [Teacher]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Course cloned }
 */
teacherRoute.post(
  "/courses/:id/clone",
  authenticateTeacher,
  verifyCourseOwnership,
  cloneCourse,
);

// ==================== MEDIA UPLOAD ====================

/**
 * @route   POST /api/teacher/courses/:id/thumbnail
 * @desc    Upload course thumbnail
 * @access  Teacher (verified) - owner only
 */
teacherRoute.post(
  "/courses/:id/thumbnail",
  authenticateTeacher,
  verifyCourseOwnership,
  verifyCourseEditable,
  fileUploader([{ name: "thumbnail", maxCount: 1 }], "Courses/Thumbnails"),
  async (req, res) => {
    try {
      const course = req.course;

      if (!req.files || !req.files.thumbnail) {
        return res.status(400).json({
          status: false,
          message: "Thumbnail file is required",
        });
      }

      course.thumbnailUrl = `/public/Courses/Thumbnails/${req.files.thumbnail[0].filename}`;
      await course.save();

      return res.status(200).json({
        status: true,
        message: "Thumbnail uploaded successfully",
        thumbnailUrl: course.thumbnailUrl,
      });
    } catch (error) {
      console.error("Upload Thumbnail Error:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to upload thumbnail",
      });
    }
  },
);

/**
 * @route   POST /api/teacher/courses/:id/intro-video
 * @desc    Upload course intro video
 * @access  Teacher (verified) - owner only
 */
teacherRoute.post(
  "/courses/:id/intro-video",
  authenticateTeacher,
  verifyCourseOwnership,
  verifyCourseEditable,
  fileUploader([{ name: "video", maxCount: 1 }], "Courses/Videos"),
  async (req, res) => {
    try {
      const course = req.course;

      if (!req.files || !req.files.video) {
        return res.status(400).json({
          status: false,
          message: "Video file is required",
        });
      }

      course.introVideoUrl = `/public/Courses/Videos/${req.files.video[0].filename}`;
      await course.save();

      return res.status(200).json({
        status: true,
        message: "Intro video uploaded successfully",
        introVideoUrl: course.introVideoUrl,
      });
    } catch (error) {
      console.error("Upload Intro Video Error:", error);
      return res.status(500).json({
        status: false,
        message: "Failed to upload intro video",
      });
    }
  },
);

module.exports = teacherRoute;
