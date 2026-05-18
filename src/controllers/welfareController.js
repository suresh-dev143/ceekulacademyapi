/**
 * WELFARE CONTROLLER
 * HTTP handlers for the CG100000000000 welfare system.
 */
const WelfareService = require('../services/welfareService');

const ok  = (res, data, status = 200) => res.status(status).json({ status: true,  ...data });
const err = (res, message, status = 500) => res.status(status).json({ status: false, message });

const handleErr = (res, e) => {
  console.error('[WelfareController]', e.message);
  return err(res, e.message, e.status ?? 500);
};

// ── Member: Apply ─────────────────────────────────────────────────────────────

/**
 * POST /api/welfare/apply
 * Body: { fundType, goalCategory, goalDescription, requestedAmount, isEmergency?, serviceProviderId? }
 * Requires: req.user with ceebrainId field
 */
exports.apply = async (req, res) => {
  try {
    const { fundType, goalCategory, goalDescription, requestedAmount, isEmergency, serviceProviderId } = req.body;
    if (!fundType || !goalCategory || !goalDescription || !requestedAmount) {
      return err(res, 'fundType, goalCategory, goalDescription, and requestedAmount are required', 400);
    }
    const application = await WelfareService.submitApplication(
      req.user._id,
      req.user.ceebrainId,
      { fundType, goalCategory, goalDescription, requestedAmount, isEmergency, serviceProviderId }
    );
    ok(res, { application }, 201);
  } catch (e) { handleErr(res, e); }
};

// ── Member: My Applications ───────────────────────────────────────────────────

/** GET /api/welfare/my-applications */
exports.getMyApplications = async (req, res) => {
  try {
    const applications = await WelfareService.getMyApplications(req.user._id);
    ok(res, { applications });
  } catch (e) { handleErr(res, e); }
};

/** GET /api/welfare/my-applications/:applicationId */
exports.getMyApplication = async (req, res) => {
  try {
    const application = await WelfareService.getApplication(req.params.applicationId, req.user._id);
    ok(res, { application });
  } catch (e) { handleErr(res, e); }
};

/** POST /api/welfare/my-applications/:applicationId/close */
exports.closeMyApplication = async (req, res) => {
  try {
    const application = await WelfareService.closeApplication(req.params.applicationId, req.user._id);
    ok(res, { application });
  } catch (e) { handleErr(res, e); }
};

// ── Service Provider: Confirm ─────────────────────────────────────────────────

/**
 * POST /api/welfare/provider-confirm/:applicationId
 * Body: { serviceProviderId }
 */
exports.providerConfirm = async (req, res) => {
  try {
    const { serviceProviderId } = req.body;
    if (!serviceProviderId) return err(res, 'serviceProviderId is required', 400);
    const application = await WelfareService.providerConfirm(req.params.applicationId, serviceProviderId);
    ok(res, { application });
  } catch (e) { handleErr(res, e); }
};

// ── Admin: Browse Applications ────────────────────────────────────────────────

/** GET /api/welfare/admin/applications?status=&fundType=&goalCategory=&isEmergency=&limit=&offset= */
exports.adminGetApplications = async (req, res) => {
  try {
    const result = await WelfareService.getAllApplications(req.query);
    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

/** GET /api/welfare/admin/applications/:applicationId */
exports.adminGetApplication = async (req, res) => {
  try {
    const application = await WelfareService.getApplication(req.params.applicationId, null, true);
    ok(res, { application });
  } catch (e) { handleErr(res, e); }
};

/** POST /api/welfare/admin/applications/:applicationId/close */
exports.adminCloseApplication = async (req, res) => {
  try {
    const application = await WelfareService.closeApplication(req.params.applicationId, null, true);
    ok(res, { application });
  } catch (e) { handleErr(res, e); }
};

/** GET /api/welfare/admin/emergencies */
exports.adminGetEmergencies = async (req, res) => {
  try {
    const applications = await WelfareService.getPendingEmergencies();
    ok(res, { applications });
  } catch (e) { handleErr(res, e); }
};

// ── Admin: Support Ledger ─────────────────────────────────────────────────────

/**
 * POST /api/welfare/admin/applications/:applicationId/support-entry
 * Body: { sourceId, sourceType, amount, description, confirmedBy }
 */
exports.adminAddSupportEntry = async (req, res) => {
  try {
    const { sourceId, sourceType, amount, description, confirmedBy } = req.body;
    if (!sourceId || !sourceType || !amount) {
      return err(res, 'sourceId, sourceType, and amount are required', 400);
    }
    const application = await WelfareService.addSupportLedgerEntry(
      req.params.applicationId,
      { sourceId, sourceType, amount, description, confirmedBy }
    );
    ok(res, { application });
  } catch (e) { handleErr(res, e); }
};

// ── Admin: Disbursement ───────────────────────────────────────────────────────

/**
 * POST /api/welfare/admin/disburse/monthly
 * Body: { fundType, cycle, availablePool, monthlyNeuronFlows? }
 */
exports.adminRunMonthlyDisbursement = async (req, res) => {
  try {
    const { fundType, cycle, availablePool, monthlyNeuronFlows = {} } = req.body;
    if (!fundType || !cycle || availablePool == null) {
      return err(res, 'fundType, cycle, and availablePool are required', 400);
    }
    const result = await WelfareService.runMonthlyDisbursement(fundType, cycle, monthlyNeuronFlows, availablePool);
    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/welfare/admin/disburse/emergency/:applicationId
 * Body: { disburseAmount }
 */
exports.adminEmergencyDisburse = async (req, res) => {
  try {
    const { disburseAmount } = req.body;
    if (!disburseAmount) return err(res, 'disburseAmount is required', 400);
    const result = await WelfareService.emergencyDisburse(
      req.params.applicationId,
      disburseAmount,
      req.admin?.ceebrainId ?? 'admin'
    );
    ok(res, result);
  } catch (e) { handleErr(res, e); }
};

/** POST /api/welfare/admin/repayment-check */
exports.adminRunRepaymentCheck = async (req, res) => {
  try {
    const repayments = await WelfareService.checkAndRepayDebts();
    ok(res, { repayments, count: repayments.length });
  } catch (e) { handleErr(res, e); }
};

// ── EC Admin: Policy ──────────────────────────────────────────────────────────

/** GET /api/welfare/admin/policy */
exports.adminGetActivePolicy = async (req, res) => {
  try {
    const policy = await WelfareService.getActivePolicy();
    ok(res, { policy });
  } catch (e) { handleErr(res, e); }
};

/** GET /api/welfare/admin/policies */
exports.adminListPolicies = async (req, res) => {
  try {
    const policies = await WelfareService.listPolicies();
    ok(res, { policies });
  } catch (e) { handleErr(res, e); }
};

/**
 * POST /api/welfare/admin/policies
 * Body: { repaymentThreshold, priorityCriteria, goalCategoryWeights, maxDisbursementPerApplicantPerCycle, notes }
 */
exports.adminCreatePolicy = async (req, res) => {
  try {
    const ecAdminCBId = req.admin?.ceebrainId ?? req.body.createdBy;
    if (!ecAdminCBId) return err(res, 'EC admin CB ID is required', 400);
    const policy = await WelfareService.createPolicy(ecAdminCBId, req.body);
    ok(res, { policy }, 201);
  } catch (e) { handleErr(res, e); }
};
