const helmet = require('helmet');
const hpp = require('hpp');

/**
 * Security Configuration
 * Centralized security settings for the application
 */

/**
 * Helmet configuration for security headers
 */
const helmetConfig = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'http://online.swagger.io'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },

  // Cross-Origin settings
  crossOriginEmbedderPolicy: false, // Allow embedding for course videos
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // DNS Prefetch Control
  dnsPrefetchControl: { allow: false },

  // Frameguard - prevent clickjacking
  frameguard: { action: 'deny' },

  // Hide X-Powered-By header
  hidePoweredBy: true,

  // HSTS - Force HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },

  // IE No Open
  ieNoOpen: true,

  // No Sniff - prevent MIME type sniffing
  noSniff: true,

  // Origin Agent Cluster
  originAgentCluster: true,

  // Permitted Cross-Domain Policies
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },

  // Referrer Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // XSS Filter
  xssFilter: true
});

/**
 * HPP (HTTP Parameter Pollution) configuration
 * Prevents parameter pollution attacks
 */
const hppConfig = hpp({
  whitelist: [
    'tags',
    'category',
    'level',
    'sort',
    'fields',
    'page',
    'limit'
  ]
});

/**
 * CORS configuration based on environment
 */
const getCorsConfig = () => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:4200',
    'http://localhost:5173',
    'https://ceekulmission.surajexpo.com',

  ];

  // Add production origins
  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  return {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`Blocked CORS request from: ${origin}`);
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-ID',
      'Accept',
      'Origin',
      'X-Skip-Error-Toast'
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 200
  };
};

/**
 * Request size limits
 */
const requestLimits = {
  json: '1mb',
  urlencoded: '1mb',
  raw: '5mb', // For file uploads
  text: '100kb'
};

/**
 * Session configuration
 */
const getSessionConfig = () => ({
  secret: process.env.SESSION_SECRET,
  name: 'sessionId', // Don't use default 'connect.sid'
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict',
    domain: process.env.COOKIE_DOMAIN || undefined
  }
});

/**
 * Trusted proxy configuration
 * Important for rate limiting when behind reverse proxy (Heroku, Render, Nginx, etc.)
 */
const trustProxyConfig = process.env.TRUST_PROXY === 'true' || 
                        process.env.NODE_ENV === 'production' || 
                        process.env.RENDER === 'true' ? 1 : false;

/**
 * Security headers middleware
 */
const securityHeaders = (req, res, next) => {
  // Remove server fingerprinting
  res.removeHeader('X-Powered-By');

  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Cache control for API responses
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
};

/**
 * Error sanitization - don't leak sensitive info
 */
const sanitizeError = (error) => {
  // In production, don't expose internal error details
  if (process.env.NODE_ENV === 'production') {
    return {
      message: 'An error occurred',
      code: error.code || 'INTERNAL_ERROR'
    };
  }

  return {
    message: error.message,
    code: error.code,
    stack: error.stack
  };
};

module.exports = {
  helmetConfig,
  hppConfig,
  getCorsConfig,
  requestLimits,
  getSessionConfig,
  trustProxyConfig,
  securityHeaders,
  sanitizeError
};
