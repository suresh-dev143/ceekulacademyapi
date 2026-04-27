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
const schedulerRoute  = require('./scheduler.route.js');
const liveEditRoute   = require('./liveEdit.route.js');
const chatRoute       = require('./chat.route.js');

// ==================== AI / ADAPTIVE CONTENT ROUTES ====================
const claudeRoute      = require('./claude.route.js');
const digitalTwinRoute = require('./digitalTwin.route.js');
const innovationRoute  = require('./innovation.route.js');
const contentRoute     = require('./content.route.js');

// ==================== ADAPTIVE ENGINE ROUTES ====================
const adaptiveStateRoute    = require('./adaptiveState.route.js');
const contentAtomRoute      = require('./contentAtom.route.js');
const adaptiveEngineRoute   = require('./adaptiveEngine.route.js');
const researchPipelineRoute = require('./researchPipeline.route.js');

// ==================== CONTENT VALIDATION ====================
const contentValidationRoute = require('./contentValidation.route.js');

// ==================== SUCCESS STORIES ====================
const successStoryRoute = require('./successStory.route.js');

// ==================== MY ACTIVITIES ====================
const myActivitiesRoute = require('./myActivities.route.js');

// ==================== UNIVERSAL DISCUSSION CHAT ====================
const discussionRoute = require('./discussion.route.js');

// ==================== NEURON PARTICIPATION ECOSYSTEM ====================
const neuronRoute   = require('./neuron.route.js');
const ceegroupRoute = require('./ceegroup.route.js');
const paymentRoute  = require('./payment.route.js');

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

  // Digital twin: learner skill graph, cognitive profile, AI summary
  app.use('/api/digital-twin', digitalTwinRoute);

  // Innovation pipeline: idea → deployed, Claude coaching
  app.use('/api/innovations', innovationRoute);

  // Living content: version control, research integration, depth layers
  app.use('/api/content', contentRoute);

  // ==================== ADAPTIVE ENGINE ====================
  // Real-time cognitive state tracking + signals
  app.use('/api/adaptive/state',    adaptiveStateRoute);
  // Content atom CRUD + engagement metrics
  app.use('/api/adaptive/atoms',    contentAtomRoute);
  // Mode decisions + next-atom recommendations
  app.use('/api/adaptive/engine',   adaptiveEngineRoute);
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

  // ==================== NEURON PARTICIPATION ECOSYSTEM ====================
  // Non-monetary participation units: FUN / CUN / SUN / My Neurons
  // Portal NEVER handles money — all money flows via external entity escrows
  app.use('/api/neurons',   neuronRoute);
  // CEEGROUP: collective entities with 15-digit IDs, shared neuron buckets
  app.use('/api/ceegroups', ceegroupRoute);
  // Payment: Cramib-initiated sessions + Razorpay verification + neuron credit
  app.use('/api/payment',   paymentRoute);

  // Error handling
  app.use(unspecifiedRoutesHandler);
  app.use(finalErrorHandler);
};

module.exports = appRoutes;

