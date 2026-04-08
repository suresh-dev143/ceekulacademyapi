'use strict';

/**
 * Event-Driven Architecture
 *
 * Events:
 *   lecture_started, lecture_ended
 *   ad_play_started, ad_play_ended
 *   revenue_generated
 *   student_joined, student_left
 *   settlement_triggered
 *
 * Transport: Redis Streams (primary) | In-memory EventEmitter (fallback)
 * Can be swapped to Kafka/RabbitMQ via QUEUE_PROVIDER env var
 */

const EventEmitter = require('events');

// ==================== EVENT SCHEMAS ====================
const EVENT_TYPES = {
  LECTURE_STARTED: 'lecture_started',
  LECTURE_ENDED: 'lecture_ended',
  AD_PLAY_STARTED: 'ad_play_started',
  AD_PLAY_ENDED: 'ad_play_ended',
  REVENUE_GENERATED: 'revenue_generated',
  STUDENT_JOINED: 'student_joined',
  STUDENT_LEFT: 'student_left',
  SETTLEMENT_TRIGGERED: 'settlement_triggered',
  FRAUD_DETECTED: 'fraud_detected',
  AD_BUDGET_EXHAUSTED: 'ad_budget_exhausted'
};

// Internal emitter for same-process handlers
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

// Redis streams client
let streamsClient = null;
let subscriberClient = null;

async function initRedisStreams() {
  try {
    const redis = require('redis');
    streamsClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    subscriberClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await streamsClient.connect();
    await subscriberClient.connect();
    console.log('[EventService] Redis Streams connected');
  } catch {
    console.warn('[EventService] Redis Streams unavailable — using in-process EventEmitter');
    streamsClient = null;
    subscriberClient = null;
  }
}

// Initialize on module load
initRedisStreams().catch(() => {});

/**
 * Publish an event
 */
async function publishEvent(eventType, payload) {
  const event = {
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
    version: '1.0'
  };

  // 1. Emit locally (sync handlers)
  emitter.emit(eventType, event);
  emitter.emit('*', event); // Wildcard subscribers

  // 2. Redis Streams (async, durable)
  if (streamsClient) {
    try {
      const streamKey = `stream:${eventType}`;
      await streamsClient.xAdd(streamKey, '*', {
        data: JSON.stringify(event)
      });
      // Trim to last 10,000 events per stream
      await streamsClient.xTrimApprox(streamKey, 10000);
    } catch (err) {
      console.error('[EventService] Stream publish error:', err.message);
    }
  }

  return event;
}

/**
 * Subscribe to events (in-process)
 */
function subscribe(eventType, handler) {
  emitter.on(eventType, handler);
  return () => emitter.off(eventType, handler);
}

/**
 * Read from Redis Stream (consumer group pattern)
 */
async function consumeStream(streamKey, groupName, consumerName, handler) {
  if (!subscriberClient) {
    console.warn('[EventService] No Redis — stream consumption unavailable');
    return;
  }

  // Create consumer group if not exists
  try {
    await subscriberClient.xGroupCreate(streamKey, groupName, '0', { MKSTREAM: true });
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) throw err;
  }

  // Poll for messages
  const poll = async () => {
    try {
      const messages = await subscriberClient.xReadGroup(
        groupName,
        consumerName,
        [{ key: streamKey, id: '>' }],
        { COUNT: 100, BLOCK: 1000 }
      );

      if (messages) {
        for (const stream of messages) {
          for (const message of stream.messages) {
            try {
              const event = JSON.parse(message.message.data);
              await handler(event);
              await subscriberClient.xAck(streamKey, groupName, message.id);
            } catch (err) {
              console.error('[EventService] Message processing error:', err.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[EventService] Poll error:', err.message);
    }

    setTimeout(poll, 100);
  };

  poll();
}

// ==================== BUILT-IN EVENT HANDLERS ====================

// Handle ad play ended → update ad analytics
subscribe(EVENT_TYPES.AD_PLAY_ENDED, async (event) => {
  try {
    const Advertisement = require('../models/advertisementModel');
    await Advertisement.findByIdAndUpdate(event.payload.adId, {
      $inc: { totalImpressions: 1 }
    });
  } catch { /* non-critical */ }
});

// Handle lecture ended → trigger ad slot
subscribe(EVENT_TYPES.LECTURE_ENDED, async (event) => {
  try {
    const Lecture = require('../models/lectureModel');
    await Lecture.findByIdAndUpdate(event.payload.lectureId, {
      $set: { isLive: false, endedAt: new Date(), status: 'processing' }
    });
  } catch { /* non-critical */ }
});

module.exports = {
  publishEvent,
  subscribe,
  consumeStream,
  EVENT_TYPES
};
