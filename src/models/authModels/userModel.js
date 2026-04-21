const mongoose = require("mongoose");
const bcrypt = require('bcrypt');
const {
  SELECTED_ROLES,
  PARTNER_TYPES,
  GENDERS,
  ACTIVITY_TYPES,
  MODE_OPTIONS,
  EXPERT_TYPES,
  AUTH_PROVIDERS,
  USER_STATUSES,
  VERIFICATION_STATUSES,
} = require('../../constants/userConstants');

// Verifier sub-schema
const verifierSchema = new mongoose.Schema({
  verifierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null  // null when auto-verified by system
  },
  verifierRole: {
    type: String,
    enum: ['Manager', 'Director', 'Admin', 'System'],
    default: 'System'
  },
  verifiedAt: {
    type: Date
  }
}, { _id: false });

// Address sub-schema
const addressSchema = new mongoose.Schema({
  addressLine1: {
    type: String,
    trim: true,
    maxlength: [200, 'Address Line 1 cannot exceed 200 characters']
  },
  addressLine2: {
    type: String,
    trim: true,
    maxlength: [200, 'Address Line 2 cannot exceed 200 characters']
  },
  landmark: {
    type: String,
    trim: true,
    maxlength: [200, 'Landmark cannot exceed 200 characters']
  },
  city: {
    type: String,
    trim: true,
    maxlength: [100, 'City cannot exceed 100 characters']
  },
  district: {
    type: String,
    trim: true,
    maxlength: [100, 'District cannot exceed 100 characters']
  },
  state: {
    type: String,
    trim: true,
    maxlength: [100, 'State cannot exceed 100 characters']
  },
  country: {
    type: String,
    trim: true,
    default: 'India',
    maxlength: [100, 'Country cannot exceed 100 characters']
  },
  pincode: {
    type: String,
    trim: true,
    validate: {
      validator: function (value) {
        return !value || /^[0-9]{6}$/.test(value);
      },
      message: 'Invalid pincode format (must be 6 digits)'
    }
  }
}, { _id: false });

// Main User Schema
const userSchema = new mongoose.Schema(
  {
    // ==================== AUTHENTICATION ====================
    phone: {
      type: String,
      unique: true,
      sparse: true,
      validate: {
        validator: function (v) {
          return /^\+?[1-9]\d{6,14}$/.test(v);
        },
        message: 'Invalid phone number'
      }
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
        },
        message: '{VALUE} is not a valid email'
      }
    },
    password: {
      type: String,
      select: false
    },
    authProvider: {
      type: String,
      enum: AUTH_PROVIDERS,
      required: true
    },

    // ==================== CEEBRAIN ID ====================
    ceebrainId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    // ==================== CORE IDENTITY ====================
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    dateOfBirth: {
      type: Date,
    },
    placeOfBirth: {
      type: String,
      trim: true,
      maxlength: [200, 'Place of birth cannot exceed 200 characters']
    },
    identity: {
      type: String,
      enum: ['homo_sapiens', 'others'],
    },
    gender: {
      type: String,
      enum: GENDERS,
    },
    bplCategory: {
      type: String,
      enum: ['yes', 'no'],
    },
    underprivilegedCategory: {
      type: String,
      enum: ['yes', 'no'],
    },
    profileImage: {
      type: String,
      default: ''
    },

    // ==================== ADDRESS & LOCATION ====================
    address: {
      type: addressSchema,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
      }
    },

    // ==================== ROLE & CLASSIFICATION ====================
    partnerType: {
      type: String,
      enum: PARTNER_TYPES
    },

    // ==================== ACTIVITY & PREFERENCES ====================
    activityType: [{
      type: String,
      enum: ACTIVITY_TYPES
    }],
    modeOptions: [{
      type: String,
      enum: MODE_OPTIONS
    }],
    expertTypes: [{
      type: String,
      enum: EXPERT_TYPES
    }],

    role: {
      type: String,
      enum: ['partner', 'teacher', 'student', 'admin', 'superadmin', 'Partner', 'Teacher', 'Student'],
      default: 'student'
    },

    selectedRole: {
      type: String,
      enum: SELECTED_ROLES,
      required: [true, 'Selected role is required']
    },

    // ==================== VERIFICATION ====================
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'Pending'
    },
    phoneVerified: {
      type: Boolean,
      default: false
    },
    emailVerified: {
      type: Boolean,
      default: false
    },
    verifiedBy: verifierSchema,

    // ==================== SYSTEM CONTROLS ====================
    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'Active'
    },
    lastLoginAt: {
      type: Date
    },
    loginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: {
      type: Date
    },

    // ==================== NEUTRON WALLET ====================
    wallet: {
      neutronBalance: {
        type: Number,
        default: 0,
        min: [0, 'Balance cannot be negative']
      },
      lockedNeutrons: {
        type: Number,
        default: 0,
        min: [0, 'Locked balance cannot be negative']
      },
      totalEarned: {
        type: Number,
        default: 0
      },
      totalSpent: {
        type: Number,
        default: 0
      },
      lastTransactionAt: {
        type: Date
      }
    },

    // ==================== TEACHER PROFILE ====================
    teacherProfile: {
      bio: {
        type: String,
        maxlength: [1000, 'Bio cannot exceed 1000 characters']
      },
      qualification: {
        type: String,
        maxlength: [500, 'Qualification cannot exceed 500 characters']
      },
      expertise: [{
        type: String,
        trim: true
      }],
      experience: {
        type: Number,
        min: 0
      },
      totalCourses: {
        type: Number,
        default: 0
      },
      totalStudents: {
        type: Number,
        default: 0
      },
      averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      totalReviews: {
        type: Number,
        default: 0
      },
      payoutDetails: {
        accountHolderName: String,
        bankName: String,
        accountNumber: String,
        ifscCode: String,
        upiId: String
      },
      teacherVerifiedAt: {
        type: Date
      }
    }
  },
  {
    timestamps: true,
    collection: 'users'
  }
);

// phone and email are already indexed via unique:true+sparse:true on the field definition
userSchema.index({ location: '2dsphere' });
userSchema.index({ 'address.pincode': 1 });
userSchema.index({ 'address.district': 1 });
userSchema.index({ 'address.city': 1 });
userSchema.index({ verificationStatus: 1 });
userSchema.index({ status: 1 });

// ==================== VALIDATION ====================
userSchema.pre('validate', function () {
  if (!this.phone && !this.email) {
    this.invalidate('phone', 'At least one authentication method (phone or email) is required');
  }

  if (this.email && this.authProvider !== 'MOBILE_OTP' && !this.password) {
    this.invalidate('password', 'Password is required for email authentication');
  }

  if (this.authProvider === 'MOBILE_PASSWORD' && !this.password) {
    this.invalidate('password', 'Password is required for mobile+password authentication');
  }
});

// ==================== PASSWORD HASHING ====================
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// ==================== INSTANCE METHODS ====================
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

userSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= 5) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLoginAt: new Date() },
    $unset: { lockUntil: 1 }
  });
};

// ==================== STATIC METHODS ====================
userSchema.statics.findByMobile = function (phone) {
  return this.findOne({ phone, status: { $ne: 'Suspended' } });
};

userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase(), status: { $ne: 'Suspended' } });
};

userSchema.statics.findVerifiedTeachers = function () {
  return this.find({
    verificationStatus: 'Verified',
    status: 'Active'
  });
};

userSchema.statics.isEligibleTeacher = async function (userId) {
  const user = await this.findById(userId);
  if (!user) return false;
  return user.status === 'Active';
};

// ==================== WALLET METHODS ====================
userSchema.methods.addNeutrons = async function (amount, description = '') {
  if (amount <= 0) throw new Error('Amount must be positive');
  this.wallet.neutronBalance += amount;
  this.wallet.totalEarned += amount;
  this.wallet.lastTransactionAt = new Date();
  return this.save();
};

userSchema.methods.deductNeutrons = async function (amount, description = '') {
  if (amount <= 0) throw new Error('Amount must be positive');
  if (this.wallet.neutronBalance < amount) {
    throw new Error('Insufficient neutron balance');
  }
  this.wallet.neutronBalance -= amount;
  this.wallet.totalSpent += amount;
  this.wallet.lastTransactionAt = new Date();
  return this.save();
};

userSchema.methods.lockNeutrons = async function (amount) {
  if (amount <= 0) throw new Error('Amount must be positive');
  if (this.wallet.neutronBalance < amount) {
    throw new Error('Insufficient neutron balance to lock');
  }
  this.wallet.neutronBalance -= amount;
  this.wallet.lockedNeutrons += amount;
  return this.save();
};

userSchema.methods.unlockNeutrons = async function (amount) {
  if (amount <= 0) throw new Error('Amount must be positive');
  if (this.wallet.lockedNeutrons < amount) {
    throw new Error('Insufficient locked neutrons');
  }
  this.wallet.lockedNeutrons -= amount;
  this.wallet.neutronBalance += amount;
  return this.save();
};

const User = mongoose.model('User', userSchema);
module.exports = User;
