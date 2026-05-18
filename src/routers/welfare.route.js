/**
 * WELFARE ROUTES
 * =====================================================================
 * CG100000000000 global welfare system — FUN / CUN / SUN disbursement.
 *
 * Member routes   → /api/welfare/*              (authenticateUser)
 * Provider route  → /api/welfare/provider-*     (authenticateUser)
 * Admin routes    → /api/welfare/admin/*        (authenticateAdmin)
 * =====================================================================
 */
const router = require('express').Router();
const ctrl   = require('../controllers/welfareController');
const { authenticateUser, authenticateAdmin } = require('../middlewares');
const needIntelligenceSvc  = require('../services/needIntelligenceService');
const pedagogySignalSvc    = require('../services/pedagogySignalService');

// ── Member ────────────────────────────────────────────────────────────────────

/** POST /api/welfare/apply — submit a new welfare application */
router.post('/apply', authenticateUser, ctrl.apply);

/** GET  /api/welfare/my-applications — list own applications */
router.get('/my-applications', authenticateUser, ctrl.getMyApplications);

/** GET  /api/welfare/my-applications/:applicationId */
router.get('/my-applications/:applicationId', authenticateUser, ctrl.getMyApplication);

/** POST /api/welfare/my-applications/:applicationId/close */
router.post('/my-applications/:applicationId/close', authenticateUser, ctrl.closeMyApplication);

// ── Service Provider ──────────────────────────────────────────────────────────

/**
 * POST /api/welfare/provider-confirm/:applicationId
 * Service provider (authenticated Ceebrain member) confirms delivery.
 */
router.post('/provider-confirm/:applicationId', authenticateUser, ctrl.providerConfirm);

// ── Admin / EC ────────────────────────────────────────────────────────────────

/** GET  /api/welfare/admin/applications */
router.get('/admin/applications', authenticateAdmin, ctrl.adminGetApplications);

/** GET  /api/welfare/admin/applications/:applicationId */
router.get('/admin/applications/:applicationId', authenticateAdmin, ctrl.adminGetApplication);

/** POST /api/welfare/admin/applications/:applicationId/close */
router.post('/admin/applications/:applicationId/close', authenticateAdmin, ctrl.adminCloseApplication);

/** GET  /api/welfare/admin/emergencies — confirmed emergency applications ready for immediate disbursement */
router.get('/admin/emergencies', authenticateAdmin, ctrl.adminGetEmergencies);

/** POST /api/welfare/admin/applications/:applicationId/support-entry — manually record partial support */
router.post('/admin/applications/:applicationId/support-entry', authenticateAdmin, ctrl.adminAddSupportEntry);

/** POST /api/welfare/admin/disburse/monthly — run month-end disbursement cycle */
router.post('/admin/disburse/monthly', authenticateAdmin, ctrl.adminRunMonthlyDisbursement);

/** POST /api/welfare/admin/disburse/emergency/:applicationId — immediate emergency disbursement */
router.post('/admin/disburse/emergency/:applicationId', authenticateAdmin, ctrl.adminEmergencyDisburse);

/** POST /api/welfare/admin/repayment-check — trigger auto-repayment check for all debtors */
router.post('/admin/repayment-check', authenticateAdmin, ctrl.adminRunRepaymentCheck);

/** GET  /api/welfare/admin/policy — active EC policy */
router.get('/admin/policy', authenticateAdmin, ctrl.adminGetActivePolicy);

/** GET  /api/welfare/admin/policies — full policy history */
router.get('/admin/policies', authenticateAdmin, ctrl.adminListPolicies);

/** POST /api/welfare/admin/policies — create new policy version */
router.post('/admin/policies', authenticateAdmin, ctrl.adminCreatePolicy);

// ── Need Intelligence: consent-first welfare signal assessment ────────────
// POST body: { consent: true } — consent must be explicitly true
router.post('/intelligent-assess', authenticateUser, async (req, res, next) => {
  try {
    if (req.body?.consent !== true) {
      return res.status(400).json({ status: false, message: 'Explicit consent required: send { consent: true }' });
    }
    const result = await needIntelligenceSvc.assess(req.user._id);
    res.json({ status: true, data: result });
  } catch (err) { next(err); }
});

// ── Living Pedagogy: isolated content detection ───────────────────────────
router.get('/pedagogy/isolated-content', authenticateAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const nodes = await pedagogySignalSvc.findIsolatedContent(limit);
    res.json({ status: true, data: { nodes, message: 'Content nodes with no outbound knowledge connections — curriculum intervention points.' } });
  } catch (err) { next(err); }
});

module.exports = router;
