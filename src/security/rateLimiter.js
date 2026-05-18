const rateLimit = require('express-rate-limit');

/**
 * Rate Limiting Configuration
 * Prevents brute force attacks and DDoS
 */

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    status: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for trusted IPs (internal services)
  skip: (req) => {
    const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
    return trustedIPs.includes(req.ip);
  }
});

// Strict limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    status: false,
    message: 'Too many login attempts, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

// OTP rate limiter - very strict
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 OTP requests per hour per IP
  message: {
    status: false,
    message: 'Too many OTP requests, please try again after 1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Password reset limiter
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: {
    status: false,
    message: 'Too many password reset attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Course creation limiter (prevent spam)
const courseCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 courses per hour
  message: {
    status: false,
    message: 'Course creation limit reached, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// File upload limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  message: {
    status: false,
    message: 'Upload limit reached, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Search/heavy operations limiter
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: {
    status: false,
    message: 'Too many search requests, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// AI-calling endpoint limiter — applied to POST /api/commit and POST /api/architecture/query.
// Each unique content or query triggers at least one Claude API call; this prevents budget exhaustion.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    status: false,
    message: 'AI request limit reached. Maximum 20 AI-powered requests per 15 minutes per IP.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
    return trustedIPs.includes(req.ip);
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  otpLimiter,
  passwordResetLimiter,
  courseCreationLimiter,
  uploadLimiter,
  searchLimiter,
  aiLimiter,
};
