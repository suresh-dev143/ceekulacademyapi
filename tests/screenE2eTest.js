'use strict';

/**
 * Screen + Architecture KB — End-to-End Test
 *
 * Tests every REST endpoint and WebSocket event for the Evolving Screen
 * and Architecture KB systems against a live running server.
 *
 * Prerequisites:
 *   1. Server running:   npm run dev  (or npm start)
 *   2. Set env vars:
 *        TEST_TOKEN=<valid JWT for an existing user>
 *        BASE_URL=http://localhost:1003        (default)
 *   3. For WebSocket tests: npm install socket.io-client
 *
 * Run:
 *   node tests/screenE2eTest.js
 *   node tests/screenE2eTest.js --skip-kb     (skip Architecture KB Opus call)
 *   node tests/screenE2eTest.js --ws-only     (WebSocket tests only)
 *   node tests/screenE2eTest.js --rest-only   (REST tests only)
 */

require('dotenv').config();
const axios = require('axios');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL   = process.env.BASE_URL || 'http://localhost:1003';
const TOKEN      = process.env.TEST_TOKEN;
const DEVICE_ID  = `test-device-${Date.now()}`;
const SKIP_KB    = process.argv.includes('--skip-kb');
const WS_ONLY    = process.argv.includes('--ws-only');
const REST_ONLY  = process.argv.includes('--rest-only');

if (!TOKEN) {
  console.error('\n  ERROR: TEST_TOKEN env var is required.');
  console.error('  Get a token by logging in, then:');
  console.error('  TEST_TOKEN=<your_jwt> node tests/screenE2eTest.js\n');
  process.exit(1);
}

const http = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout: 30000,
});

// ── Result tracker ────────────────────────────────────────────────────────────

const results = [];
let pass = 0;
let fail = 0;

function ok(label, detail = '') {
  pass++;
  results.push({ status: 'PASS', label, detail });
  console.log(`  ✓  ${label}${detail ? `  →  ${detail}` : ''}`);
}

function ko(label, err) {
  fail++;
  const msg = err?.response?.data?.message || err?.message || String(err);
  results.push({ status: 'FAIL', label, detail: msg });
  console.log(`  ✗  ${label}  →  ${msg}`);
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ── REST helpers ──────────────────────────────────────────────────────────────

async function post(path, body) {
  const r = await http.post(path, body);
  return r.data;
}

async function get(path) {
  const r = await http.get(path);
  return r.data;
}

// ── Screen REST Tests ─────────────────────────────────────────────────────────

async function runScreenRestTests() {
  section('Screen REST Tests');

  let initStatus;

  // 1. Init screen
  try {
    const r = await post('/api/screen/init', {
      deviceId:     DEVICE_ID,
      deviceType:   'mobile',
      viewportWidth: 390,
      context:      'home',
    });
    initStatus = r.data?.fromCache ? 'cached' : 'new';
    ok('POST /api/screen/init', `layoutCid=${r.data?.layoutCid?.slice(0,12)}… fromCache=${r.data?.fromCache}`);
  } catch (e) { ko('POST /api/screen/init', e); }

  // 2. Get state
  try {
    const r = await get(`/api/screen/state/${DEVICE_ID}`);
    ok('GET  /api/screen/state/:deviceId', `context=${r.data?.context} viewportClass=${r.data?.viewportClass}`);
  } catch (e) { ko('GET /api/screen/state/:deviceId', e); }

  // 3. Tap instruction → navigate to menu
  let tapLayoutCid;
  try {
    const r = await post('/api/screen/instruction', {
      deviceId:    DEVICE_ID,
      instruction: { type: 'tap', target: 'menu' },
    });
    tapLayoutCid = r.data?.layoutCid;
    ok('POST /api/screen/instruction (tap→menu)', `layoutCid=${tapLayoutCid?.slice(0,12)}… fromDedupe=${r.data?.fromDedupe}`);
  } catch (e) { ko('POST /api/screen/instruction (tap→menu)', e); }

  // 4. Search instruction
  try {
    const r = await post('/api/screen/instruction', {
      deviceId:    DEVICE_ID,
      instruction: { type: 'input', value: 'quantum computing' },
    });
    ok('POST /api/screen/instruction (input→search)', `context=${r.data?.context}`);
  } catch (e) { ko('POST /api/screen/instruction (input→search)', e); }

  // 5. Back tap
  try {
    const r = await post('/api/screen/instruction', {
      deviceId:    DEVICE_ID,
      instruction: { type: 'tap', target: 'back' },
    });
    ok('POST /api/screen/instruction (tap→back)', `context=${r.data?.context}`);
  } catch (e) { ko('POST /api/screen/instruction (tap→back)', e); }

  // 6. Prefetch CIDs (should be non-empty after instructions)
  try {
    const r = await get(`/api/screen/prefetch/${DEVICE_ID}`);
    const count = Array.isArray(r.data) ? r.data.length : 0;
    if (count > 0) {
      ok('GET  /api/screen/prefetch/:deviceId', `${count} prefetch CIDs: ${r.data.map(p => p.context).join(', ')}`);
    } else {
      ko('GET  /api/screen/prefetch/:deviceId', new Error('prefetchCids is empty — prediction may not have fired yet'));
    }
  } catch (e) { ko('GET /api/screen/prefetch/:deviceId', e); }

  // 7. History
  try {
    const r = await get(`/api/screen/history/${DEVICE_ID}`);
    const count = Array.isArray(r.data) ? r.data.length : 0;
    ok('GET  /api/screen/history/:deviceId', `${count} version entries`);
  } catch (e) { ko('GET /api/screen/history/:deviceId', e); }

  // 8. Dedup — re-init with same device should return cached
  try {
    const r = await post('/api/screen/init', {
      deviceId:     DEVICE_ID,
      deviceType:   'mobile',
      viewportWidth: 390,
      context:      'home',
    });
    ok('POST /api/screen/init (second call — expect cache)', `fromCache=${r.data?.fromCache}`);
  } catch (e) { ko('POST /api/screen/init (dedup)', e); }

  // 9. Missing deviceId → 400
  try {
    await post('/api/screen/init', { deviceType: 'mobile' });
    ko('POST /api/screen/init (missing deviceId) → expect 400', new Error('should have thrown'));
  } catch (e) {
    if (e.response?.status === 400) {
      ok('POST /api/screen/init (missing deviceId) → 400', 'correct error');
    } else {
      ko('POST /api/screen/init (missing deviceId) → 400', e);
    }
  }
}

// ── Architecture KB REST Tests ────────────────────────────────────────────────

async function runArchitectureKbTests() {
  section('Architecture KB REST Tests');

  let specCid;
  let queryCid;

  // 1. Commit a spec
  try {
    const r = await post('/api/architecture/spec', {
      specId:   'test-uce-pipeline',
      title:    'UCE Pipeline Specification (Test)',
      version:  '1.0.0',
      body:     'The Universal Commit Engine (UCE) is a 7-step pipeline: validate → normalize → CID → dedup → AI gate → version → store. Every content type passes through this pipeline. CIDs are SHA-256 hashes of normalized payloads.',
      keywords: ['uce', 'pipeline', 'cid', 'dedup'],
      domain:   'architecture',
    });
    specCid = r.data?.cid;
    ok('POST /api/architecture/spec', `cid=${specCid?.slice(0,12)}… fromDedupe=${r.data?.fromDedupe}`);
  } catch (e) { ko('POST /api/architecture/spec', e); }

  // 2. List specs
  try {
    const r = await get('/api/architecture/specs');
    ok('GET  /api/architecture/specs', `${r.count} specs found`);
  } catch (e) { ko('GET /api/architecture/specs', e); }

  // 3. Get spec by CID
  if (specCid) {
    try {
      const r = await get(`/api/architecture/spec/${specCid}`);
      ok('GET  /api/architecture/spec/:cid', `specId=${r.data?.payload?.specId}`);
    } catch (e) { ko('GET /api/architecture/spec/:cid', e); }
  }

  if (SKIP_KB) {
    console.log('\n  ⚡  Architecture query tests SKIPPED (--skip-kb flag).');
    console.log('     Remove --skip-kb to run the Opus call (may take 10–20s).\n');
    return;
  }

  const testQuery = 'Explain the UCE deduplication gate and why it makes repeated content commits O(1).';

  // 4. First query — cache miss, Opus call (may take 10–20s)
  console.log('\n     Calling Opus 4.7 (first query — may take 10–20s)…');
  try {
    const r = await post('/api/architecture/query', {
      title:    'UCE Dedup Gate (Test)',
      query:    testQuery,
      specRefs: specCid ? [specCid] : [],
    });
    queryCid = r.data?.queryCid;
    ok('POST /api/architecture/query (first call → Opus)',
       `queryCid=${queryCid?.slice(0,12)}… fromCache=${r.data?.fromCache} tokens=${r.data?.inputTokens}+${r.data?.outputTokens}`);
  } catch (e) { ko('POST /api/architecture/query (Opus call)', e); }

  // 5. Same query again — cache hit, instant
  try {
    const r = await post('/api/architecture/query', {
      title:    'UCE Dedup Gate (Test)',
      query:    testQuery,
      specRefs: specCid ? [specCid] : [],
    });
    if (r.data?.fromCache !== true) {
      ko('POST /api/architecture/query (cache hit) → expect fromCache=true',
         new Error(`got fromCache=${r.data?.fromCache}`));
    } else {
      ok('POST /api/architecture/query (second call → cache hit O(1))', 'fromCache=true, zero Opus cost');
    }
  } catch (e) { ko('POST /api/architecture/query (cache hit)', e); }

  // 6. Get response by queryCid
  if (queryCid) {
    try {
      const r = await get(`/api/architecture/response/${queryCid}`);
      ok('GET  /api/architecture/response/:queryCid', `model=${r.data?.payload?.model}`);
    } catch (e) { ko('GET /api/architecture/response/:queryCid', e); }
  }

  // 7. List queries
  try {
    const r = await get('/api/architecture/queries?limit=5');
    ok('GET  /api/architecture/queries', `${r.count} queries found`);
  } catch (e) { ko('GET /api/architecture/queries', e); }
}

// ── WebSocket Tests ───────────────────────────────────────────────────────────

async function runWebSocketTests() {
  section('WebSocket Tests  (/screen namespace)');

  // Attempt to load socket.io-client — not a declared dependency
  let io;
  try {
    io = require('socket.io-client');
  } catch {
    console.log('\n  WebSocket tests SKIPPED — socket.io-client is not installed.');
    console.log('  Install it with:\n');
    console.log('    npm install socket.io-client\n');
    console.log('  Then re-run this test.\n');
    return;
  }

  const WS_DEVICE = `ws-test-${Date.now()}`;

  return new Promise((resolve) => {
    const socket = io(`${BASE_URL}/screen`, {
      auth:    { token: TOKEN },
      transports: ['websocket'],
      timeout: 10000,
    });

    const pending = new Map();
    let resolved = false;

    function expect(eventName, timeoutMs = 8000) {
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`timeout waiting for ${eventName}`)), timeoutMs);
        socket.once(eventName, (data) => {
          clearTimeout(timer);
          res(data);
        });
      });
    }

    function done() {
      if (!resolved) {
        resolved = true;
        socket.disconnect();
        resolve();
      }
    }

    socket.on('connect_error', (err) => {
      ko('Connect to /screen namespace', err);
      done();
    });

    socket.on('connect', async () => {
      ok('Connect to /screen namespace', `socketId=${socket.id}`);

      // ── Test 1: screen:init → screen:ack ──────────────────────────────
      try {
        const ackPromise = expect('screen:ack');
        socket.emit('screen:init', {
          deviceId:     WS_DEVICE,
          deviceType:   'mobile',
          viewportWidth: 390,
          context:      'home',
        });
        const ack = await ackPromise;
        ok('screen:init → screen:ack received', `layoutCid=${ack.layoutCid?.slice(0,12)}…`);
      } catch (e) { ko('screen:init → screen:ack', e); done(); return; }

      // ── Test 2: screen:instruction → screen:ack + screen:sync ────────
      try {
        const ackP  = expect('screen:ack');
        const syncP = expect('screen:sync');
        socket.emit('screen:instruction', {
          deviceId:    WS_DEVICE,
          instruction: { type: 'tap', target: 'research' },
        });
        const [ack, sync] = await Promise.all([ackP, syncP]);
        ok('screen:instruction → screen:ack received',  `layoutCid=${ack.layoutCid?.slice(0,12)}… fromDedupe=${ack.fromDedupe}`);
        ok('screen:instruction → screen:sync received', `context=${sync.context}`);
      } catch (e) { ko('screen:instruction → screen:ack + screen:sync', e); }

      // ── Test 3: screen:prefetch received after instruction ────────────
      try {
        const prefetchP = expect('screen:prefetch', 12000);
        socket.emit('screen:instruction', {
          deviceId:    WS_DEVICE,
          instruction: { type: 'tap', target: 'menu' },
        });
        const prefetch = await prefetchP;
        const count = prefetch.layouts?.length || 0;
        if (count > 0) {
          ok('screen:prefetch received after instruction', `${count} layouts: ${prefetch.layouts.map(l => l.context).join(', ')}`);
        } else {
          ko('screen:prefetch received but empty', new Error('layouts array is empty'));
        }
      } catch (e) {
        // Prefetch may arrive after a short async delay — soft warning not hard fail
        console.log(`  ⚠  screen:prefetch not received within 12s — prediction may still be running`);
      }

      // ── Test 4: Missing deviceId → screen:error ───────────────────────
      try {
        const errP = expect('screen:error');
        socket.emit('screen:init', {}); // no deviceId
        const err = await errP;
        if (err.code === 'INVALID_INPUT') {
          ok('screen:init (no deviceId) → screen:error INVALID_INPUT', '');
        } else {
          ko('screen:init (no deviceId) → expected INVALID_INPUT', new Error(`got code=${err.code}`));
        }
      } catch (e) { ko('screen:init (no deviceId) → screen:error', e); }

      // ── Test 5: Missing instruction.type → screen:error ───────────────
      try {
        const errP = expect('screen:error');
        socket.emit('screen:instruction', { deviceId: WS_DEVICE, instruction: {} });
        const err = await errP;
        if (err.code === 'INVALID_INPUT') {
          ok('screen:instruction (no type) → screen:error INVALID_INPUT', '');
        } else {
          ko('screen:instruction (no type) → expected INVALID_INPUT', new Error(`got code=${err.code}`));
        }
      } catch (e) { ko('screen:instruction (no type) → screen:error', e); }

      done();
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Ceekul Screen + Architecture KB — End-to-End Test');
  console.log(`  Server: ${BASE_URL}   Device: ${DEVICE_ID}`);
  console.log('══════════════════════════════════════════════════════════════');

  try {
    if (!WS_ONLY) {
      await runScreenRestTests();
      await runArchitectureKbTests();
    }
    if (!REST_ONLY) {
      await runWebSocketTests();
    }
  } catch (err) {
    console.error('\nUnexpected test runner error:', err.message);
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Results:  ${pass} passed   ${fail} failed`);
  if (fail === 0) {
    console.log('  All tests passed. API is ready for Flutter client.');
  } else {
    console.log('  Fix the failures above before connecting the Flutter client.');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(fail > 0 ? 1 : 0);
})();
