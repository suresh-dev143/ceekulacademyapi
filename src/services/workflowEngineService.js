'use strict';

/**
 * UCRS Workflow Engine — Phase 6 Semantic Orchestration
 *
 * A lightweight saga-style orchestrator for multi-step UCRS semantic jobs.
 * Each workflow is a named sequence of idempotent step functions that:
 *   - Execute sequentially
 *   - Persist context between steps (survives crashes)
 *   - Retry individual steps up to MAX_STEP_RETRIES times
 *   - Record full execution history in ucrs_workflows
 *
 * Trigger model:
 *   Workflows subscribe to in-process events via eventService.subscribe().
 *   When the UCRS dispatcher or UCE outbox worker publishes an event, the
 *   in-process emitter fires synchronously and the engine schedules a workflow
 *   instance (fire-and-forget; the workflow runs asynchronously).
 *
 * Idempotency:
 *   triggerId = '{name}::{eventSignature}' with a unique MongoDB index ensures
 *   each event triggers at most one instance of each workflow.
 *
 * "Temporary compute module" model:
 *   Each workflow instance is an ephemeral compute unit — spawned on event,
 *   executed to completion, archived. Workers are stateless; all state lives
 *   in the workflow document.
 *
 * Built-in workflows (registered at start()):
 *   enrich_committed_content  — triggered by content_committed
 *   validate_schedule          — triggered by schedule_created
 *   check_need_signals         — triggered by enrolment_created
 */

const { v4: uuidv4 }  = require('uuid');
const UCRSWorkflow     = require('../models/ucrsWorkflowModel');
const { subscribe }   = require('./eventService');

const POLL_INTERVAL_MS  = 3_000;
const MAX_STEP_RETRIES  = 3;
const STALE_AFTER_MS    = 5 * 60 * 1000;  // reclaim running workflows stuck > 5 min
const BATCH_SIZE        = 20;

// ── Step function registry ────────────────────────────────────────────────────
// Maps stepId → async function (context) → updatedContext
// Functions must be idempotent: safe to call multiple times with the same context.

const STEP_FNS = {};

function registerStep(stepId, fn) {
  STEP_FNS[stepId] = fn;
}

// ── Workflow definition registry ──────────────────────────────────────────────

const WORKFLOW_DEFS = {};  // name → { triggerOn, steps[], getContext, getTrigId }

function registerWorkflow({ name, triggerOn, steps, getContext, getTrigId }) {
  WORKFLOW_DEFS[name] = { name, triggerOn, steps, getContext, getTrigId };
}

// ── Built-in step: enrich_committed_content ───────────────────────────────────

registerStep('ece_load_content', async (ctx) => {
  const UceContent = require('../models/uceContentModel');
  const content = await UceContent.findOne({ cid: ctx.cid }).lean();
  if (!content) return { ...ctx, _skip: 'content not found — dedup hit or orphan' };
  return { ...ctx, contentType: content.contentType, payload: content.payload };
});

registerStep('ece_derive_tags', async (ctx) => {
  if (ctx._skip) return ctx;
  const { payload = {}, contentType } = ctx;

  // Deterministic tag extraction — no AI cost
  const raw = [
    ...(payload.keywords || []),
    ...(String(payload.title || '').toLowerCase().split(/\W+/).filter(t => t.length > 3)),
    ...(String(payload.subtitle || '').toLowerCase().split(/\W+/).filter(t => t.length > 4)),
    contentType,
  ];

  const tags = [...new Set(raw.filter(Boolean))].slice(0, 20);
  return { ...ctx, derivedTags: tags };
});

registerStep('ece_update_commit_bridge', async (ctx) => {
  if (ctx._skip || !ctx.derivedTags?.length) return ctx;
  const UCRSCommit = require('../models/ucrsCommitModel');
  await UCRSCommit.findOneAndUpdate(
    { commitId: `UCE-${ctx.cid}` },
    { $addToSet: { semanticTags: { $each: ctx.derivedTags } } }
  );
  return ctx;
});

// ── Built-in step: validate_schedule ─────────────────────────────────────────

registerStep('vs_load_schedule', async (ctx) => {
  const UCRSSchedule = require('../models/scheduleModel');
  const schedule = await UCRSSchedule.findOne({ scheduleId: ctx.scheduleId }).lean();
  if (!schedule) return { ...ctx, _skip: 'schedule not found' };
  return { ...ctx, contentCid: schedule.contentRef?.cid || null, category: schedule.category };
});

registerStep('vs_verify_content_cid', async (ctx) => {
  if (ctx._skip || !ctx.contentCid) return ctx;  // no CID to verify — OK
  const UceContent = require('../models/uceContentModel');
  const exists = await UceContent.exists({ cid: ctx.contentCid });
  return { ...ctx, contentCidValid: !!exists };
});

registerStep('vs_emit_validation', async (ctx) => {
  if (ctx._skip) return ctx;
  const UCRSOutbox = require('../models/ucrsOutboxModel');
  // Idempotent: key by workflowId so retry won't duplicate
  await UCRSOutbox.findOneAndUpdate(
    { eventId: `wf-vs-${ctx.workflowId}` },
    {
      eventId:    `wf-vs-${ctx.workflowId}`,
      actorId:    'system',
      eventType:  'CONTENT_LINKED',
      entityType: 'schedule',
      entityId:   ctx.scheduleId,
      contentCid: ctx.contentCid || null,
      payload: {
        scheduleId:     ctx.scheduleId,
        contentCid:     ctx.contentCid,
        contentCidValid: ctx.contentCidValid ?? null,
        validatedBy:    'workflow:validate_schedule',
      },
    },
    { upsert: true }
  );
  return ctx;
});

// ── Built-in step: check_need_signals ─────────────────────────────────────────

registerStep('cns_assess_needs', async (ctx) => {
  if (!ctx.citizenId) return { ...ctx, _skip: 'no citizenId' };
  try {
    const { assess } = require('./needIntelligenceService');
    const assessment = await assess(ctx.citizenId);
    const highUrgency = assessment.signals.filter(s => s.urgency === 'high');
    return { ...ctx, signals: assessment.signals, highUrgencyCount: highUrgency.length };
  } catch {
    return { ...ctx, signals: [], highUrgencyCount: 0 };
  }
});

registerStep('cns_queue_welfare_signal', async (ctx) => {
  if (ctx._skip || ctx.highUrgencyCount === 0) return ctx;
  const UCRSOutbox = require('../models/ucrsOutboxModel');
  await UCRSOutbox.findOneAndUpdate(
    { eventId: `wf-cns-${ctx.workflowId}` },
    {
      eventId:    `wf-cns-${ctx.workflowId}`,
      actorId:    ctx.citizenId,
      eventType:  'CONTENT_LINKED',   // re-uses closest available enum value
      entityType: 'enrolment',
      entityId:   `${ctx.citizenId}::${ctx.scheduleId}`,
      payload: {
        type:         'welfare_signal',
        citizenId:    ctx.citizenId,
        signals:      ctx.signals,
        highUrgency:  ctx.highUrgencyCount,
        detectedBy:   'workflow:check_need_signals',
      },
    },
    { upsert: true }
  );
  return ctx;
});

// ── Register built-in workflows ────────────────────────────────────────────────

registerWorkflow({
  name:      'enrich_committed_content',
  triggerOn: 'content_committed',
  steps:     ['ece_load_content', 'ece_derive_tags', 'ece_update_commit_bridge'],
  getContext: (event) => ({ cid: event.payload?.cid }),
  getTrigId:  (name, event) => `${name}::cid::${event.payload?.cid}`,
});

registerWorkflow({
  name:      'validate_schedule',
  triggerOn: 'schedule_created',
  steps:     ['vs_load_schedule', 'vs_verify_content_cid', 'vs_emit_validation'],
  getContext: (event) => ({ scheduleId: event.payload?.entityId }),
  getTrigId:  (name, event) => `${name}::${event.payload?.eventId || event.payload?.entityId}`,
});

registerWorkflow({
  name:      'check_need_signals',
  triggerOn: 'enrolment_created',
  steps:     ['cns_assess_needs', 'cns_queue_welfare_signal'],
  getContext: (event) => ({
    citizenId:  event.payload?.actorId,
    scheduleId: event.payload?.payload?.scheduleId,
  }),
  getTrigId:  (name, event) => `${name}::${event.payload?.eventId}`,
});

// ── Trigger handler — called by event subscribers ─────────────────────────────

async function handleEvent(emittedEvent) {
  // emittedEvent structure from eventService: { type, payload, timestamp, version }
  const eventType = emittedEvent.type;

  for (const [, def] of Object.entries(WORKFLOW_DEFS)) {
    if (def.triggerOn !== eventType) continue;

    const context   = def.getContext(emittedEvent);
    const triggerId = def.getTrigId(def.name, emittedEvent);

    if (!triggerId || triggerId.endsWith('::undefined') || triggerId.endsWith('::null')) continue;

    try {
      await UCRSWorkflow.findOneAndUpdate(
        { triggerId },
        {
          $setOnInsert: {
            workflowId:  uuidv4(),
            triggerId,
            name:        def.name,
            trigger:     { eventType, entityId: context.scheduleId || context.cid || context.citizenId || null },
            context:     { ...context, workflowId: null }, // workflowId added after insert
            steps:       def.steps.map(id => ({ id, status: 'pending', attempts: 0 })),
            currentStep: 0,
            status:      'pending',
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      if (err.code !== 11000) {
        console.error(`[WorkflowEngine] Failed to schedule ${def.name}:`, err.message);
      }
      // 11000 = duplicate triggerId — idempotent, already scheduled
    }
  }
}

// ── Drain cycle ────────────────────────────────────────────────────────────────

async function drain() {
  // Reclaim running workflows stuck by a crashed worker
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS);
  await UCRSWorkflow.updateMany(
    { status: 'running', startedAt: { $lt: staleThreshold } },
    { $set: { status: 'pending' } }
  ).catch(() => {});

  const workflows = await UCRSWorkflow.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  for (const wf of workflows) {
    // Atomic claim
    const claimed = await UCRSWorkflow.findOneAndUpdate(
      { _id: wf._id, status: 'pending' },
      { $set: { status: 'running', startedAt: new Date() }, $inc: { attempts: 1 } },
      { new: true }
    );
    if (!claimed) continue;

    await executeWorkflow(claimed);
  }
}

async function executeWorkflow(wf) {
  const def = WORKFLOW_DEFS[wf.name];
  if (!def) {
    await UCRSWorkflow.updateOne(
      { _id: wf._id },
      { $set: { status: 'failed', error: `Unknown workflow name: ${wf.name}`, completedAt: new Date() } }
    );
    return;
  }

  let context = { ...wf.context, workflowId: String(wf._id) };
  const steps = [...wf.steps];

  for (let i = wf.currentStep; i < steps.length; i++) {
    const step = steps[i];
    const stepFn = STEP_FNS[step.id];

    if (!stepFn) {
      // Unknown step — skip rather than fail the whole workflow
      steps[i] = { ...step, status: 'skipped', completedAt: new Date() };
      await UCRSWorkflow.updateOne(
        { _id: wf._id },
        { $set: { [`steps.${i}`]: steps[i], currentStep: i + 1 } }
      );
      continue;
    }

    // Mark step running
    steps[i] = { ...step, status: 'running', startedAt: new Date(), attempts: step.attempts + 1 };
    await UCRSWorkflow.updateOne({ _id: wf._id }, { $set: { [`steps.${i}`]: steps[i] } });

    try {
      context = await stepFn(context);

      steps[i] = { ...steps[i], status: 'completed', completedAt: new Date(), error: null };
      await UCRSWorkflow.updateOne(
        { _id: wf._id },
        { $set: { [`steps.${i}`]: steps[i], currentStep: i + 1, context } }
      );
    } catch (err) {
      const isFinalAttempt = steps[i].attempts >= MAX_STEP_RETRIES;
      steps[i] = { ...steps[i], status: isFinalAttempt ? 'failed' : 'pending', error: err.message };

      if (isFinalAttempt) {
        await UCRSWorkflow.updateOne(
          { _id: wf._id },
          {
            $set: {
              [`steps.${i}`]: steps[i],
              status:          'failed',
              error:           `Step ${step.id} failed after ${MAX_STEP_RETRIES} attempts: ${err.message}`,
              completedAt:     new Date(),
            },
          }
        );
        return;
      }

      // Step will be retried on the next drain cycle — reset workflow to pending
      await UCRSWorkflow.updateOne(
        { _id: wf._id },
        { $set: { [`steps.${i}`]: steps[i], status: 'pending' } }
      );
      return;
    }
  }

  // All steps completed
  await UCRSWorkflow.updateOne(
    { _id: wf._id },
    { $set: { status: 'completed', completedAt: new Date(), context } }
  );
}

// ── Public: start ─────────────────────────────────────────────────────────────

function start() {
  // Subscribe to all trigger event types
  const triggerTypes = new Set(Object.values(WORKFLOW_DEFS).map(d => d.triggerOn));
  for (const eventType of triggerTypes) {
    subscribe(eventType, (event) => {
      handleEvent(event).catch(err =>
        console.error(`[WorkflowEngine] handleEvent error (${eventType}):`, err.message)
      );
    });
  }

  console.log(
    `[WorkflowEngine] Started — ${Object.keys(WORKFLOW_DEFS).length} workflows, ` +
    `triggers: [${[...triggerTypes].join(', ')}]`
  );

  const tick = async () => {
    try { await drain(); }
    catch (err) { console.error('[WorkflowEngine] Drain error:', err.message); }
    setTimeout(tick, POLL_INTERVAL_MS);
  };
  tick();
}

// ── Admin introspection ────────────────────────────────────────────────────────

async function getStats() {
  const [pending, running, completed, failed] = await Promise.all([
    UCRSWorkflow.countDocuments({ status: 'pending' }),
    UCRSWorkflow.countDocuments({ status: 'running' }),
    UCRSWorkflow.countDocuments({ status: 'completed' }),
    UCRSWorkflow.countDocuments({ status: 'failed' }),
  ]);

  const byName = await UCRSWorkflow.aggregate([
    { $group: { _id: { name: '$name', status: '$status' }, count: { $sum: 1 } } },
    { $sort: { '_id.name': 1, '_id.status': 1 } },
  ]);

  return {
    total: { pending, running, completed, failed },
    byName,
    registeredWorkflows: Object.keys(WORKFLOW_DEFS),
  };
}

module.exports = { start, handleEvent, getStats, registerWorkflow, registerStep };
