'use strict';

/**
 * MQTT Ingestion Adapter — Protocol Bridge for Constrained Devices
 *
 * Bridges MQTT-speaking devices (IoT sensors, wearables, industrial machines,
 * edge nodes) to the UCE write pipeline. MQTT is the dominant protocol for
 * low-power, bandwidth-constrained, and machine-to-machine environments.
 *
 * Activation: only starts when MQTT_BROKER_URL is set in environment.
 * Dependency:  requires the 'mqtt' npm package → run: npm install mqtt
 *
 * Topic conventions:
 *   Device → Server (ingest):
 *     ceekul/ingest/{contentType}
 *     Payload (JSON): { token, payload, parentCid?, correlationId? }
 *
 *   Server → Device (response):
 *     ceekul/ingest/{contentType}/result/{correlationId}
 *     Payload (JSON): { cid, version, status, fromDedupe } | { error, code }
 *
 * QoS 1 is used for delivery guarantees. Retained messages are not used
 * since the UCE outbox already handles persistence.
 *
 * Example device publish (MQTT client):
 *   topic:   ceekul/ingest/lecture
 *   payload: { "token":"<JWT>", "correlationId":"r1", "payload":{ ... } }
 */

const jwt       = require('jsonwebtoken');
const { User }  = require('../models/authModels');
const commitSvc = require('./universalCommitService');
const { CONTENT_TYPES } = require('./normalizerService');

const TOPIC_PREFIX  = 'ceekul/ingest';
const SUBSCRIBE_QOS = 1;

// ── Token resolution (same logic as ucrsVerify) ───────────────────────────────

async function resolveToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user    = await User.findById(decoded.id).select('_id status').lean();
    if (!user || user.status === 'Inactive' || user.status === 'Suspended') return null;
    return user;
  } catch {
    return null;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.log('[MQTTAdapter] MQTT_BROKER_URL not set — adapter disabled');
    return;
  }

  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch {
    console.warn('[MQTTAdapter] mqtt package not installed. Run: npm install mqtt');
    return;
  }

  const client = mqtt.connect(brokerUrl, {
    clientId:      `ceekul-server-${process.pid}`,
    clean:         true,
    reconnectPeriod: 5_000,
    connectTimeout:  10_000,
  });

  client.on('connect', () => {
    const topic = `${TOPIC_PREFIX}/+`;
    client.subscribe(topic, { qos: SUBSCRIBE_QOS }, (err) => {
      if (err) {
        console.error('[MQTTAdapter] Subscribe error:', err.message);
      } else {
        console.log(`[MQTTAdapter] Subscribed to ${topic} on ${brokerUrl}`);
      }
    });
  });

  client.on('message', async (topic, buffer) => {
    // Extract contentType from topic: ceekul/ingest/{contentType}
    const parts       = topic.split('/');
    const contentType = parts[2];

    if (!contentType || !CONTENT_TYPES.includes(contentType)) {
      console.warn(`[MQTTAdapter] Unknown contentType in topic: ${topic}`);
      return;
    }

    let data;
    try {
      data = JSON.parse(buffer.toString());
    } catch {
      console.warn(`[MQTTAdapter] Malformed JSON on topic ${topic}`);
      return;
    }

    const { token, payload, parentCid, correlationId } = data;

    const user = await resolveToken(token).catch(() => null);
    if (!user) {
      _respond(client, contentType, correlationId, {
        error: 'Authentication failed', code: 'UNAUTHORIZED',
      });
      return;
    }

    try {
      const result = await commitSvc.commit({
        source:    'device-mqtt',
        contentType,
        payload,
        ownerId:   user._id,
        parentCid: parentCid || null,
        traceId:   correlationId || null,
      });
      _respond(client, contentType, correlationId, result);
    } catch (err) {
      _respond(client, contentType, correlationId, {
        error: err.message,
        code:  err.status === 403 ? 'CAPABILITY_DENIED'
             : err.status === 422 ? 'CONTENT_BLOCKED'
             : err.status === 400 ? 'INVALID_INPUT'
             : 'INTERNAL_ERROR',
      });
    }
  });

  client.on('error',       (err) => console.error('[MQTTAdapter] Error:', err.message));
  client.on('reconnect',   ()    => console.log('[MQTTAdapter] Reconnecting…'));
  client.on('offline',     ()    => console.warn('[MQTTAdapter] Broker offline'));
}

function _respond(client, contentType, correlationId, data) {
  if (!correlationId) return; // fire-and-forget device — no response expected
  const responseTopic = `${TOPIC_PREFIX}/${contentType}/result/${correlationId}`;
  client.publish(responseTopic, JSON.stringify(data), { qos: SUBSCRIBE_QOS });
}

module.exports = { start };
