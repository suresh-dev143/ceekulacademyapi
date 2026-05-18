// Rate Limiting
const {
  apiLimiter,
  authLimiter,
  otpLimiter,
  passwordResetLimiter,
  courseCreationLimiter,
  uploadLimiter,
  searchLimiter,
  aiLimiter,
} = require('./rateLimiter');

// Input Sanitization
const {
  sanitizeBody,
  sanitizeQuery,
  sanitizeParams,
  sanitizeObject,
  sanitizeValue,
  validationHelpers,
  checkForDangerousPatterns
} = require('./inputSanitizer');

// Token Management
const {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  revokeToken,
  revokeAllUserTokens,
  extractTokenFromHeader,
  authenticateToken,
  refreshTokenHandler,
  logoutHandler,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY
} = require('./tokenManager');

// Audit Logging
const {
  AuditLog,
  AuditLogger,
  requestTracker
} = require('./auditLogger');

// Security Configuration
const {
  helmetConfig,
  hppConfig,
  getCorsConfig,
  requestLimits,
  getSessionConfig,
  trustProxyConfig,
  securityHeaders,
  sanitizeError
} = require('./securityConfig');

module.exports = {
  // Rate Limiters
  apiLimiter,
  authLimiter,
  otpLimiter,
  passwordResetLimiter,
  courseCreationLimiter,
  uploadLimiter,
  searchLimiter,
  aiLimiter,

  // Input Sanitization
  sanitizeBody,
  sanitizeQuery,
  sanitizeParams,
  sanitizeObject,
  sanitizeValue,
  validationHelpers,
  checkForDangerousPatterns,

  // Token Management
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  revokeToken,
  revokeAllUserTokens,
  extractTokenFromHeader,
  authenticateToken,
  refreshTokenHandler,
  logoutHandler,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,

  // Audit Logging
  AuditLog,
  AuditLogger,
  requestTracker,

  // Security Configuration
  helmetConfig,
  hppConfig,
  getCorsConfig,
  requestLimits,
  getSessionConfig,
  trustProxyConfig,
  securityHeaders,
  sanitizeError
};
