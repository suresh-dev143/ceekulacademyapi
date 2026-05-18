const express = require('express');
const unspecifiedRoutesHandler = require('./unspecified.route');
const { finalErrorHandler } = require('../errorHandler');
const userRoute = require('./user.route.js');
const adminRoute = require('./admin.route.js');
const router = require('./auth.route.js');
const teacherRoute = require('./teacher.route.js');
const courseRoute = require('./course.route.js');
const workshopRoute = require('./workshop.route.js');
const partnerInfrastructureRoute = require('./partnerInfrastructure.routes.js');
const nearbyRoute = require('./nearbyRouter');

// ==================== AD PLATFORM ROUTES ====================
const advertiserRoute = require('./advertiser.route.js');
const lectureRoute = require('./lecture.route.js');
const walletRoute = require('./wallet.route.js');
const adRoute = require('./ad.route.js');
const settlementRoute = require('./settlement.route.js');
const pageRoute = require('./page.route.js');

// ==================== SCHEDULER + LIVE EDIT + CHAT ROUTES ====================
const schedulerRoute = require('./scheduler.route.js');
const liveEditRoute = require('./liveEdit.route.js');
const chatRoute = require('./chat.route.js');

// ==================== AI / ADAPTIVE CONTENT ROUTES ====================
const claudeRoute = require('./claude.route.js');
const digitalTwinRoute = require('./digitalTwin.route.js');
const innovationRoute = require('./innovation.route.js');
const contentRoute = require('./content.route.js');

// ==================== ADAPTIVE ENGINE ROUTES ====================
const adaptiveStateRoute = require('./adaptiveState.route.js');
const contentAtomRoute = require('./contentAtom.route.js');
const adaptiveEngineRoute = require('./adaptiveEngine.route.js');
const researchPipelineRoute = require('./researchPipeline.route.js');

// ==================== CONTENT VALIDATION ====================
const contentValidationRoute = require('./contentValidation.route.js');

// ==================== SUCCESS STORIES ====================
const successStoryRoute = require('./successStory.route.js');

// ==================== MY ACTIVITIES ====================
const myActivitiesRoute = require('./myActivities.route.js');

// ==================== UNIVERSAL DISCUSSION CHAT ====================
const discussionRoute = require('./discussion.route.js');

// ==================== SUPPLY / OFFER ====================
const supplyRoute = require('./supply.route.js');

// ==================== CREATE CONTENT (MEMBER CREATOR) ====================
const creatorRoute = require('./creator.route.js');

// ==================== NEURON PARTICIPATION ECOSYSTEM ====================
const neuronRoute = require('./neuron.route.js');
const ceegroupRoute = require('./ceegroup.route.js');
const paymentRoute = require('./payment.route.js');
const atomicRoute = require('./atomic.route.js');

const appRoutes = (app) => {
  app.get('/api/ping', (_, res) =>
    res.status(200).json({ status: true, message: 'Ping Successfully.', timestamp: new Date() })
  );
  app.use('/public', express.static('public'));

  // User routes
  app.use('/users', userRoute);

  // Admin routes
  app.use('/admin', adminRoute);

  // Teacher routes (course management)
  app.use('/api/teacher', teacherRoute);

  // Public course routes
  app.use('/api/courses', courseRoute);

  // Workshop routes
  app.use('/api/v1/workshops', workshopRoute);

  // Partner Infrastructure routes
  app.use('/api/partners/infrastructure', partnerInfrastructureRoute);

  // Nearby routes
  app.use('/api/nearby', nearbyRoute);

  // Auth routes (Google OAuth, etc.)
  app.use('/api', router);

  // ==================== AD PLATFORM ====================
  // Advertiser: upload ads, set budget/rate, analytics
  app.use('/api/advertiser', advertiserRoute);

  // Lectures: create, go-live, watch with SSAI
  app.use('/api/lectures', lectureRoute);

  // Neuron Wallet: balance, transactions, earnings
  app.use('/api/wallet', walletRoute);

  // Ad matching, impressions, preferences, pricing
  app.use('/api/ads', adRoute);

  // Monthly settlements + Razorpay webhooks
  app.use('/api/settlements', settlementRoute);

  // Pages — ad-control units linking sessions to criteria + control modes
  app.use('/api/pages', pageRoute);

  // ==================== SCHEDULER ====================
  app.use('/api/scheduler', schedulerRoute);

  // ==================== LIVE EDITOR ====================
  // REST bootstrap for the collaborative editing session
  app.use('/api/live-edit', liveEditRoute);

  // ==================== LIVE CHAT ====================
  // REST: history, summary, stats (real-time via /chat Socket.io namespace)
  app.use('/api/chat', chatRoute);

  // ==================== AI / ADAPTIVE CONTENT ====================
  // Claude agents: co-teacher chat, contextual ad copy
  app.use('/api/claude', claudeRoute);

  // Workspace AI co-pilot: context-aware assistant for the multi-panel workspace
  app.use('/api/ai', require('./aiAssist.route'));

  // Digital twin: learner skill graph, cognitive profile, AI summary
  app.use('/api/digital-twin', digitalTwinRoute);

  // Innovation pipeline: idea → deployed, Claude coaching
  app.use('/api/innovations', innovationRoute);

  // Living content: version control, research integration, depth layers
  app.use('/api/content', contentRoute);

  // ==================== ADAPTIVE ENGINE ====================
  // Real-time cognitive state tracking + signals
  app.use('/api/adaptive/state', adaptiveStateRoute);
  // Content atom CRUD + engagement metrics
  app.use('/api/adaptive/atoms', contentAtomRoute);
  // Mode decisions + next-atom recommendations
  app.use('/api/adaptive/engine', adaptiveEngineRoute);
  // Research ingestion + AI enrichment pipeline
  app.use('/api/adaptive/research', researchPipelineRoute);

  // ==================== CONTENT VALIDATION ====================
  app.use('/api/validate', contentValidationRoute);

  // ==================== SUCCESS STORIES ====================
  app.use('/api/stories', successStoryRoute);

  // ==================== MY ACTIVITIES ====================
  app.use('/api/my-activities', myActivitiesRoute);

  // ==================== UNIVERSAL DISCUSSION CHAT ====================
  app.use('/api/discussion', discussionRoute);

  // ==================== SUPPLY / OFFER ====================
  app.use('/api/supply', supplyRoute);

  // ==================== CREATE CONTENT (MEMBER CREATOR) ====================
  // Draft → Share → Publish lifecycle with Hybrid ID system
  app.use('/api/creator', creatorRoute);

  // ==================== NEURON PARTICIPATION ECOSYSTEM ====================
  // Non-monetary participation units: FUN / CUN / SUN / My Neurons
  // Portal NEVER handles money — all money flows via external entity escrows
  app.use('/api/neurons', neuronRoute);

  // ==================== WELFARE SYSTEM (CG100000000000) ====================
  // Global need-first welfare: FUN (basic), CUN (learning), SUN (emergency)
  // Priority set by Executive Council; disbursement after provider confirms
  const welfareRoute = require('./welfare.route.js');
  app.use('/api/welfare', welfareRoute);
  // CEEGROUP: collective entities with 15-digit IDs, shared neuron buckets
  app.use('/api/ceegroups', ceegroupRoute);
  // Payment: Cramib-initiated sessions + Razorpay verification + neuron credit
  app.use('/api/payment', paymentRoute);
  
  // ==================== ATOMIC CONTENT SYSTEM ====================
  // Save Engine + Evolution Engine + Atomic ID
  app.use('/api/atomic', atomicRoute);

  // ==================== SESSION LIFECYCLE ====================
  // Live session CID commits: start → micro (30s) → end + AI summary
  const sessionRoute = require('./session.route.js');
  app.use('/api/sessions', sessionRoute);

  // ==================== CID-BASED AD DELIVERY SYSTEM ====================
  // O(1) delivery: GET /api/ads/delivery/:sessionKey
  // Pre-scheduler:  POST /api/ads/precompute
  // Inverted index: GET|POST /api/ads/index
  const adDeliveryRoute = require('./adDelivery.route.js');
  app.use('/api/ads', adDeliveryRoute);

  // ==================== UNIVERSAL COMMIT & REFERENCE SYSTEM (UCRS) ====================
  // Single write path: POST /api/commit
  // Content resolution: GET /api/commit/content/:cid[/v/:version]
  // Version history:    GET /api/commit/history/:logicalId
  // Batch resolve:      POST /api/commit/resolve-many
  // Full-text search:   GET /api/commit/search
  const commitRoute = require('./commit.route.js');
  app.use('/api/commit', commitRoute);

  // ==================== UCRS INTERACTION COMMITS ====================
  // Session-scoped semantic commits: chat, stream, annotations
  const ucrsRoute = require('./ucrs.route.js');
  app.use('/api/ucrs', ucrsRoute);

  // ==================== UCRS SCHEDULE ENGINE ====================
  // CP-entity schedules: create, search, cancel
  const scheduleRoute = require('./schedule.route.js');
  app.use('/api/schedules', scheduleRoute);

  // ==================== UCRS ENROLMENT ENGINE ====================
  // Enrolment = policy tuple + display record; O(1) via Redis
  const enrolmentRoute = require('./enrolment.route.js');
  app.use('/api/enrolments', enrolmentRoute);

  // ==================== UCRS COGNITIVE SERVICE FABRIC (ADMIN) ====================
  // Identity (public keys), Capabilities, Policy Graph, Service Registry, Ledger
  const ucrsAdminRoute = require('./ucrsAdmin.route.js');
  app.use('/api/ucrs-admin', ucrsAdminRoute);

  // ==================== ARCHITECTURE KNOWLEDGE BASE ====================
  // Specs: POST/GET /api/architecture/spec(s)
  // Queries: POST /api/architecture/query  (O(1) cache after first Opus call)
  // Responses: GET /api/architecture/response/:queryCid
  const architectureKbRoute = require('./architectureKb.route.js');
  app.use('/api/architecture', architectureKbRoute);

  // ==================== EVOLVING SCREEN ====================
  // Adaptive UI state: init, instruction, history — WebSocket at /screen namespace
  const screenRoute = require('./screen.route.js');
  app.use('/api/screen', screenRoute);

  // ==================== UCRS SEMANTIC GRAPH (Phase 4) ====================
  // Read-only intelligence layer: program trees, reuse maps, impact analysis
  // GET /api/graph/program, /content/:cid/reuse, /content/:cid/impact, /instructor/:id, /consistency
  const semanticGraphRoute = require('./semanticGraph.route.js');
  app.use('/api/graph', semanticGraphRoute);

  // ==================== EVENT SYSTEM (Phase 5) ====================
  // Replay, outbox observability, self-healing admin
  // GET /api/events/replay/:entityId, /replay/cid/:cid, /outbox/stats, /health
  // POST /api/events/heal
  const eventsRoute = require('./events.route.js');
  app.use('/api/events', eventsRoute);

  // ==================== WORKFLOW ENGINE (Phase 6) ====================
  // Semantic orchestration + temporary compute: stats, list, trigger, purge
  // GET /api/workflows/stats, GET /api/workflows, GET /api/workflows/:id
  // POST /api/workflows/trigger, DELETE /api/workflows/failed
  const workflowRoute = require('./workflow.route.js');
  app.use('/api/workflows', workflowRoute);

  // ==================== GRAPH ANALYTICS + SUBSCRIPTIONS (Phase 7) ====================
  // Analytics: programs, content reuse, instructor reach, velocity, drift, vitality, audit
  // Subscriptions: POST/GET/DELETE /api/analytics/subscriptions
  const analyticsRoute = require('./analytics.route.js');
  app.use('/api/analytics', analyticsRoute);

  // ==================== HOME FEED (Pre-Homepage) ====================
  // Aggregated feed: enrolled, discovery, trending, notifications, need signals
  // GET /api/home/feed     — full homepage payload (one call)
  // GET /api/home/discovery — paginated discovery with cinematic metadata
  const homeRoute = require('./home.route.js');
  app.use('/api/home', homeRoute);

  // ==================== USER EXPERIENCE PROFILE ====================
  // Persistent rendering preferences + device capability registration
  // GET/PUT  /api/me/experience       — animation level, XR interest, color scheme
  // POST     /api/me/device           — register device capabilities (on app launch)
  // POST     /api/me/experience/onboarding — track onboarding progress
  const experienceProfileRoute = require('./experienceProfile.route.js');
  app.use('/api/me', experienceProfileRoute);

  // Error handling
  app.use(unspecifiedRoutesHandler);
  app.use(finalErrorHandler);
};

module.exports = appRoutes;

