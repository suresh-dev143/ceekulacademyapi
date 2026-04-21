const router = require('express').Router();
const ctrl   = require('../controllers/neuronController');
const { authenticateUser, authenticateAdmin } = require('../middlewares');

// ── User routes (require authentication) ─────────────────────────────────────

/** GET  /api/neurons/account           — My full neuron account (all 4 buckets) */
router.get('/account', authenticateUser, ctrl.getAccount);

/** GET  /api/neurons/transactions      — Immutable ledger (paginated) */
router.get('/transactions', authenticateUser, ctrl.getTransactions);

/** POST /api/neurons/contributions     — Submit external contribution proof */
router.post('/contributions', authenticateUser, ctrl.submitContribution);

/** GET  /api/neurons/contributions     — My contributions history */
router.get('/contributions', authenticateUser, ctrl.getContributions);

/**
 * POST /api/neurons/transfer
 * Transfer between FUN/CUN/SUN. Strict rules enforced server-side:
 *   FUN → CUN ✅  FUN → SUN ✅
 *   CUN → SUN ✅  SUN → CUN ✅
 *   CUN → FUN ❌  SUN → FUN ❌ (BLOCKED)
 */
router.post('/transfer', authenticateUser, ctrl.transfer);

/** POST /api/neurons/invest            — Lock neurons into a project */
router.post('/invest', authenticateUser, ctrl.invest);

/** GET  /api/neurons/investments       — My investment records */
router.get('/investments', authenticateUser, ctrl.getInvestments);

/** POST /api/neurons/support/borrow    — Borrow support neurons (max 100k, 6 months) */
router.post('/support/borrow', authenticateUser, ctrl.borrowSupport);

/** POST /api/neurons/support/repay     — Repay support debt */
router.post('/support/repay', authenticateUser, ctrl.repaySupport);

/**
 * POST /api/neurons/service-transfer
 * P2P service payment: CEEBRAIN/CEEGROUP FUN/CUN/SUN → receiver MY NEURONS or Group Neurons
 */
router.post('/service-transfer', authenticateUser, ctrl.serviceTransfer);

// ── Admin routes ──────────────────────────────────────────────────────────────

/** POST /api/neurons/admin/confirm-contribution  — Confirm external transfer → credit FUN */
router.post('/admin/confirm-contribution', authenticateAdmin, ctrl.adminConfirmContribution);

/** POST /api/neurons/admin/credit-work-reward    — Credit My Neurons for work */
router.post('/admin/credit-work-reward', authenticateAdmin, ctrl.adminCreditWorkReward);

/** POST /api/neurons/admin/process-reward        — Process project outcome reward */
router.post('/admin/process-reward', authenticateAdmin, ctrl.adminProcessReward);

/** POST /api/neurons/admin/monthly-allocation    — Run monthly FUN/CUN/SUN distribution */
router.post('/admin/monthly-allocation', authenticateAdmin, ctrl.adminMonthlyAllocation);

/** GET  /api/neurons/admin/pending-contributions — List awaiting admin confirmation */
router.get('/admin/pending-contributions', authenticateAdmin, ctrl.adminListPending);

module.exports = router;
