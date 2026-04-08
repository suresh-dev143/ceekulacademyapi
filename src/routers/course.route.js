const courseRoute = require('express').Router();
const {
  getCoursePublic,
  getPublishedCourses,
  getFeaturedCourses,
  getCoursesByCategory
} = require('../controllers/courseController');

// ==================== PUBLIC COURSE ROUTES ====================

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: Get all published courses
 *     tags: [Courses]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of published courses }
 */
courseRoute.get('/', getPublishedCourses);

/**
 * @swagger
 * /api/courses/featured:
 *   get:
 *     summary: Get featured courses
 *     tags: [Courses]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: List of featured courses }
 */
courseRoute.get('/featured', getFeaturedCourses);

/**
 * @swagger
 * /api/courses/category/{category}:
 *   get:
 *     summary: Get courses by category
 *     tags: [Courses]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of courses in category }
 */
courseRoute.get('/category/:category', getCoursesByCategory);

/**
 * @swagger
 * /api/courses/{idOrSlug}:
 *   get:
 *     summary: Get course by ID or slug
 *     tags: [Courses]
 *     parameters:
 *       - in: path
 *         name: idOrSlug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Course details }
 */
courseRoute.get('/:idOrSlug', getCoursePublic);

module.exports = courseRoute;
