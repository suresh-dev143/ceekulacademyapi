/**
 * CEEGROUP SERVICE
 * =====================================================================
 * Handles CEEGROUP lifecycle and all cross-entity neuron operations:
 *
 *   groupDeposit:    Member's personal FUN/CUN/SUN → CEEGROUP bucket
 *   serviceTransfer: P2P service payment between any combination of
 *                    CEEBRAIN (12-digit) and CEEGROUP (15-digit) entities.
 *
 * Transfer routing:
 *   CEEBRAIN → CEEBRAIN : sender FUN/CUN/SUN → receiver MY NEURONS
 *   CEEBRAIN → CEEGROUP : sender FUN/CUN/SUN → group Group Neurons
 *   CEEGROUP → CEEBRAIN : group FUN/CUN/SUN  → receiver MY NEURONS
 *   CEEGROUP → CEEGROUP : group FUN/CUN/SUN  → target Group Neurons
 *
 * Entity type is inferred from ID length (12 = CEEBRAIN, 15 = CEEGROUP).
 * =====================================================================
 */
const mongoose   = require('mongoose');
const Ceegroup   = require('../models/ceegroupModel');
const NeuronAccount     = require('../models/neuronAccountModel');
const NeuronTransaction = require('../models/neuronTransactionModel');

// Resolve User model lazily to avoid circular-require issues at startup
const getUser = () => require('../models/authModels/userModel');

// ── Helpers ───────────────────────────────────────────────────────────────────

const entityTypeOf = (id) => {
  if (/^\d{12}$/.test(id)) return 'ceebrain';
  if (/^\d{15}$/.test(id)) return 'ceegroup';
  return null;
};

class CeegroupService {

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP MANAGEMENT
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new CEEGROUP. The creator becomes the first admin member.
   */
  static async createGroup(userId, { name, description = '' }) {
    if (!name?.trim()) throw Object.assign(new Error('Group name is required'), { status: 400 });

    const ceegroupId = await Ceegroup.generateId();

    const group = await Ceegroup.create({
      ceegroupId,
      name: name.trim(),
      description: description.trim(),
      createdBy: userId,
      members: [{ userId, role: 'admin', joinedAt: new Date() }],
    });

    return group;
  }

  /**
   * Add a member to the group. Only admins can invite.
   */
  static async addMember(ceegroupId, adminUserId, newUserId, role = 'member') {
    const group = await Ceegroup.findOne({ ceegroupId });
    if (!group)        throw Object.assign(new Error('CEEGROUP not found'), { status: 404 });
    if (!group.isAdmin(adminUserId))
      throw Object.assign(new Error('Only group admins can add members'), { status: 403 });
    if (group.isMember(newUserId))
      throw Object.assign(new Error('User is already a member'), { status: 409 });

    group.members.push({ userId: newUserId, role, joinedAt: new Date() });
    await group.save();
    return group;
  }

  /**
   * Remove a member. Admin can remove any member; members can remove themselves.
   */
  static async removeMember(ceegroupId, actingUserId, targetUserId) {
    const group = await Ceegroup.findOne({ ceegroupId });
    if (!group) throw Object.assign(new Error('CEEGROUP not found'), { status: 404 });

    const isAdmin       = group.isAdmin(actingUserId);
    const isSelf        = actingUserId.toString() === targetUserId.toString();
    if (!isAdmin && !isSelf)
      throw Object.assign(new Error('Insufficient permissions to remove member'), { status: 403 });

    // Prevent removing the last admin
    const admins = group.members.filter(m => m.role === 'admin');
    const isTargetAdmin = group.members.find(
      m => m.userId.toString() === targetUserId.toString()
    )?.role === 'admin';
    if (isTargetAdmin && admins.length === 1)
      throw Object.assign(new Error('Cannot remove the last admin'), { status: 400 });

    group.members = group.members.filter(
      m => m.userId.toString() !== targetUserId.toString()
    );
    await group.save();
    return group;
  }

  /**
   * Get a CEEGROUP by its 15-digit ID.
   */
  static async getGroup(ceegroupId) {
    const group = await Ceegroup.findOne({ ceegroupId }).lean();
    if (!group) throw Object.assign(new Error('CEEGROUP not found'), { status: 404 });
    return group;
  }

  /**
   * Get all groups a user belongs to (as admin or member).
   */
  static async getUserGroups(userId) {
    return Ceegroup.find({ 'members.userId': userId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP DEPOSIT
  // Member transfers from their personal FUN/CUN/SUN → CEEGROUP matching bucket
  // ────────────────────────────────────────────────────────────────────────────

  static async groupDeposit(userId, ceegroupId, fromBucket, amount) {
    if (!['fun', 'cun', 'sun'].includes(fromBucket))
      throw Object.assign(new Error('fromBucket must be fun, cun, or sun'), { status: 400 });
    if (amount <= 0)
      throw Object.assign(new Error('Amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const [account, group] = await Promise.all([
        NeuronAccount.findOne({ userId }).session(session),
        Ceegroup.findOne({ ceegroupId }).session(session),
      ]);

      if (!account) throw Object.assign(new Error('Neuron account not found'), { status: 404 });
      if (!group)   throw Object.assign(new Error('CEEGROUP not found'), { status: 404 });
      if (!group.isMember(userId))
        throw Object.assign(new Error('You must be a member of this CEEGROUP to deposit'), { status: 403 });
      if (account[fromBucket].balance < amount)
        throw Object.assign(
          new Error(`Insufficient ${fromBucket.toUpperCase()} balance. Available: ${account[fromBucket].balance}`),
          { status: 422 }
        );

      // Deduct from member's personal bucket
      account[fromBucket].balance             -= amount;
      account[fromBucket].totalTransferredOut += amount;
      account.lastActivityAt = new Date();
      await account.save({ session });

      // Credit CEEGROUP matching bucket
      group[fromBucket].balance       += amount;
      group[fromBucket].totalReceived += amount;
      group.lastActivityAt = new Date();
      await group.save({ session });

      // Record in member's neuron transaction ledger
      const tx = await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'group_deposit',
        fromBucket,
        toBucket:      'external',      // neuron leaves personal ledger
        amount,
        balanceAfter:  account.balanceSnapshot(),
        referenceId:   ceegroupId,
        referenceType: 'ceegroup',
        description:   `Deposited ${amount} ${fromBucket.toUpperCase()} neurons to CEEGROUP "${group.name}" (${ceegroupId})`,
      }], { session });

      await session.commitTransaction();
      return { account, group, transaction: tx[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SERVICE TRANSFER (P2P Neuron Payment for Services/Products)
  //
  // Sender's FUN/CUN/SUN is deducted.
  // Receiver gets neurons into:
  //   MY NEURONS   — if receiver is CEEBRAIN (individual)
  //   Group Neurons — if receiver is CEEGROUP
  //
  // Only the CEEBRAIN side gets entries in NeuronTransaction ledger.
  // CEEGROUP balance updates are applied directly on the Ceegroup document.
  // ────────────────────────────────────────────────────────────────────────────

  static async serviceTransfer({
    actingUserId,       // The authenticated user initiating the transfer
    senderEntityId,     // 12-digit CEEBRAIN or 15-digit CEEGROUP
    receiverEntityId,   // 12-digit CEEBRAIN or 15-digit CEEGROUP
    fromBucket,         // 'fun' | 'cun' | 'sun'
    amount,
    serviceDescription,
  }) {
    // ── Validate inputs ────────────────────────────────────────────────
    if (!['fun', 'cun', 'sun'].includes(fromBucket))
      throw Object.assign(new Error('fromBucket must be fun, cun, or sun'), { status: 400 });
    if (amount <= 0)
      throw Object.assign(new Error('Amount must be positive'), { status: 400 });
    if (!serviceDescription?.trim())
      throw Object.assign(new Error('Service description is required'), { status: 400 });
    if (senderEntityId === receiverEntityId)
      throw Object.assign(new Error('Sender and receiver must be different'), { status: 400 });

    amount = Math.floor(amount);

    const senderType   = entityTypeOf(senderEntityId);
    const receiverType = entityTypeOf(receiverEntityId);

    if (!senderType)   throw Object.assign(new Error('Invalid sender ID format (must be 12-digit CEEBRAIN or 15-digit CEEGROUP)'), { status: 400 });
    if (!receiverType) throw Object.assign(new Error('Invalid receiver ID format (must be 12-digit CEEBRAIN or 15-digit CEEGROUP)'), { status: 400 });

    const desc = serviceDescription.trim();

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // ── Resolve sender ───────────────────────────────────────────────
      let senderAccount, senderGroup, senderDisplayName;

      if (senderType === 'ceebrain') {
        const User = getUser();
        const senderUser = await User.findOne({ ceebrainId: senderEntityId }).session(session);
        if (!senderUser) throw Object.assign(new Error(`Sender CEEBRAIN ID ${senderEntityId} not found`), { status: 404 });

        // Verify the acting user IS the sender
        if (senderUser._id.toString() !== actingUserId.toString())
          throw Object.assign(new Error('You can only send from your own CEEBRAIN ID'), { status: 403 });

        senderAccount = await NeuronAccount.findOne({ userId: senderUser._id }).session(session);
        if (!senderAccount) throw Object.assign(new Error('Sender neuron account not found'), { status: 404 });
        if (senderAccount[fromBucket].balance < amount)
          throw Object.assign(
            new Error(`Insufficient ${fromBucket.toUpperCase()} balance. Available: ${senderAccount[fromBucket].balance}`),
            { status: 422 }
          );
        senderDisplayName = `CEEBRAIN ${senderEntityId}`;
      } else {
        senderGroup = await Ceegroup.findOne({ ceegroupId: senderEntityId }).session(session);
        if (!senderGroup) throw Object.assign(new Error(`Sender CEEGROUP ID ${senderEntityId} not found`), { status: 404 });

        // Verify acting user is a member of the sender group
        if (!senderGroup.isMember(actingUserId))
          throw Object.assign(new Error('You must be a member of the sender CEEGROUP'), { status: 403 });
        if (senderGroup[fromBucket].balance < amount)
          throw Object.assign(
            new Error(`Insufficient CEEGROUP ${fromBucket.toUpperCase()} balance. Available: ${senderGroup[fromBucket].balance}`),
            { status: 422 }
          );
        senderDisplayName = `CEEGROUP "${senderGroup.name}" (${senderEntityId})`;
      }

      // ── Resolve receiver ─────────────────────────────────────────────
      let receiverAccount, receiverGroup, receiverDisplayName;

      if (receiverType === 'ceebrain') {
        const User = getUser();
        const receiverUser = await User.findOne({ ceebrainId: receiverEntityId }).session(session);
        if (!receiverUser) throw Object.assign(new Error(`Receiver CEEBRAIN ID ${receiverEntityId} not found`), { status: 404 });
        receiverAccount = await NeuronAccount.findOne({ userId: receiverUser._id }).session(session);
        if (!receiverAccount) throw Object.assign(new Error('Receiver neuron account not found'), { status: 404 });
        receiverDisplayName = `CEEBRAIN ${receiverEntityId}`;
      } else {
        receiverGroup = await Ceegroup.findOne({ ceegroupId: receiverEntityId }).session(session);
        if (!receiverGroup) throw Object.assign(new Error(`Receiver CEEGROUP ID ${receiverEntityId} not found`), { status: 404 });
        receiverDisplayName = `CEEGROUP "${receiverGroup.name}" (${receiverEntityId})`;
      }

      // ── Deduct from sender ───────────────────────────────────────────
      if (senderType === 'ceebrain') {
        senderAccount[fromBucket].balance             -= amount;
        senderAccount[fromBucket].totalTransferredOut += amount;
        senderAccount.lastActivityAt = new Date();
        await senderAccount.save({ session });

        // Record in sender's neuron ledger
        await NeuronTransaction.create([{
          txId:          NeuronTransaction.generateTxId(),
          userId:        senderAccount.userId,
          txType:        'service_payment',
          fromBucket,
          toBucket:      receiverType === 'ceebrain' ? 'my_neurons' : 'group_neurons',
          amount,
          balanceAfter:  senderAccount.balanceSnapshot(),
          referenceId:   receiverEntityId,
          referenceType: receiverType,
          description:   `Service payment: ${amount} ${fromBucket.toUpperCase()} → ${receiverDisplayName} — ${desc}`,
        }], { session });
      } else {
        // CEEGROUP sender
        senderGroup[fromBucket].balance             -= amount;
        senderGroup[fromBucket].totalTransferredOut += amount;
        senderGroup.lastActivityAt = new Date();
        await senderGroup.save({ session });
      }

      // ── Credit to receiver ───────────────────────────────────────────
      if (receiverType === 'ceebrain') {
        receiverAccount.myNeurons.balance    += amount;
        receiverAccount.myNeurons.totalEarned += amount;
        receiverAccount.lastActivityAt = new Date();
        await receiverAccount.save({ session });

        // Record in receiver's neuron ledger
        await NeuronTransaction.create([{
          txId:          NeuronTransaction.generateTxId(),
          userId:        receiverAccount.userId,
          txType:        'service_receive',
          fromBucket:    senderType === 'ceebrain' ? fromBucket : 'group_neurons',
          toBucket:      'my_neurons',
          amount,
          balanceAfter:  receiverAccount.balanceSnapshot(),
          referenceId:   senderEntityId,
          referenceType: senderType,
          description:   `Service payment received: ${amount} neurons from ${senderDisplayName} — ${desc}`,
        }], { session });
      } else {
        // CEEGROUP receiver
        receiverGroup.groupNeurons.balance       += amount;
        receiverGroup.groupNeurons.totalReceived += amount;
        receiverGroup.lastActivityAt = new Date();
        await receiverGroup.save({ session });
      }

      await session.commitTransaction();

      return {
        amount,
        fromBucket,
        senderEntityId,
        receiverEntityId,
        senderType,
        receiverType,
        senderBalance: senderType === 'ceebrain'
          ? senderAccount.balanceSnapshot()
          : senderGroup.balanceSnapshot(),
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LOOKUP HELPERS (for UI — resolve entity name from ID)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Resolve entity display info from a CEEBRAIN or CEEGROUP ID.
   * Returns { type, name } or null.
   */
  static async resolveEntity(entityId) {
    const type = entityTypeOf(entityId);
    if (!type) return null;

    if (type === 'ceebrain') {
      const User = getUser();
      const user = await User.findOne({ ceebrainId: entityId }, 'name ceebrainId').lean();
      if (!user) return null;
      return { type: 'ceebrain', name: user.name, entityId };
    } else {
      const group = await Ceegroup.findOne({ ceegroupId: entityId }, 'name ceegroupId').lean();
      if (!group) return null;
      return { type: 'ceegroup', name: group.name, entityId };
    }
  }
}

module.exports = CeegroupService;
