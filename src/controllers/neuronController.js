/**
 * NEURON CONTROLLER
 * HTTP handlers for the Ceekul Neuron Participation Ecosystem.
 *
 * COMPLIANCE: Portal NEVER handles real money.
 * All financial transactions occur between users' bank accounts
 * and external entity escrow accounts — entirely outside this system.
 */
const NeuronService      = require('../services/neuronService');
const CeegroupService    = require('../services/ceegroupService');
const NeuronContribution = require('../models/neuronContributionModel');
const NeuronInvestment   = require('../models/neuronInvestmentModel');

// ── Helper ────────────────────────────────────────────────────────────────────
const ok  = (res, data, status = 200) => res.status(status).json({ status: true, ...data });
const err = (res, message, status = 500) => res.status(status).json({ status: false, message });

const handleErr = (res, e) => {
  console.error('[NeuronController]', e.message);
  return err(res, e.message, e.status ?? 500);
};

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/neurons/account
 * Returns the authenticated user's full neuron account (all buckets).
 */
exports.getAccount = async (req, res) => {
  try {
    const account = await NeuronService.getAccount(req.user._id);
    ok(res, { account });
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONS (Ledger)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/neurons/transactions?limit=50&offset=0&txType=work_reward
 */
exports.getTransactions = async (req, res) => {
  try {
    const { limit = 50, offset = 0, txType } = req.query;
    const result = await NeuronService.getTransactions(req.user._id, {
      limit:  parseInt(limit),
      offset: parseInt(offset),
      txType,
    });
    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTRIBUTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/neurons/contributions
 * User submits proof of external money transfer to an entity's escrow.
 * Portal records it as PENDING — no neurons issued yet.
 * An admin must confirm before neurons are credited (1 INR = 1 Neuron → FUN).
 */
exports.submitContribution = async (req, res) => {
  try {
    const { entityType, entityName, entityId, amountINR, transactionReference, notes } = req.body;

    if (!entityType || !entityName || !amountINR || !transactionReference) {
      return err(res, 'entityType, entityName, amountINR, and transactionReference are required', 400);
    }

    const contribution = await NeuronService.submitContribution(req.user._id, {
      entityType, entityName, entityId, amountINR, transactionReference, notes,
    });

    ok(res, {
      message: 'Contribution submitted. Neurons will be credited to your FUN bucket once the entity confirms receipt.',
      contribution,
    }, 201);
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/neurons/contributions?limit=20&offset=0&status=pending
 */
exports.getContributions = async (req, res) => {
  try {
    const { limit = 20, offset = 0, status } = req.query;
    const result = await NeuronService.getContributions(req.user._id, {
      limit: parseInt(limit), offset: parseInt(offset), status,
    });
    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// BUCKET TRANSFERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/neurons/transfer
 * Body: { fromBucket, toBucket, amount }
 *
 * Enforced transfer rules:
 *   FUN → CUN ✅   FUN → SUN ✅
 *   CUN → SUN ✅   SUN → CUN ✅
 *   CUN → FUN ❌   SUN → FUN ❌
 */
exports.transfer = async (req, res) => {
  try {
    const { fromBucket, toBucket, amount } = req.body;

    if (!fromBucket || !toBucket || !amount) {
      return err(res, 'fromBucket, toBucket, and amount are required', 400);
    }

    const result = await NeuronService.transfer(req.user._id, fromBucket, toBucket, Number(amount));
    ok(res, {
      message: `Successfully transferred ${amount} neurons from ${fromBucket.toUpperCase()} to ${toBucket.toUpperCase()}`,
      account:     result.account,
      transaction: result.transaction,
    });
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// INVESTMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/neurons/invest
 * Locks neurons from source bucket into a project's participation pool.
 *
 * Bucket rules:
 *   FUN → any project type
 *   CUN → research / innovation / knowledge ONLY
 *   SUN → business / infrastructure / social ONLY
 */
exports.invest = async (req, res) => {
  try {
    const { projectId, projectName, projectType, entityType, entityName, sourceBucket, amount } = req.body;

    if (!projectId || !projectName || !projectType || !entityType || !sourceBucket || !amount) {
      return err(res, 'projectId, projectName, projectType, entityType, sourceBucket, and amount are required', 400);
    }

    const result = await NeuronService.investNeurons(req.user._id, {
      projectId, projectName, projectType, entityType, entityName, sourceBucket, amount: Number(amount),
    });

    ok(res, {
      message: `${amount} neurons locked from ${sourceBucket.toUpperCase()} for project participation. The portal will generate an instruction for ${entityType} to execute the real-money transfer.`,
      account:    result.account,
      investment: result.investment,
    }, 201);
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/neurons/investments?limit=20&offset=0&status=locked
 */
exports.getInvestments = async (req, res) => {
  try {
    const { limit = 20, offset = 0, status } = req.query;
    const result = await NeuronService.getInvestments(req.user._id, {
      limit: parseInt(limit), offset: parseInt(offset), status,
    });
    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT (Debt System)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/neurons/support/borrow
 * Body: { amount }
 * Max: 100,000 neurons | Validity: 6 months | Repay via work or contributions
 */
exports.borrowSupport = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return err(res, 'amount is required', 400);
    const account = await NeuronService.borrowSupport(req.user._id, Number(amount));
    ok(res, {
      message: `${amount} support neurons credited to your FUN bucket. Repay via work or contributions within 6 months.`,
      account,
    });
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/neurons/support/repay
 * Body: { amount, fromBucket }
 */
exports.repaySupport = async (req, res) => {
  try {
    const { amount, fromBucket = 'fun' } = req.body;
    if (!amount) return err(res, 'amount is required', 400);
    const account = await NeuronService.repaySupport(req.user._id, Number(amount), fromBucket);
    ok(res, { message: `${amount} neurons repaid from ${fromBucket.toUpperCase()}.`, account });
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/neurons/admin/confirm-contribution
 * Body: { contributionId }
 * Admin verifies external transfer → neurons credited to user's FUN (1:1)
 */
exports.adminConfirmContribution = async (req, res) => {
  try {
    const { contributionId } = req.body;
    if (!contributionId) return err(res, 'contributionId is required', 400);
    const result = await NeuronService.confirmContribution(contributionId, req.user._id);
    ok(res, {
      message: `Contribution confirmed. ${result.neuronsIssued} neurons credited to user's FUN bucket.`,
      ...result,
    });
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/neurons/admin/credit-work-reward
 * Body: { userId, amount, description, referenceId, referenceType }
 */
exports.adminCreditWorkReward = async (req, res) => {
  try {
    const { userId, amount, description, referenceId, referenceType } = req.body;
    if (!userId || !amount) return err(res, 'userId and amount are required', 400);
    const result = await NeuronService.creditWorkReward(userId, Number(amount), description, referenceId, referenceType);
    ok(res, { message: `${amount} neurons credited to My Neurons for user ${userId}`, ...result });
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/neurons/admin/process-reward
 * Body: { investmentId, revenue, cost, impact, rewardAmount }
 * Process project completion and credit outcome reward to My Neurons.
 */
exports.adminProcessReward = async (req, res) => {
  try {
    const { investmentId, revenue, cost, impact, rewardAmount } = req.body;
    if (!investmentId) return err(res, 'investmentId is required', 400);
    const result = await NeuronService.processProjectReward(investmentId, {
      revenue, cost, impact, rewardAmount: Number(rewardAmount ?? 0),
    });
    ok(res, {
      message: `Project reward processed. ${result.investment.rewardAmount} neurons credited to My Neurons.`,
      ...result,
    });
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/neurons/admin/monthly-allocation
 * Body: { userId } — or omit to run for the authenticated user (testing)
 * Distributes My Neurons balance to FUN/CUN/SUN per monthly allocation rules.
 */
exports.adminMonthlyAllocation = async (req, res) => {
  try {
    const { userId } = req.body;
    const targetId = userId ?? req.user._id;
    const result = await NeuronService.runMonthlyAllocation(targetId);
    if (result.skipped) {
      return ok(res, { message: result.reason, skipped: true });
    }
    ok(res, {
      message: `Monthly allocation complete. User: ${result.userFun} FUN / ${result.userCun} CUN / ${result.userSun} SUN. Ceekul: ${result.ceekulFun} FUN / ${result.ceekulCun} CUN / ${result.ceekulSun} SUN.`,
      ...result,
    });
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE TRANSFER (P2P Neuron Payment)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/neurons/service-transfer
 * Send neurons from a CEEBRAIN or CEEGROUP entity to another for a service/product.
 *
 * Body:
 *   senderEntityId   — Your 12-digit CEEBRAIN ID, or a 15-digit CEEGROUP ID you belong to
 *   receiverEntityId — 12-digit CEEBRAIN or 15-digit CEEGROUP of the recipient
 *   fromBucket       — 'fun' | 'cun' | 'sun'
 *   amount           — positive integer
 *   serviceDescription — what was purchased/provided
 *
 * Result:
 *   CEEBRAIN receiver → neurons land in their MY NEURONS bucket
 *   CEEGROUP receiver → neurons land in their Group Neurons bucket
 */
exports.serviceTransfer = async (req, res) => {
  try {
    const { senderEntityId, receiverEntityId, fromBucket, amount, serviceDescription } = req.body;
    if (!senderEntityId || !receiverEntityId || !fromBucket || !amount || !serviceDescription)
      return err(res, 'senderEntityId, receiverEntityId, fromBucket, amount, and serviceDescription are required', 400);

    const result = await CeegroupService.serviceTransfer({
      actingUserId:      req.user._id,
      senderEntityId,
      receiverEntityId,
      fromBucket,
      amount:            Number(amount),
      serviceDescription,
    });

    ok(res, {
      message: `${result.amount} ${result.fromBucket.toUpperCase()} neurons sent from ${result.senderEntityId} to ${result.receiverEntityId}.`,
      ...result,
    });
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/neurons/admin/pending-contributions
 * Lists all pending contributions awaiting admin confirmation.
 */
exports.adminListPending = async (req, res) => {
  try {
    const contributions = await NeuronContribution.find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .populate('userId', 'name phone ceebrainId')
      .lean();
    ok(res, { contributions, total: contributions.length });
  } catch (e) { handleErr(res, e); }
};
