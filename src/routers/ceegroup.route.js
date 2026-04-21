const router = require('express').Router();
const ctrl   = require('../controllers/ceegroupController');
const { authenticateUser } = require('../middlewares');

/** POST   /api/ceegroups                             — Create a new CEEGROUP */
router.post('/',                       authenticateUser, ctrl.createGroup);

/** GET    /api/ceegroups/mine                        — My groups (admin + member) */
router.get('/mine',                    authenticateUser, ctrl.getMyGroups);

/** GET    /api/ceegroups/resolve/:entityId           — Resolve CEEBRAIN/CEEGROUP ID to name */
router.get('/resolve/:entityId',       authenticateUser, ctrl.resolveEntity);

/** GET    /api/ceegroups/:ceegroupId                 — Get a single group */
router.get('/:ceegroupId',             authenticateUser, ctrl.getGroup);

/** POST   /api/ceegroups/:ceegroupId/members         — Add member (admin only) */
router.post('/:ceegroupId/members',    authenticateUser, ctrl.addMember);

/** DELETE /api/ceegroups/:ceegroupId/members/:userId — Remove member */
router.delete('/:ceegroupId/members/:userId', authenticateUser, ctrl.removeMember);

/** POST   /api/ceegroups/:ceegroupId/deposit         — Member → CEEGROUP bucket deposit */
router.post('/:ceegroupId/deposit',    authenticateUser, ctrl.groupDeposit);

module.exports = router;
