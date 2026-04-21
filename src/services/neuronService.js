/**
 * NEURON SERVICE
 * =====================================================================
 * Core business logic for the Ceekul participation ecosystem.
 *
 * LEGAL COMPLIANCE:
 *   - Neurons are NON-MONETARY internal participation units
 *   - Portal NEVER handles real money
 *   - No withdrawals, no guarantees, no interest
 *   - All money flows are between user's bank and external entity escrows
 * =====================================================================
 */
const mongoose = require('mongoose');
const NeuronAccount     = require('../models/neuronAccountModel');
const NeuronTransaction = require('../models/neuronTransactionModel');
const NeuronContribution = require('../models/neuronContributionModel');
const NeuronInvestment  = require('../models/neuronInvestmentModel');

// ── Transfer Rules ────────────────────────────────────────────────────────────
// STRICTLY ENFORCED — any transfer not in this map is rejected.
const ALLOWED_TRANSFERS = {
  fun: ['cun', 'sun'],  // FUN → CUN ✅  FUN → SUN ✅
  cun: ['sun'],          // CUN → SUN ✅  CUN → FUN ❌
  sun: ['cun'],          // SUN → CUN ✅  SUN → FUN ❌
};

// ── Bucket ↔ Project-Type Rules ───────────────────────────────────────────────
const BUCKET_PROJECT_RULES = NeuronInvestment.schema.statics?.BUCKET_PROJECT_RULES ?? {
  fun: null,           // null = any
  cun: ['research', 'innovation', 'knowledge'],
  sun: ['business', 'infrastructure', 'social'],
};

// ── Monthly Allocation Ratios ─────────────────────────────────────────────────
// At last day of month, 12:00 midnight, T = My Neurons balance
// User share  (99%): 33% FUN + 33% CUN + 33% SUN  (≈ 32.67% each of T)
// Ceekul share (1%): 33% FUN + 33% CUN + 34% SUN  of the 1%
const USER_SHARE   = 0.99;
const CEEKUL_SHARE = 0.01;
const USER_RATIOS  = { fun: 1/3, cun: 1/3, sun: 1/3 };
const CEEKUL_RATIOS = { fun: 0.33, cun: 0.33, sun: 0.34 };

// ── Expiry: 6 months of inactivity ────────────────────────────────────────────
const EXPIRY_MONTHS = 6;

// ── Support limit ─────────────────────────────────────────────────────────────
const MAX_SUPPORT = 100_000;
const SUPPORT_VALIDITY_MONTHS = 6;

class NeuronService {

  // ────────────────────────────────────────────────────────────────────────────
  // ACCOUNT MANAGEMENT
  // ────────────────────────────────────────────────────────────────────────────

  static async getOrCreateAccount(userId) {
    let account = await NeuronAccount.findOne({ userId });
    if (!account) {
      account = await NeuronAccount.create({ userId });
    }
    return account;
  }

  static async getAccount(userId) {
    return NeuronService.getOrCreateAccount(userId);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CONTRIBUTION FLOW
  // Rule: External money → entity escrow (OUTSIDE portal)
  //       Entity confirms → 1 INR = 1 Neuron → credited to FUN ONLY
  // ────────────────────────────────────────────────────────────────────────────

  static async submitContribution(userId, { entityType, entityName, entityId, amountINR, transactionReference, notes }) {
    const contribution = await NeuronContribution.create({
      userId,
      entityType,
      entityName,
      entityId,
      amountINR,
      transactionReference,
      notes,
      status: 'pending',
    });
    return contribution;
  }

  /**
   * Called by admin after verifying the external money transfer.
   * Credits FUN with amountINR neurons (1:1 conversion rule).
   */
  static async confirmContribution(contributionId, adminId, session) {
    const sess = session ?? await mongoose.startSession();
    const ownSession = !session;
    if (ownSession) sess.startTransaction();

    try {
      const contribution = await NeuronContribution.findById(contributionId).session(sess);
      if (!contribution) throw Object.assign(new Error('Contribution not found'), { status: 404 });
      if (contribution.status !== 'pending') {
        throw Object.assign(new Error('Contribution is not in pending state'), { status: 409 });
      }

      const neuronsToCredit = Math.floor(contribution.amountINR); // 1 INR = 1 Neuron

      const account = await NeuronService.getOrCreateAccount(contribution.userId);

      // Credit FUN ONLY (entry rule)
      account.fun.balance      += neuronsToCredit;
      account.fun.totalReceived += neuronsToCredit;
      account.lastActivityAt   = new Date();
      await account.save({ session: sess });

      // Record immutable ledger entry
      const tx = await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId:        contribution.userId,
        txType:        'contribution_conversion',
        fromBucket:    'external',
        toBucket:      'fun',
        amount:        neuronsToCredit,
        balanceAfter:  account.balanceSnapshot(),
        referenceId:   contribution._id.toString(),
        referenceType: 'contribution',
        description:   `Contribution of ₹${contribution.amountINR} confirmed — ${neuronsToCredit} neurons credited to FUN`,
        metadata:      { entityType: contribution.entityType, entityName: contribution.entityName, transactionReference: contribution.transactionReference },
      }], { session: sess });

      // Update contribution record
      contribution.status           = 'confirmed';
      contribution.neuronsIssued    = neuronsToCredit;
      contribution.neuronTransactionId = tx[0].txId;
      contribution.confirmedAt      = new Date();
      contribution.confirmedBy      = adminId;
      await contribution.save({ session: sess });

      if (ownSession) await sess.commitTransaction();
      return { contribution, neuronsIssued: neuronsToCredit };
    } catch (err) {
      if (ownSession) await sess.abortTransaction();
      throw err;
    } finally {
      if (ownSession) sess.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // BUCKET TRANSFERS
  // Strictly enforced transfer rules — see ALLOWED_TRANSFERS map above.
  // CUN and SUN can NEVER transfer back to FUN.
  // ────────────────────────────────────────────────────────────────────────────

  static async transfer(userId, fromBucket, toBucket, amount) {
    // Validate transfer direction
    const allowed = ALLOWED_TRANSFERS[fromBucket] ?? [];
    if (!allowed.includes(toBucket)) {
      throw Object.assign(
        new Error(`Transfer from ${fromBucket.toUpperCase()} to ${toBucket.toUpperCase()} is not permitted by the Ceekul participation rules.`),
        { status: 400 }
      );
    }

    if (amount <= 0) throw Object.assign(new Error('Transfer amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const account = await NeuronAccount.findOne({ userId }).session(session);
      if (!account) throw Object.assign(new Error('Neuron account not found'), { status: 404 });

      const sourceBalance = account[fromBucket].balance;
      if (sourceBalance < amount) {
        throw Object.assign(
          new Error(`Insufficient ${fromBucket.toUpperCase()} balance. Available: ${sourceBalance}, Requested: ${amount}`),
          { status: 422 }
        );
      }

      // Debit source
      account[fromBucket].balance          -= amount;
      account[fromBucket].totalTransferredOut += amount;

      // Credit destination
      account[toBucket].balance       += amount;
      account[toBucket].totalReceived += amount;
      account.lastActivityAt = new Date();
      await account.save({ session });

      const tx = await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'bucket_transfer',
        fromBucket,
        toBucket,
        amount,
        balanceAfter:  account.balanceSnapshot(),
        referenceType: 'system',
        description:   `Transferred ${amount} neurons from ${fromBucket.toUpperCase()} to ${toBucket.toUpperCase()}`,
      }], { session });

      await session.commitTransaction();
      return { account, transaction: tx[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // INVESTMENT
  // Neurons locked from source bucket → locked pool
  // Source bucket rules:
  //   FUN → any project
  //   CUN → research/innovation/knowledge only
  //   SUN → business/infrastructure/social only
  // ────────────────────────────────────────────────────────────────────────────

  static async investNeurons(userId, { projectId, projectName, projectType, entityType, entityName, sourceBucket, amount }) {
    // Validate bucket–project type rule
    const allowedTypes = BUCKET_PROJECT_RULES[sourceBucket];
    if (allowedTypes !== null && !allowedTypes.includes(projectType) && !allowedTypes.includes('any')) {
      throw Object.assign(
        new Error(`${sourceBucket.toUpperCase()} neurons can only be invested in ${allowedTypes.join('/')} projects. '${projectType}' is not permitted.`),
        { status: 400 }
      );
    }

    if (amount <= 0) throw Object.assign(new Error('Investment amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const account = await NeuronAccount.findOne({ userId }).session(session);
      if (!account) throw Object.assign(new Error('Neuron account not found'), { status: 404 });

      const sourceBalance = account[sourceBucket].balance;
      if (sourceBalance < amount) {
        throw Object.assign(
          new Error(`Insufficient ${sourceBucket.toUpperCase()} balance. Available: ${sourceBalance}, Requested: ${amount}`),
          { status: 422 }
        );
      }

      // Lock neurons
      account[sourceBucket].balance          -= amount;
      account[sourceBucket].totalTransferredOut += amount;
      account.lockedPool.balance             += amount;
      account.lastActivityAt = new Date();
      await account.save({ session });

      const tx = await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'investment_lock',
        fromBucket:    sourceBucket,
        toBucket:      'locked_pool',
        amount,
        balanceAfter:  account.balanceSnapshot(),
        referenceId:   projectId,
        referenceType: 'investment',
        description:   `${amount} neurons locked from ${sourceBucket.toUpperCase()} for project: ${projectName}`,
        metadata:      { projectType, entityType, entityName },
      }], { session });

      const investment = await NeuronInvestment.create([{
        userId,
        projectId,
        projectName,
        projectType,
        entityType,
        entityName,
        sourceBucket,
        amount,
        lockTxId: tx[0].txId,
        status:   'locked',
        lockedAt: new Date(),
      }], { session });

      await session.commitTransaction();
      return { account, transaction: tx[0], investment: investment[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PROJECT REWARD
  // After outcome evaluation, reward credited ONLY to My Neurons.
  // Variable, outcome-based, non-guaranteed. NOT fixed return or interest.
  // ────────────────────────────────────────────────────────────────────────────

  static async processProjectReward(investmentId, { revenue, cost, impact, rewardAmount }) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const investment = await NeuronInvestment.findById(investmentId).session(session);
      if (!investment) throw Object.assign(new Error('Investment not found'), { status: 404 });
      if (investment.status !== 'locked') throw Object.assign(new Error('Investment is not in locked state'), { status: 409 });

      const account = await NeuronAccount.findOne({ userId: investment.userId }).session(session);
      if (!account) throw Object.assign(new Error('Neuron account not found'), { status: 404 });

      rewardAmount = Math.max(0, Math.floor(rewardAmount));

      // Unlock from locked pool
      account.lockedPool.balance -= investment.amount;

      // Credit reward to My Neurons ONLY
      if (rewardAmount > 0) {
        account.myNeurons.balance    += rewardAmount;
        account.myNeurons.totalEarned += rewardAmount;
      }

      account.lastActivityAt = new Date();
      await account.save({ session });

      // Record unlock transaction
      const unlockTx = await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId:        investment.userId,
        txType:        'investment_release',
        fromBucket:    'locked_pool',
        toBucket:      'locked_pool', // neurons consumed by project, not returned
        amount:        investment.amount,
        balanceAfter:  account.balanceSnapshot(),
        referenceId:   investment._id.toString(),
        referenceType: 'project',
        description:   `Project "${investment.projectName}" completed — locked neurons consumed`,
      }], { session });

      let rewardTx = null;
      if (rewardAmount > 0) {
        rewardTx = await NeuronTransaction.create([{
          txId:          NeuronTransaction.generateTxId(),
          userId:        investment.userId,
          txType:        'project_reward',
          fromBucket:    'external',
          toBucket:      'my_neurons',
          amount:        rewardAmount,
          balanceAfter:  account.balanceSnapshot(),
          referenceId:   investment._id.toString(),
          referenceType: 'project',
          description:   `Outcome reward of ${rewardAmount} neurons credited to My Neurons (project: ${investment.projectName})`,
          metadata:      { revenue, cost, impact },
        }], { session });
      }

      investment.status      = 'completed';
      investment.outcome     = { revenue, cost, impact, evaluatedAt: new Date() };
      investment.rewardAmount = rewardAmount;
      investment.rewardTxId  = rewardTx ? rewardTx[0].txId : null;
      investment.rewardedAt  = new Date();
      investment.completedAt = new Date();
      await investment.save({ session });

      await session.commitTransaction();
      return { account, investment, rewardTx: rewardTx?.[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // WORK REWARD
  // Work/task completion → My Neurons ONLY
  // ────────────────────────────────────────────────────────────────────────────

  static async creditWorkReward(userId, amount, description, referenceId = null, referenceType = 'work') {
    if (amount <= 0) throw Object.assign(new Error('Reward amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const account = await NeuronService.getOrCreateAccount(userId);
      account.myNeurons.balance    += amount;
      account.myNeurons.totalEarned += amount;
      account.lastActivityAt = new Date();
      await account.save({ session });

      const tx = await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'work_reward',
        fromBucket:    'external',
        toBucket:      'my_neurons',
        amount,
        balanceAfter:  account.balanceSnapshot(),
        referenceId,
        referenceType,
        description:   description || `Work reward: ${amount} neurons credited to My Neurons`,
      }], { session });

      await session.commitTransaction();
      return { account, transaction: tx[0] };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MONTHLY ALLOCATION ENGINE
  // Last day of month, 12:00 midnight:
  //   T = My Neurons balance
  //   User 99%: 33% FUN + 33% CUN + 33% SUN
  //   Ceekul 1%: 33% FUN + 33% CUN + 34% SUN
  //   My Neurons → 0 after distribution
  // ────────────────────────────────────────────────────────────────────────────

  static async runMonthlyAllocation(userId, ceekulAccountId = null) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const account = await NeuronAccount.findOne({ userId }).session(session);
      if (!account) throw Object.assign(new Error('Neuron account not found'), { status: 404 });

      const T = account.myNeurons.balance;
      if (T === 0) {
        await session.abortTransaction();
        return { skipped: true, reason: 'My Neurons balance is zero' };
      }

      const userTotal   = Math.floor(T * USER_SHARE);
      const ceekulTotal = T - userTotal; // avoids floating point rounding

      // User's share: 33/33/33 split of 99%
      const userFun = Math.floor(userTotal * USER_RATIOS.fun);
      const userCun = Math.floor(userTotal * USER_RATIOS.cun);
      const userSun = userTotal - userFun - userCun; // remainder to avoid precision loss

      // Ceekul's share: 33/33/34 split of 1%
      const ceekulFun = Math.floor(ceekulTotal * CEEKUL_RATIOS.fun);
      const ceekulCun = Math.floor(ceekulTotal * CEEKUL_RATIOS.cun);
      const ceekulSun = ceekulTotal - ceekulFun - ceekulCun;

      // Debit My Neurons fully
      account.myNeurons.totalAllocatedOut += T;
      account.myNeurons.balance = 0;

      // Credit user's FUN/CUN/SUN
      account.fun.balance       += userFun;
      account.fun.totalReceived += userFun;
      account.cun.balance       += userCun;
      account.cun.totalReceived += userCun;
      account.sun.balance       += userSun;
      account.sun.totalReceived += userSun;

      account.monthlyAllocationLastRun = new Date();
      account.lastActivityAt = new Date();
      await account.save({ session });

      // Record user's allocation transaction
      await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'monthly_allocation_user',
        fromBucket:    'my_neurons',
        toBucket:      'fun',  // primary bucket (distribution documented in metadata)
        amount:        userTotal,
        balanceAfter:  account.balanceSnapshot(),
        referenceType: 'monthly_allocation',
        description:   `Monthly allocation: ${userFun} → FUN, ${userCun} → CUN, ${userSun} → SUN`,
        metadata:      { userFun, userCun, userSun, ceekulFun, ceekulCun, ceekulSun, totalT: T },
      }], { session });

      // Handle Ceekul's share (credit to platform account if provided)
      if (ceekulAccountId && ceekulTotal > 0) {
        const ceekulAcc = await NeuronAccount.findOne({ userId: ceekulAccountId }).session(session);
        if (ceekulAcc) {
          ceekulAcc.fun.balance       += ceekulFun;
          ceekulAcc.fun.totalReceived += ceekulFun;
          ceekulAcc.cun.balance       += ceekulCun;
          ceekulAcc.cun.totalReceived += ceekulCun;
          ceekulAcc.sun.balance       += ceekulSun;
          ceekulAcc.sun.totalReceived += ceekulSun;
          await ceekulAcc.save({ session });
        }
      }

      await session.commitTransaction();
      return {
        T,
        userFun, userCun, userSun,
        ceekulFun, ceekulCun, ceekulSun,
        account,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SUPPORT (Debt System)
  // Max 100,000 neurons, valid 6 months
  // Repaid via work rewards or contributions
  // ────────────────────────────────────────────────────────────────────────────

  static async borrowSupport(userId, amount, description = '') {
    if (amount <= 0) throw Object.assign(new Error('Support amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const account = await NeuronService.getOrCreateAccount(userId);
    const currentDebt = account.support.currentDebt ?? 0;
    if (currentDebt + amount > MAX_SUPPORT) {
      throw Object.assign(
        new Error(`Support limit exceeded. Current debt: ${currentDebt}, Max: ${MAX_SUPPORT}`),
        { status: 422 }
      );
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      account.fun.balance       += amount;
      account.fun.totalReceived += amount;
      account.support.currentDebt = currentDebt + amount;
      account.support.borrowedAt  = account.support.borrowedAt ?? new Date();
      account.support.expiresAt   = new Date(Date.now() + SUPPORT_VALIDITY_MONTHS * 30 * 24 * 60 * 60 * 1000);
      account.lastActivityAt = new Date();
      await account.save({ session });

      await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'support_borrow',
        fromBucket:    'external',
        toBucket:      'fun',
        amount,
        balanceAfter:  account.balanceSnapshot(),
        referenceType: 'support',
        description:   description || `Support borrow: ${amount} neurons credited to FUN (debt: ${account.support.currentDebt})`,
      }], { session });

      await session.commitTransaction();
      return account;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  static async repaySupport(userId, amount, fromBucket = 'fun') {
    if (amount <= 0) throw Object.assign(new Error('Repayment amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const account = await NeuronAccount.findOne({ userId }).session(session);
      if (!account) throw Object.assign(new Error('Neuron account not found'), { status: 404 });

      const debt = account.support.currentDebt ?? 0;
      if (debt === 0) throw Object.assign(new Error('No support debt to repay'), { status: 400 });

      const repayAmount = Math.min(amount, debt);
      if (account[fromBucket].balance < repayAmount) {
        throw Object.assign(new Error(`Insufficient ${fromBucket.toUpperCase()} balance to repay support`), { status: 422 });
      }

      account[fromBucket].balance -= repayAmount;
      account.support.currentDebt -= repayAmount;
      if (account.support.currentDebt === 0) {
        account.support.borrowedAt = undefined;
        account.support.expiresAt  = undefined;
      }
      account.lastActivityAt = new Date();
      await account.save({ session });

      await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'support_repay',
        fromBucket,
        toBucket:      'external',
        amount:        repayAmount,
        balanceAfter:  account.balanceSnapshot(),
        referenceType: 'support',
        description:   `Support repayment: ${repayAmount} neurons from ${fromBucket.toUpperCase()} (remaining debt: ${account.support.currentDebt})`,
      }], { session });

      await session.commitTransaction();
      return account;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // EXPIRY RULE
  // Unused neurons (no activity for 6 months) → Ceegroup1
  // ────────────────────────────────────────────────────────────────────────────

  static async processExpiry(userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const account = await NeuronAccount.findOne({ userId }).session(session);
      if (!account) { await session.abortTransaction(); return null; }

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - EXPIRY_MONTHS);

      if (account.lastActivityAt > cutoff) {
        await session.abortTransaction();
        return { expired: false };
      }

      const totalToExpire = account.fun.balance + account.cun.balance + account.sun.balance;
      if (totalToExpire === 0) {
        await session.abortTransaction();
        return { expired: false };
      }

      const expiredFun = account.fun.balance;
      const expiredCun = account.cun.balance;
      const expiredSun = account.sun.balance;

      account.fun.balance = 0;
      account.cun.balance = 0;
      account.sun.balance = 0;
      await account.save({ session });

      await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId,
        txType:        'expiry',
        fromBucket:    'fun',
        toBucket:      'ceegroup1',
        amount:        totalToExpire,
        balanceAfter:  account.balanceSnapshot(),
        referenceType: 'expiry',
        description:   `Neurons expired after ${EXPIRY_MONTHS} months of inactivity — transferred to Ceegroup1`,
        metadata:      { expiredFun, expiredCun, expiredSun },
      }], { session });

      await session.commitTransaction();
      return { expired: true, totalToExpire, expiredFun, expiredCun, expiredSun };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SPONSORSHIP
  // Mandatory: sponsor at least 1 younger member using FUN or SUN
  // ────────────────────────────────────────────────────────────────────────────

  static async sponsorUser(sponsorId, beneficiaryId, amount, sourceBucket = 'fun') {
    if (!['fun', 'sun'].includes(sourceBucket)) {
      throw Object.assign(new Error('Sponsorship can only use FUN or SUN neurons'), { status: 400 });
    }
    if (amount <= 0) throw Object.assign(new Error('Sponsorship amount must be positive'), { status: 400 });
    amount = Math.floor(amount);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const sponsorAccount = await NeuronAccount.findOne({ userId: sponsorId }).session(session);
      if (!sponsorAccount) throw Object.assign(new Error('Sponsor neuron account not found'), { status: 404 });

      if (sponsorAccount[sourceBucket].balance < amount) {
        throw Object.assign(new Error(`Insufficient ${sourceBucket.toUpperCase()} balance for sponsorship`), { status: 422 });
      }

      // Debit sponsor
      sponsorAccount[sourceBucket].balance          -= amount;
      sponsorAccount[sourceBucket].totalTransferredOut += amount;
      sponsorAccount.lastActivityAt = new Date();
      await sponsorAccount.save({ session });

      // Credit beneficiary's FUN
      const beneficiaryAccount = await NeuronService.getOrCreateAccount(beneficiaryId);
      beneficiaryAccount.fun.balance       += amount;
      beneficiaryAccount.fun.totalReceived += amount;
      await beneficiaryAccount.save({ session });

      // Record for sponsor
      await NeuronTransaction.create([{
        txId:          NeuronTransaction.generateTxId(),
        userId:        sponsorId,
        txType:        'sponsorship',
        fromBucket:    sourceBucket,
        toBucket:      'external',
        amount,
        balanceAfter:  sponsorAccount.balanceSnapshot(),
        referenceId:   beneficiaryId.toString(),
        referenceType: 'sponsorship',
        description:   `Sponsorship: ${amount} neurons from ${sourceBucket.toUpperCase()} gifted to beneficiary`,
      }], { session });

      await session.commitTransaction();
      return { sponsorAccount, beneficiaryAccount };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ────────────────────────────────────────────────────────────────────────────

  static async getTransactions(userId, { limit = 50, offset = 0, txType } = {}) {
    const query = { userId };
    if (txType) query.txType = txType;

    const [items, total] = await Promise.all([
      NeuronTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      NeuronTransaction.countDocuments(query),
    ]);
    return { items, total };
  }

  static async getContributions(userId, { limit = 20, offset = 0, status } = {}) {
    const query = { userId };
    if (status) query.status = status;
    const [items, total] = await Promise.all([
      NeuronContribution.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      NeuronContribution.countDocuments(query),
    ]);
    return { items, total };
  }

  static async getInvestments(userId, { limit = 20, offset = 0, status } = {}) {
    const query = { userId };
    if (status) query.status = status;
    const [items, total] = await Promise.all([
      NeuronInvestment.find(query).sort({ lockedAt: -1 }).skip(offset).limit(limit).lean(),
      NeuronInvestment.countDocuments(query),
    ]);
    return { items, total };
  }
}

module.exports = NeuronService;
