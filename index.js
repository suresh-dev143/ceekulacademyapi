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

    // post script function should goes here before starting the server
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
