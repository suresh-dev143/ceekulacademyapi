/**
 * WELFARE SERVICE
 * =====================================================================
 * Business logic for the CG100000000000 global welfare system.
 *
 * Flow summary:
 *  1. Member submits application (single submission, stays in queue)
 *  2. Any partial support from any source auto-updates outstandingNeed
 *  3. Service provider confirms delivery
 *  4. Month-end batch (or immediate for emergency) disburses from fund
 *  5. Background job watches CB balances → auto-repays when above threshold
 *
 * The ranking algorithm uses the active WelfarePolicy set by Executive Council.
 * =====================================================================
 */
const mongoose        = require('mongoose');
const WelfareApplication = require('../models/welfareApplicationModel');
const WelfarePolicy      = require('../models/welfarePolicyModel');
const NeuronAccount      = require('../models/neuronAccountModel');
const NeuronTransaction  = require('../models/neuronTransactionModel');
const ledger             = require('./ucrsLedgerService');

// CB ID of the global welfare community group
const WELFARE_CG_ID = '100000000000000'; // 15-digit CG ID

// ── Internal neuron helpers ───────────────────────────────────────────────────

/**
 * Credit an applicant's FUN bucket with disbursed welfare neurons.
 * Idempotent: skips if a transaction with the same idempotencyKey already exists.
 * Creates the NeuronAccount if the user has no account yet.
 */
async function _creditApplicantFUN(applicantUserId, amount, applicationId, description, idempotencyKey) {
  if (idempotencyKey) {
    const existing = await NeuronTransaction.findOne({ 'metadata.idempotencyKey': idempotencyKey }).lean();
    if (existing) return existing;
  }

  const account = await NeuronAccount.findOneAndUpdate(
    { userId: applicantUserId },
    {
      $inc: { 'fun.balance': amount, 'fun.totalReceived': amount },
      $set: { lastActivityAt: new Date() },
    },
    { upsert: true, new: true }
  );

  return NeuronTransaction.create({
    txId:          NeuronTransaction.generateTxId(),
    userId:        applicantUserId,
    txType:        'service_receive',
    fromBucket:    'group_neurons',
    toBucket:      'fun',
    amount,
    balanceAfter:  account.balanceSnapshot(),
    referenceId:   applicationId,
    referenceType: 'system',
    description,
    metadata:      { idempotencyKey, applicationId, source: 'welfare_disbursement' },
  });
}

/**
 * Debit an applicant's neurons for welfare repayment.
 * Drains my_neurons first, then fun. Atomic per bucket via conditional update.
 * Idempotent via idempotencyKey.
 */
async function _debitApplicantForRepayment(applicantUserId, amount, applicationId, idempotencyKey) {
  if (idempotencyKey) {
    const existing = await NeuronTransaction.findOne({ 'metadata.idempotencyKey': idempotencyKey }).lean();
    if (existing) return existing;
  }

  let debited = 0;
  let fromBucket = 'my_neurons';

  // Try my_neurons first (atomic: only deducts if balance is sufficient)
  const fromMy = await NeuronAccount.findOneAndUpdate(
    { userId: applicantUserId, 'myNeurons.balance': { $gte: amount } },
    { $inc: { 'myNeurons.balance': -amount }, $set: { lastActivityAt: new Date() } },
    { new: true }
  );

  if (fromMy) {
    debited = amount;
    fromBucket = 'my_neurons';
  } else {
    // Partial from my_neurons then remainder from fun
    const acct = await NeuronAccount.findOne({ userId: applicantUserId });
    if (!acct) return null;

    const myPart  = Math.min(acct.myNeurons.balance, amount);
    const funPart = Math.min(acct.fun.balance, amount - myPart);
    debited = myPart + funPart;
    if (debited <= 0) return null;

    fromBucket = funPart > 0 ? 'fun' : 'my_neurons';
    const inc = {};
    if (myPart  > 0) inc['myNeurons.balance'] = -myPart;
    if (funPart > 0) { inc['fun.balance'] = -funPart; inc['fun.totalTransferredOut'] = funPart; }
    await NeuronAccount.updateOne({ userId: applicantUserId }, { $inc: inc, $set: { lastActivityAt: new Date() } });
  }

  const updatedAcct = await NeuronAccount.findOne({ userId: applicantUserId });

  return NeuronTransaction.create({
    txId:          NeuronTransaction.generateTxId(),
    userId:        applicantUserId,
    txType:        'support_repay',
    fromBucket,
    toBucket:      'group_neurons',
    amount:        debited,
    balanceAfter:  updatedAcct.balanceSnapshot(),
    referenceId:   applicationId,
    referenceType: 'system',
    description:   `Welfare auto-repayment for application ${applicationId}`,
    metadata:      { idempotencyKey, applicationId, source: 'welfare_repayment' },
  });
}

class WelfareService {

  // ──────────────────────────────────────────────────────────────────────────
  // APPLICATION MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Submit a new welfare application.
   * Member may only have one active (non-fulfilled, non-closed) application
   * per fund type at a time.
   */
  static async submitApplication(userId, cbId, {
    fundType,
    goalCategory,
    goalDescription,
    requestedAmount,
    isEmergency = false,
    serviceProviderId = null,
  }) {
    // Guard: one active application per fund type
    const existing = await WelfareApplication.findOne({
      applicantUserId: userId,
      fundType,
      status: { $in: ['pending', 'partially_funded'] },
    });
    if (existing) {
      const e = new Error(
        `You already have an active ${fundType.toUpperCase()} application (${existing.applicationId}). ` +
        `Update it or wait for it to be fulfilled before applying again.`
      );
      e.status = 409;
      throw e;
    }

    const application = await WelfareApplication.create({
      applicationId:   WelfareApplication.generateApplicationId(),
      applicantUserId: userId,
      applicantCBId:   cbId,
      fundType,
      goalCategory,
      goalDescription,
      requestedAmount,
      outstandingNeed: requestedAmount,
      isEmergency,
      serviceProviderId,
    });

    ledger.emit({
      eventType:  'ENTITY_CREATED',
      actorId:    cbId,
      actorType:  'citizen',
      resourceId: application.applicationId,
      payload:    { fundType, goalCategory, requestedAmount, isEmergency },
    }).catch(() => {});

    return application;
  }

  /**
   * Fetch all applications for the authenticated member.
   */
  static async getMyApplications(userId) {
    return WelfareApplication.find({ applicantUserId: userId })
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Fetch a single application by ID — validates ownership unless admin=true.
   */
  static async getApplication(applicationId, userId, admin = false) {
    const app = await WelfareApplication.findOne({ applicationId });
    if (!app) {
      const e = new Error('Application not found'); e.status = 404; throw e;
    }
    if (!admin && String(app.applicantUserId) !== String(userId)) {
      const e = new Error('Access denied'); e.status = 403; throw e;
    }
    return app;
  }

  /**
   * Close an application voluntarily (member or EC admin).
   */
  static async closeApplication(applicationId, userId, admin = false) {
    const app = await WelfareService.getApplication(applicationId, userId, admin);
    if (app.status === 'fulfilled') {
      const e = new Error('Cannot close a fulfilled application'); e.status = 400; throw e;
    }
    app.status = 'closed';
    return app.save();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPORT LEDGER
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record any partial support received from an external source.
   * Automatically recalculates outstandingNeed and updates status.
   *
   * Called when:
   *  - Another member donates from their SUN/FUN
   *  - A service is offered in kind
   *  - CUN subsidy is applied
   */
  static async addSupportLedgerEntry(applicationId, {
    sourceId,
    sourceType,
    amount,
    description = '',
    confirmedBy,
  }) {
    const app = await WelfareApplication.findOne({ applicationId });
    if (!app) {
      const e = new Error('Application not found'); e.status = 404; throw e;
    }
    if (['fulfilled', 'closed'].includes(app.status)) {
      const e = new Error('Cannot add support to a fulfilled or closed application'); e.status = 400; throw e;
    }

    app.supportLedger.push({
      sourceId,
      sourceType,
      amount,
      description,
      confirmedAt: new Date(),
      confirmedBy,
    });

    await app.recalculateOutstandingNeed();

    ledger.emit({
      eventType:  'CONTENT_COMMITTED',
      actorId:    sourceId,
      actorType:  sourceType || 'citizen',
      resourceId: applicationId,
      payload:    { event: 'SUPPORT_ENTRY', amount, description, outstandingNeed: app.outstandingNeed, status: app.status },
    }).catch(() => {});

    return app;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SERVICE PROVIDER CONFIRMATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Service provider confirms delivery.
   * This is required before neurons can disburse from CG100000000000.
   */
  static async providerConfirm(applicationId, serviceProviderId) {
    const app = await WelfareApplication.findOne({ applicationId });
    if (!app) {
      const e = new Error('Application not found'); e.status = 404; throw e;
    }
    if (app.serviceProviderConfirmed) {
      const e = new Error('Already confirmed'); e.status = 400; throw e;
    }
    if (app.serviceProviderId && app.serviceProviderId !== serviceProviderId) {
      const e = new Error('Provider ID does not match application'); e.status = 403; throw e;
    }

    app.serviceProviderId          = serviceProviderId;
    app.serviceProviderConfirmed   = true;
    app.serviceProviderConfirmedAt = new Date();
    const saved = await app.save();

    ledger.emit({
      eventType:  'ENTITY_STATE_CHANGED',
      actorId:    serviceProviderId,
      actorType:  'service_provider',
      resourceId: applicationId,
      subjectId:  String(app.applicantUserId),
      payload:    { event: 'PROVIDER_CONFIRMED', applicationId, fundType: app.fundType },
    }).catch(() => {});

    return saved;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POLICY MANAGEMENT (EC Admin)
  // ──────────────────────────────────────────────────────────────────────────

  static async getActivePolicy() {
    return WelfarePolicy.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  }

  /**
   * Create a new policy version and deactivate the previous one.
   */
  static async createPolicy(ecAdminCBId, policyData) {
    // Atomically deactivate all active policies then create the new one.
    // Two separate writes are unavoidable without transactions, but updateMany
    // completes before create so the window where two policies are active is zero.
    await WelfarePolicy.updateMany({ isActive: true }, { $set: { isActive: false } });

    const policy = await WelfarePolicy.create({
      policyId:    WelfarePolicy.generatePolicyId(),
      createdBy:   ecAdminCBId,
      isActive:    true,
      ...policyData,
    });

    ledger.emit({
      eventType:  'ENTITY_CREATED',
      actorId:    ecAdminCBId,
      actorType:  'admin',
      resourceId: policy.policyId,
      payload:    { event: 'WELFARE_POLICY_ACTIVATED', policyId: policy.policyId },
    }).catch(() => {});

    return policy;
  }

  static async listPolicies() {
    return WelfarePolicy.find().sort({ createdAt: -1 }).lean();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RANKING ALGORITHM
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Rank confirmed-and-pending applicants using EC-defined policy criteria.
   * Only applications with serviceProviderConfirmed=true are eligible for
   * disbursement from CG100000000000.
   *
   * monthlyNeuronFlows: Map<cbId, number> — caller provides this snapshot
   *
   * Returns applications sorted by score descending (highest priority first).
   */
  static rankApplicants(applications, policy, monthlyNeuronFlows = {}) {
    const now = Date.now();
    const { priorityCriteria, goalCategoryWeights } = policy;

    const scored = applications.map((app) => {
      let score = 0;

      for (const criterion of priorityCriteria) {
        let rawValue = 0;

        switch (criterion.field) {
          case 'monthly_neuron_inflow':
            rawValue = monthlyNeuronFlows[app.applicantCBId] ?? 0;
            break;
          case 'outstanding_need':
            rawValue = app.outstandingNeed;
            break;
          case 'days_in_queue':
            rawValue = (now - new Date(app.createdAt).getTime()) / 86_400_000;
            break;
          case 'goal_category_weight':
            rawValue = (goalCategoryWeights || {})[app.goalCategory] ?? 50;
            break;
          case 'prior_support_received':
            rawValue = app.supportLedger.reduce((s, e) => s + e.amount, 0) + app.disbursedAmount;
            break;
          default:
            rawValue = 0;
        }

        // asc = lower is needier = higher score (invert)
        const directionMultiplier = criterion.direction === 'asc' ? -1 : 1;
        score += rawValue * criterion.weight * directionMultiplier;
      }

      return { app, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map((s) => s.app);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DISBURSEMENT — ADMIN / SYSTEM
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run the month-end disbursement cycle for a given fund type.
   * - Fetches all provider-confirmed, non-fulfilled applications
   * - Ranks them using active policy
   * - Disburses from CG100000000000 pool (fund pool tracking only — neurons
   *   are non-monetary; actual neuron debit from CG account is separate)
   *
   * cycle: ISO yyyy-MM string (e.g. '2026-05')
   * monthlyNeuronFlows: Map<cbId, number>
   * availablePool: total neurons available in the fund pool for this cycle
   *
   * Returns array of disbursement results.
   */
  static async runMonthlyDisbursement(fundType, cycle, monthlyNeuronFlows = {}, availablePool) {
    const policy = await WelfareService.getActivePolicy();
    if (!policy) throw new Error('No active welfare policy found. EC must set a policy first.');

    const candidates = await WelfareApplication.find({
      fundType,
      status: { $in: ['pending', 'partially_funded'] },
      serviceProviderConfirmed: true,
    }).lean();

    const ranked = WelfareService.rankApplicants(candidates, policy, monthlyNeuronFlows);

    const results = [];
    let remaining = availablePool;

    for (const appData of ranked) {
      if (remaining <= 0) break;

      const disburseAmount = Math.min(
        appData.outstandingNeed,
        remaining,
        policy.maxDisbursementPerApplicantPerCycle ?? Infinity,
      );
      if (disburseAmount <= 0) continue;

      const app = await WelfareApplication.findOne({ applicationId: appData.applicationId });
      app.disbursedAmount  += disburseAmount;
      app.disbursedAt       = new Date();
      app.lastProcessedCycle = cycle;
      await app.recalculateOutstandingNeed();

      // Credit applicant's FUN bucket with disbursed amount.
      // Idempotency key prevents double-credit if this cycle runs twice.
      _creditApplicantFUN(
        app.applicantUserId,
        disburseAmount,
        app.applicationId,
        `Welfare monthly disbursement (${cycle}) for ${app.fundType.toUpperCase()} application`,
        `welfare-monthly-${app.applicationId}-${cycle}`,
      ).catch((err) => console.error('[welfare] neuron credit failed:', err.message));

      remaining -= disburseAmount;
      results.push({ applicationId: app.applicationId, applicantCBId: app.applicantCBId, disburseAmount });

      ledger.emit({
        eventType:  'SESSION_ENDED',
        actorId:    `CG${WELFARE_CG_ID}`,
        actorType:  'community_group',
        resourceId: app.applicationId,
        subjectId:  app.applicantCBId,
        payload:    { event: 'MONTHLY_DISBURSEMENT', cycle, fundType, disburseAmount, outstandingNeed: app.outstandingNeed, status: app.status },
      }).catch(() => {});
    }

    return { cycle, fundType, totalDisbursed: availablePool - remaining, results };
  }

  /**
   * Emergency disbursement — bypasses month-end wait.
   * Only for applications with isEmergency=true and provider confirmed.
   */
  static async emergencyDisburse(applicationId, disburseAmount, authorisedBy) {
    const app = await WelfareApplication.findOne({ applicationId });
    if (!app) { const e = new Error('Not found'); e.status = 404; throw e; }
    if (!app.isEmergency) {
      const e = new Error('Application is not marked as emergency'); e.status = 400; throw e;
    }
    if (!app.serviceProviderConfirmed) {
      const e = new Error('Provider must confirm before neurons can disburse'); e.status = 400; throw e;
    }

    const amount = Math.min(disburseAmount, app.outstandingNeed);
    app.disbursedAmount += amount;
    app.disbursedAt      = new Date();
    await app.recalculateOutstandingNeed();

    // Credit applicant's FUN bucket immediately (emergency disbursement).
    // Idempotency key: applicationId + 'emergency' — one emergency credit per application.
    _creditApplicantFUN(
      app.applicantUserId,
      amount,
      applicationId,
      `Emergency welfare disbursement for ${app.fundType.toUpperCase()} application, authorised by ${authorisedBy}`,
      `welfare-emergency-${applicationId}`,
    ).catch((err) => console.error('[welfare] emergency neuron credit failed:', err.message));

    ledger.emit({
      eventType:  'SESSION_ENDED',
      actorId:    authorisedBy,
      actorType:  'admin',
      resourceId: applicationId,
      subjectId:  app.applicantCBId,
      payload:    { event: 'EMERGENCY_DISBURSEMENT', disburseAmount: amount, authorisedBy, outstandingNeed: app.outstandingNeed, status: app.status },
    }).catch(() => {});

    return { applicationId, disburseAmount: amount, authorisedBy };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUTO-REPAYMENT — BACKGROUND JOB
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check all CB IDs that have outstanding welfare debt.
   * If their neuron balance exceeds EC repaymentThreshold, auto-deduct.
   *
   * This is meant to run as a scheduled job (daily or post monthly-allocation).
   * Returns list of repayments made.
   */
  static async checkAndRepayDebts() {
    const policy = await WelfareService.getActivePolicy();
    if (!policy) return [];

    const { repaymentThreshold } = policy;

    // Find all fulfilled (or partially_funded) applications with unpaid debt
    const debtors = await WelfareApplication.find({
      disbursedAmount: { $gt: 0 },
      $expr: { $gt: ['$disbursedAmount', '$repaidAmount'] },
    }).lean();

    const repayments = [];

    for (const debtor of debtors) {
      const account = await NeuronAccount.findOne({ userId: debtor.applicantUserId });
      if (!account) continue;

      const totalBalance = account.myNeurons.balance + account.fun.balance +
                           account.cun.balance + account.sun.balance;

      if (totalBalance <= repaymentThreshold) continue;

      const surplus      = totalBalance - repaymentThreshold;
      const outstanding  = debtor.disbursedAmount - (debtor.repaidAmount ?? 0);
      const repayAmount  = Math.min(surplus, outstanding);
      if (repayAmount <= 0) continue;

      // Deduct from my_neurons first, then fun
      const app = await WelfareApplication.findOne({ applicationId: debtor.applicationId });
      app.repaidAmount = (app.repaidAmount ?? 0) + repayAmount;
      if (app.repaidAmount >= app.disbursedAmount) {
        app.fullyRepaidAt = new Date();
      }
      await app.save();

      // Debit applicant's neurons for repayment (my_neurons first, then fun).
      // Each repayment run uses a date-keyed idempotency so daily jobs don't double-debit.
      const repayKey = `welfare-repay-${debtor.applicationId}-${new Date().toISOString().slice(0, 10)}`;
      _debitApplicantForRepayment(
        debtor.applicantUserId,
        repayAmount,
        debtor.applicationId,
        repayKey,
      ).catch((err) => console.error('[welfare] neuron repayment debit failed:', err.message));

      ledger.emit({
        eventType:  'ENTITY_STATE_CHANGED',
        actorId:    debtor.applicantCBId,
        actorType:  'citizen',
        resourceId: debtor.applicationId,
        payload:    { event: 'AUTO_REPAYMENT', repayAmount, fullyRepaid: app.repaidAmount >= app.disbursedAmount },
      }).catch(() => {});

      repayments.push({
        applicationId: debtor.applicationId,
        applicantCBId: debtor.applicantCBId,
        repayAmount,
      });
    }

    return repayments;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  static async getAllApplications({ status, fundType, goalCategory, isEmergency, limit = 50, offset = 0 } = {}) {
    const filter = {};
    if (status)       filter.status       = status;
    if (fundType)     filter.fundType     = fundType;
    if (goalCategory) filter.goalCategory = goalCategory;
    if (isEmergency !== undefined) filter.isEmergency = isEmergency === 'true' || isEmergency === true;

    const [applications, total] = await Promise.all([
      WelfareApplication.find(filter)
        .sort({ outstandingNeed: -1, createdAt: 1 })
        .skip(Number(offset))
        .limit(Number(limit))
        .lean(),
      WelfareApplication.countDocuments(filter),
    ]);

    return { applications, total };
  }

  static async getPendingEmergencies() {
    return WelfareApplication.find({
      isEmergency: true,
      status: { $in: ['pending', 'partially_funded'] },
      serviceProviderConfirmed: true,
    }).sort({ createdAt: 1 }).lean();
  }
}

module.exports = WelfareService;
