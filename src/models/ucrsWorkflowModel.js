'use strict';

/**
 * UCRS Workflow Model — Phase 6 Temporary Compute State
 *
 * A workflow instance is a named, multi-step semantic job triggered by a UCRS
 * event. Steps run sequentially; state is persisted here between steps so a
 * crashed worker can resume from the last completed step.
 *
 * Lifecycle:
 *   pending → running → completed
 *                   ↘ failed  (step exceeded maxRetries)
 *                   ↘ skipped (trigger condition not met at step evaluation)
 *
 * Idempotency:
 *   triggerId = '{workflowName}::{eventSignature}' — unique index prevents
 *   duplicate workflow instances for the same triggering event.
 *
 * "Temporary compute module" framing:
 *   Each workflow instance is a unit of compute that is spawned, runs to
 *   completion (or failure), and is then archived. The system retains the
 *   execution record but the compute itself is ephemeral.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const ucrsWorkflowSchema = new Schema(
  {
    workflowId: { type: String, required: true, unique: true, index: true },

    // Idempotency key — prevents duplicate instances for the same trigger event.
    // Format: '{workflowName}::{eventSignature}'
    triggerId: { type: String, required: true, unique: true, index: true },

    // Registered workflow name — maps to step definitions at runtime.
    name: { type: String, required: true, index: true },

    // What triggered this instance.
    trigger: {
      eventType: { type: String, required: true },
      entityId:  { type: String, default: null },
      _id: false,
    },

    // Mutable semantic context passed between steps.
    // Each step may enrich this object; it is the "message" flowing through the workflow.
    context: { type: Schema.Types.Mixed, default: {} },

    // Per-step execution state.
    steps: [{
      id:          { type: String, required: true },
      status:      { type: String, enum: ['pending', 'running', 'completed', 'failed', 'skipped'], default: 'pending' },
      attempts:    { type: Number, default: 0 },
      startedAt:   { type: Date, default: null },
      completedAt: { type: Date, default: null },
      error:       { type: String, default: null },
      _id: false,
    }],

    // Index of the step currently being executed (or next to execute).
    currentStep: { type: Number, default: 0 },

    // Overall workflow status.
    status: {
      type:    String,
      enum:    ['pending', 'running', 'completed', 'failed', 'skipped'],
      default: 'pending',
      index:   true,
    },

    // Overall attempt counter (incremented each time the engine picks this up).
    attempts: { type: Number, default: 0 },

    startedAt:   { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error:       { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'ucrs_workflows',
  }
);

// Engine primary query: oldest pending workflows first
ucrsWorkflowSchema.index({ status: 1, createdAt: 1 });

// Stale-entry reclaim: running workflows stuck > threshold
ucrsWorkflowSchema.index({ status: 1, startedAt: 1 });

// Observability: find all instances of a workflow by name
ucrsWorkflowSchema.index({ name: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('UCRSWorkflow', ucrsWorkflowSchema);
