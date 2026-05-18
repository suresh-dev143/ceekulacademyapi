/**
 * WELFARE POLICY MODEL
 * =====================================================================
 * Executive Council-configured rules that drive the welfare algorithm:
 *   - Priority criteria for ranking applicants
 *   - Repayment threshold (auto-deduction triggers above this balance)
 *   - Goal category weights (some needs rank higher than others)
 *
 * Only ONE policy document should be active at a time (isActive: true).
 * EC creates a new policy version rather than editing an existing one,
 * so the full history of policy decisions is preserved.
 * =====================================================================
 */
const mongoose = require('mongoose');

// ── Priority Criterion ────────────────────────────────────────────────────────
// The algorithm scores each applicant as:
//   score = Σ (normalised_field_value * weight * direction_multiplier)
// direction: 'asc'  → lower value = higher score (more needy)
//            'desc' → higher value = higher score
const priorityCriterionSchema = new mongoose.Schema(
  {
    field: {
      type: String,
      enum: [
        'monthly_neuron_inflow',   // CB ID's neuron inflow for current month
        'outstanding_need',        // current outstandingNeed on the application
        'days_in_queue',           // how long application has been waiting
        'goal_category_weight',    // look up goalCategoryWeights map
        'prior_support_received',  // total support ever received by this CB
      ],
      required: true,
    },
    weight: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    direction: {
      type: String,
      enum: ['asc', 'desc'],
      default: 'asc',
    },
  },
  { _id: false }
);

// ── Goal Category Weights ─────────────────────────────────────────────────────
// Higher weight = higher priority when goal_category_weight criterion is used.
const goalCategoryWeightsSchema = new mongoose.Schema(
  {
    starving:          { type: Number, default: 100 },
    shelter:           { type: Number, default: 90  },
    emergency_health:  { type: Number, default: 95  },
    emergency_safety:  { type: Number, default: 85  },
    learning:          { type: Number, default: 70  },
    other:             { type: Number, default: 50  },
  },
  { _id: false }
);

// ── Main Policy Schema ────────────────────────────────────────────────────────
const welfarePolicySchema = new mongoose.Schema(
  {
    policyId: {
      type: String,
      unique: true,
      required: true,
    },

    // ── Repayment threshold ────────────────────────────────────────────────────
    // When a borrower's CB neuron balance exceeds this, auto-repayment triggers.
    repaymentThreshold: {
      type: Number,
      required: true,
      min: [0, 'Threshold must be non-negative'],
      default: 5000,
    },

    // ── Maximum neurons disbursed to a single applicant per cycle ─────────────
    // null = no per-applicant cap (fund pool is the only limit)
    maxDisbursementPerApplicantPerCycle: {
      type: Number,
      default: null,
    },

    // ── Scoring criteria for ranking among active applicants ─────────────────
    priorityCriteria: {
      type: [priorityCriterionSchema],
      default: [
        { field: 'goal_category_weight', weight: 40, direction: 'desc' },
        { field: 'monthly_neuron_inflow', weight: 35, direction: 'asc'  },
        { field: 'outstanding_need',      weight: 15, direction: 'desc' },
        { field: 'days_in_queue',         weight: 10, direction: 'desc' },
      ],
    },

    // ── Goal category relative weights ────────────────────────────────────────
    goalCategoryWeights: {
      type: goalCategoryWeightsSchema,
      default: () => ({}),
    },

    // ── Active flag ────────────────────────────────────────────────────────────
    // Only one policy should be active at a time.
    isActive: { type: Boolean, default: true },

    // ── Authorship ────────────────────────────────────────────────────────────
    createdBy: { type: String, required: true }, // EC admin CB ID
    notes: { type: String, maxlength: 2000 },
  },
  {
    timestamps: true,
    collection: 'welfare_policies',
  }
);

welfarePolicySchema.index({ isActive: 1 });
welfarePolicySchema.index({ createdAt: -1 });

welfarePolicySchema.statics.generatePolicyId = function () {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `WPL-${ts}-${rand}`;
};

const WelfarePolicy = mongoose.model('WelfarePolicy', welfarePolicySchema);
module.exports = WelfarePolicy;
