/**
 * CEEGROUP CONTROLLER
 * Endpoints for CEEGROUP lifecycle and group deposit management.
 * Service transfers are handled in neuronController.
 */
const CeegroupService = require('../services/ceegroupService');

const ok       = (res, data, status = 200) => res.status(status).json({ status: true, ...data });
const err      = (res, message, status = 500) => res.status(status).json({ status: false, message });
const handleErr = (res, e) => { console.error('[CeegroupController]', e.message); return err(res, e.message, e.status ?? 500); };

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/ceegroups
 * Create a new CEEGROUP. Creator becomes the first admin.
 * Body: { name, description? }
 */
exports.createGroup = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return err(res, 'name is required', 400);
    const group = await CeegroupService.createGroup(req.user._id, { name, description });
    ok(res, { message: `CEEGROUP "${group.name}" created with ID ${group.ceegroupId}`, group }, 201);
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/ceegroups/mine
 * List all groups the authenticated user belongs to.
 */
exports.getMyGroups = async (req, res) => {
  try {
    const groups = await CeegroupService.getUserGroups(req.user._id);
    ok(res, { groups });
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/ceegroups/:ceegroupId
 * Get a single CEEGROUP by its 15-digit ID.
 */
exports.getGroup = async (req, res) => {
  try {
    const group = await CeegroupService.getGroup(req.params.ceegroupId);
    ok(res, { group });
  } catch (e) { handleErr(res, e); }
};

/**
 * GET /api/ceegroups/resolve/:entityId
 * Resolve any CEEBRAIN (12-digit) or CEEGROUP (15-digit) ID to its display name.
 * Used by the send-neurons form to preview the receiver before submitting.
 */
exports.resolveEntity = async (req, res) => {
  try {
    const entity = await CeegroupService.resolveEntity(req.params.entityId);
    if (!entity) return err(res, 'Entity ID not found', 404);
    ok(res, { entity });
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/ceegroups/:ceegroupId/members
 * Add a member (admin only).
 * Body: { userId, role? }
 */
exports.addMember = async (req, res) => {
  try {
    const { userId, role = 'member' } = req.body;
    if (!userId) return err(res, 'userId is required', 400);
    const group = await CeegroupService.addMember(req.params.ceegroupId, req.user._id, userId, role);
    ok(res, { message: 'Member added', group });
  } catch (e) { handleErr(res, e); }
};

/**
 * DELETE /api/ceegroups/:ceegroupId/members/:userId
 * Remove a member. Admins can remove anyone; members can remove themselves.
 */
exports.removeMember = async (req, res) => {
  try {
    const group = await CeegroupService.removeMember(
      req.params.ceegroupId, req.user._id, req.params.userId
    );
    ok(res, { message: 'Member removed', group });
  } catch (e) { handleErr(res, e); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DEPOSIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/ceegroups/:ceegroupId/deposit
 * Member transfers from their personal FUN/CUN/SUN → CEEGROUP matching bucket.
 * Body: { fromBucket, amount }
 */
exports.groupDeposit = async (req, res) => {
  try {
    const { fromBucket, amount } = req.body;
    if (!fromBucket || !amount) return err(res, 'fromBucket and amount are required', 400);

    const result = await CeegroupService.groupDeposit(
      req.user._id, req.params.ceegroupId, fromBucket, Number(amount)
    );
    ok(res, {
      message: `${amount} ${fromBucket.toUpperCase()} neurons deposited to CEEGROUP`,
      account:     result.account,
      group:       result.group,
      transaction: result.transaction,
    });
  } catch (e) { handleErr(res, e); }
};
