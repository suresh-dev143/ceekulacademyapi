const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const http     = require('http');
const mongoose = require('mongoose');
const { connectToDatabase } = require('./connection');
const app      = require('./src/app.js');
const { initSocket }            = require('./src/socket');
const { initLiveEditService }   = require('./src/services/liveEditService');
const { initChatService }       = require('./src/services/chatService');
const { initAdaptiveService }    = require('./src/services/adaptiveSocketService');
const { initDiscussionService }  = require('./src/services/discussionService');
const { bootstrap: ucrsBootstrap }         = require('./src/services/ucrsServiceRegistryService');
const { start: startOutboxWorker }                           = require('./src/services/outboxWorkerService');
const { start: startUcrsDispatcher }                         = require('./src/services/ucrsEventDispatcherService');
const { runFullHeal }                                        = require('./src/services/selfHealingService');
const { start: startWorkflowEngine }                         = require('./src/services/workflowEngineService');
const { consumeStream, EVENT_TYPES }                         = require('./src/services/eventService');
const { cleanupOrphanedRegistryEntries }                     = require('./src/services/universalCommitService');
const { initDeviceIngestion }              = require('./src/services/deviceIngestionService');
const { start: startMqttAdapter }          = require('./src/services/mqttIngestionAdapter');
const { initScreenService }                = require('./src/services/screenSocketService');
const PORT     = process.env.PORT || 1003;
const BASE_URL = `http://localhost:${PORT || 1003}`;

(async () => {
  try {
    console.log('Initializing server');
    await connectToDatabase();

    // Wrap Express app in an HTTP server so Socket.io can share the same port
    const httpServer = http.createServer(app);
    initSocket(httpServer);
    initLiveEditService();   // attach /editor namespace event handlers
    initChatService();       // attach /chat namespace event handlers
    initAdaptiveService();    // attach /adaptive namespace event handlers
    initDiscussionService();  // attach /discussion namespace event handlers

    // UCRS: auto-provision service registry on every startup
    await ucrsBootstrap();

    // UCE Orphan cleanup: remove registry entries whose content write never completed
    cleanupOrphanedRegistryEntries()
      .then(r => { if (r.cleaned > 0) console.log(`[UCE] Cleaned ${r.cleaned} orphaned registry entries`); })
      .catch(err => console.error('[UCE] Orphan cleanup failed:', err.message));

    // UCE Outbox: drain pending events to Redis Streams
    startOutboxWorker();

    // UCRS Event Dispatcher: drain schedule/enrolment outbox to Redis Streams
    startUcrsDispatcher();

    // Workflow Engine: semantic orchestration + temporary compute modules (Phase 6)
    startWorkflowEngine();

    // Self-healing: run on startup then every 10 minutes
    runFullHeal()
      .then(r => { if (r.stuckOutboxRecovery.ucrsReset + r.stuckOutboxRecovery.uceReset + r.commitBridgeRepair.repaired > 0) console.log('[SelfHealer] Startup heal:', r); })
      .catch(err => console.error('[SelfHealer] Startup heal failed:', err.message));
    setInterval(() => runFullHeal().catch(err => console.error('[SelfHealer] Periodic heal failed:', err.message)), 10 * 60 * 1000);

    // Register the CONTENT_COMMITTED consumer group so the stream is actually read.
    // Without this the outbox worker writes to the stream but nothing consumes it.
    consumeStream(
      `stream:${EVENT_TYPES.CONTENT_COMMITTED}`,
      'ucrs-processor',
      'worker-1',
      async (event) => {
        // Extensible handler: add downstream reactions here as new capabilities come online.
        // e.g. search indexing, notification fanout, AI enrichment queuing.
        const { cid, contentType, logicalId, fromDedupe } = event.payload || {};
        if (!fromDedupe) {
          console.log(`[ContentCommitted] cid=${cid} type=${contentType} logicalId=${logicalId}`);
        }
      }
    ).catch((err) => console.error('[index] consumeStream registration failed:', err.message));

    // Device ingestion: WebSocket /ingest namespace (must be after initSocket)
    initDeviceIngestion();

    // MQTT bridge: activates only when MQTT_BROKER_URL is set
    await startMqttAdapter();

    // Evolving Screen: /screen WebSocket namespace
    initScreenService();

    httpServer.listen(PORT, () => console.log(`Server is running on ${BASE_URL}`));
    httpServer.on('error', shutdown);
  } catch (error) {
    shutdown(error);
  }
})();

async function shutdown(err) {
  console.log('Unable to initialize the server:', err.message);
  await mongoose.connection.close();
  process.exit(1);
}
