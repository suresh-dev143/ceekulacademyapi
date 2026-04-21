/**
 * CEEGROUP MODEL
 * =====================================================================
 * A CEEGROUP is a collective entity with a unique 15-digit ID.
 * Members contribute neurons from their personal FUN/CUN/SUN to the
 * group's corresponding buckets. The group can send service payments
 * and receive neurons into its Group Neurons bucket.
 *
 * CEEGROUP IDs are 15 digits (vs CEEBRAIN IDs which are 12 digits).
 * The system uses ID length to determine entity type.
 * =====================================================================
 */
const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const bucketStateSchema = new mongoose.Schema({
  balance:             { type: Number, default: 0, min: 0 },
  totalReceived:       { type: Number, default: 0 },
  totalTransferredOut: { type: Number, default: 0 },
}, { _id: false });

const ceegroupSchema = new mongoose.Schema(
  {
    // 15-digit numeric ID — generated at creation, immutable
    ceegroupId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
      trim:     true,
      match:    [/^\d{15}$/, 'CEEGROUP ID must be exactly 15 digits'],
    },

    name:        { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', trim: true, maxlength: 500 },

    createdBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    members: { type: [memberSchema], default: [] },

    // ── Neuron Buckets (sending layer — filled by member deposits) ──────
    fun: { type: bucketStateSchema, default: () => ({}) },
    cun: { type: bucketStateSchema, default: () => ({}) },
    sun: { type: bucketStateSchema, default: () => ({}) },

    // ── Group Neurons (receiving layer — credited from service payments) ─
    groupNeurons: {
      balance:       { type: Number, default: 0, min: 0 },
      totalReceived: { type: Number, default: 0 },
    },

    isActive:       { type: Boolean, default: true },
    lastActivityAt: { type: Date,    default: Date.now },
  },
  {
    timestamps: true,
    collection: 'ceegroups',
  }
);

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * Generates a unique 15-digit numeric ID for a new CEEGROUP.
 * Prefix '5' distinguishes from CEEBRAIN IDs (12 digits, any prefix).
 */
ceegroupSchema.statics.generateId = async function () {
  let id;
  let exists = true;
  while (exists) {
    id = '5';
    for (let i = 0; i < 14; i++) id += Math.floor(Math.random() * 10).toString();
    exists = !!(await this.findOne({ ceegroupId: id }).lean());
  }
  return id;
};

// ── Instance methods ──────────────────────────────────────────────────────────

ceegroupSchema.methods.isMember = function (userId) {
  return this.members.some(m => m.userId.toString() === userId.toString());
};

ceegroupSchema.methods.isAdmin = function (userId) {
  return this.members.some(
    m => m.userId.toString() === userId.toString() && m.role === 'admin'
  );
};

/** Balance snapshot for ledger entries */
ceegroupSchema.methods.balanceSnapshot = function () {
  return {
    fun:          this.fun.balance,
    cun:          this.cun.balance,
    sun:          this.sun.balance,
    groupNeurons: this.groupNeurons.balance,
  };
};

ceegroupSchema.index({ createdBy: 1 });
ceegroupSchema.index({ 'members.userId': 1 });

module.exports = mongoose.model('Ceegroup', ceegroupSchema);
