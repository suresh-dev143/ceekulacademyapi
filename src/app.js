const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const session = require('express-session');
const passport = require('./config/passport.js');
const appRoutes = require("./routers");
const { Admin } = require("./models/authModels");

// Security imports
const {
  helmetConfig,
  hppConfig,
  getCorsConfig,
  requestLimits,
  getSessionConfig,
  trustProxyConfig,
  securityHeaders,
  apiLimiter,
  authLimiter,
  otpLimiter,
  aiLimiter,
  sanitizeBody,
  sanitizeQuery,
  requestTracker,
  refreshTokenHandler,
  logoutHandler
} = require('./security');

const app = express();

// ==================== TRUST PROXY (for rate limiting behind reverse proxy) ====================
if (trustProxyConfig) {
  app.set('trust proxy', trustProxyConfig);
}

// ==================== SECURITY HEADERS ====================
app.use(helmetConfig);
app.use(securityHeaders);

// ==================== REQUEST PARSING ====================
app.use(express.urlencoded({ extended: true, limit: requestLimits.urlencoded }));
app.use(express.json({ limit: requestLimits.json }));
app.use(express.raw({ limit: requestLimits.raw }));

// ==================== CORS ====================
app.use(cors(getCorsConfig()));

// ==================== SECURITY MIDDLEWARE ====================
// HTTP Parameter Pollution protection
app.use(hppConfig);

// Custom input sanitization
app.use(sanitizeBody);
app.use(sanitizeQuery);

// Request tracking for audit logs
app.use(requestTracker);

// ==================== RATE LIMITING ====================
// Apply general API rate limiter
app.use('/api', apiLimiter);

// AI-calling endpoints: tighter limit (20/15min) to protect Anthropic API budget
app.use('/api/commit', aiLimiter);
app.use('/api/architecture/query', aiLimiter);

// Stricter limits for auth endpoints
app.use('/users/login', authLimiter);
app.use('/users/signup', authLimiter);
app.use('/admin/login', authLimiter);

// Very strict limits for OTP
app.use('/users/sendOTP', otpLimiter);
app.use('/users/verifyOTP', otpLimiter);

// ==================== LOGGING ====================
// Custom morgan format for security logging
const morganFormat = process.env.NODE_ENV === 'production'
  ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms'
  : 'dev';

app.use(morgan(morganFormat, {
  skip: (req) => {
    // Skip health check logs
    return req.path === '/health' || req.path === '/api/ping';
  }
}));

// ==================== SESSION ====================
app.use(session(getSessionConfig()));

// ==================== PASSPORT ====================
app.use(passport.initialize());
app.use(passport.session());

// ==================== TOKEN MANAGEMENT ROUTES ====================
// Refresh token endpoint
app.post('/api/auth/refresh', refreshTokenHandler);

// Logout endpoint
app.post('/api/auth/logout', logoutHandler);

// ==================== SWAGGER UI ====================
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger.js');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// ==================== APPLICATION ROUTES ====================
appRoutes(app);

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = DB_STATES[mongoose.connection.readyState] || 'unknown';
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    db: { state: dbState, name: mongoose.connection.name || null },
  });
});

// ==================== GLOBAL ERROR HANDLER ====================
app.use((err, req, res, next) => {
  // Log error for debugging
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    ip: req.ip,
    requestId: req.requestId
  });

  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      status: false,
      message: 'CORS policy violation'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: false,
      message: 'Token expired',
      code: 'TOKEN_EXPIRED'
    });
  }

  // Validation errors (Mongoose or others)
  if (err.name === 'ValidationError') {
    let message = err.message;
    
    // Specifically handle Mongoose validation errors which have an 'errors' object
    if (err.errors && typeof err.errors === 'object') {
      message = Object.values(err.errors).map(e => e.message).join(', ');
    }
    
    return res.status(400).json({
      status: false,
      message: message
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      status: false,
      message: `${field} already exists`
    });
  }

  // Rate limit errors
  if (err.status === 429) {
    return res.status(429).json({
      status: false,
      message: 'Too many requests, please try again later'
    });
  }

  // Default error response
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    status: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An error occurred'
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==================== ADMIN SETUP ====================
async function createDefaultAdmin() {
  try {
    const count = await Admin.countDocuments();
    if (count === 0) {
      const admin = new Admin({
        name: process.env.DEFAULT_ADMIN_NAME || "Admin",
        email: process.env.DEFAULT_ADMIN_EMAIL || "admin@example.com",
        number: process.env.DEFAULT_ADMIN_NUMBER || "0000000000",
        password: process.env.DEFAULT_ADMIN_PASSWORD || "ChangeMe@123!",
        role: "superadmin",
      });
      await admin.save();
      console.log("⚠️  Default admin created. CHANGE THE PASSWORD IMMEDIATELY!");
    }
  } catch (error) {
    console.error("Error creating default admin:", error.message);
  }
}

// Initialize admin on startup
createDefaultAdmin();

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Performing graceful shutdown...');
  // Close database connections, etc.
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Performing graceful shutdown...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
