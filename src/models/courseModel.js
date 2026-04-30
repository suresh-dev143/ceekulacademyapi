const mongoose = require('mongoose');
const slugify = require('slugify');

// Lesson sub-schema
const lessonSchema = new mongoose.Schema({
  lessonTitle: {
    type: String,
    required: [true, 'Lesson title is required'],
    trim: true,
    maxlength: [200, 'Lesson title cannot exceed 200 characters']
  },
  lessonOrder: {
    type: Number,
    required: true,
    min: 1
  },
  lessonType: {
    type: String,
    enum: ['Video', 'PDF', 'Quiz', 'Assignment', 'Text', 'Live'],
    required: true
  },
  resourceUrl: {
    type: String,
    trim: true
  },
  duration: {
    type: Number, // Duration in minutes
    default: 0
  },
  isPreview: {
    type: Boolean,
    default: false
  },
  isPublished: {
    type: Boolean,
    default: false
  }
}, { _id: true });

// Module/Section sub-schema
const moduleSchema = new mongoose.Schema({
  moduleTitle: {
    type: String,
    required: [true, 'Module title is required'],
    trim: true,
    maxlength: [200, 'Module title cannot exceed 200 characters']
  },
  moduleOrder: {
    type: Number,
    required: true,
    min: 1
  },
  moduleDescription: {
    type: String,
    maxlength: [500, 'Module description cannot exceed 500 characters']
  },
  lessons: [lessonSchema]
}, { _id: true });

// Discount sub-schema
const discountSchema = new mongoose.Schema({
  discountType: {
    type: String,
    enum: ['Percentage', 'Flat'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: [0, 'Discount cannot be negative']
  },
  validFrom: {
    type: Date,
    default: Date.now
  },
  validTill: {
    type: Date,
    required: true
  },
  couponCode: {
    type: String,
    uppercase: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: false });

// Reviewer sub-schema
const reviewerSchema = new mongoose.Schema({
  reviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  reviewerRole: {
    type: String,
    enum: ['Admin', 'Manager'],
    required: true
  },
  reviewedAt: {
    type: Date,
    default: Date.now
  },
  remarks: {
    type: String,
    maxlength: [1000, 'Remarks cannot exceed 1000 characters']
  },
  action: {
    type: String,
    enum: ['Approved', 'Rejected', 'RequestChanges'],
    required: true
  }
}, { _id: false });

// Main Course Schema
const courseSchema = new mongoose.Schema({
  // ==================== OWNERSHIP & GOVERNANCE ====================
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher ID is required'],
    immutable: true // Cannot be changed after creation
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // ==================== COURSE IDENTITY ====================
  courseTitle: {
    type: String,
    required: [true, 'Course title is required'],
    trim: true,
    maxlength: [200, 'Course title cannot exceed 200 characters']
  },
  courseSlug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  courseDescription: {
    type: String,
    required: [true, 'Course description is required'],
    maxlength: [5000, 'Course description cannot exceed 5000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [300, 'Short description cannot exceed 300 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
    index: true
  },
  subCategory: {
    type: String,
    trim: true
  },
  level: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced', 'AllLevels'],
    required: [true, 'Course level is required']
  },
  language: {
    type: String,
    default: 'English',
    trim: true
  },

  // ==================== ACADEMIC STRUCTURE ====================
  duration: {
    type: Number, // Total duration in hours
    required: [true, 'Course duration is required'],
    min: [0.5, 'Course duration must be at least 30 minutes']
  },
  syllabus: [moduleSchema],
  prerequisites: [{
    type: String,
    trim: true
  }],
  learningOutcomes: [{
    type: String,
    trim: true
  }],
  targetAudience: [{
    type: String,
    trim: true
  }],

  // ==================== PRICING & MONETIZATION ====================
  pricingType: {
    type: String,
    enum: ['Free', 'Paid'],
    required: [true, 'Pricing type is required']
  },
  price: {
    type: Number,
    min: [0, 'Price cannot be negative'],
    validate: {
      validator: function (value) {
        // Price is required only if pricingType is 'Paid'
        if (this.pricingType === 'Paid') {
          return value !== undefined && value > 0;
        }
        return true;
      },
      message: 'Price is required for paid courses and must be greater than 0'
    }
  },
  currency: {
    type: String,
    default: 'Neutron', // Platform currency
    enum: ['Neutron', 'INR', 'USD']
  },
  discount: discountSchema,
  revenueShare: {
    teacherPercentage: {
      type: Number,
      default: 70,
      min: 0,
      max: 100
    },
    platformPercentage: {
      type: Number,
      default: 30,
      min: 0,
      max: 100
    }
  },

  // ==================== MEDIA ASSETS ====================
  thumbnailUrl: {
    type: String,
    required: [true, 'Thumbnail is required']
  },
  introVideoUrl: {
    type: String
  },
  bannerUrl: {
    type: String
  },

  // ==================== ENROLLMENT & CAPACITY ====================
  maxStudents: {
    type: Number,
    min: [1, 'Max students must be at least 1']
  },
  enrolledCount: {
    type: Number,
    default: 0,
    min: 0
  },
  completionCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // ==================== QUALITY & COMPLIANCE ====================
  courseStatus: {
    type: String,
    enum: ['Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Published', 'Unpublished', 'Archived'],
    default: 'Draft',
    index: true
  },
  reviewHistory: [reviewerSchema],
  lastReviewedBy: reviewerSchema,
  rejectionReason: {
    type: String,
    maxlength: [1000, 'Rejection reason cannot exceed 1000 characters']
  },

  // ==================== ANALYTICS & SIGNALS ====================
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  ratingCount: {
    type: Number,
    default: 0,
    min: 0
  },
  ratingBreakdown: {
    five: { type: Number, default: 0 },
    four: { type: Number, default: 0 },
    three: { type: Number, default: 0 },
    two: { type: Number, default: 0 },
    one: { type: Number, default: 0 }
  },
  viewCount: {
    type: Number,
    default: 0
  },
  wishlistCount: {
    type: Number,
    default: 0
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  // ==================== SYSTEM METADATA ====================
  publishedAt: {
    type: Date
  },
  submittedAt: {
    type: Date
  },
  lastUpdatedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  version: {
    type: Number,
    default: 1
  },

  // ==================== FUTURE COMPATIBILITY ====================
  certificateEnabled: {
    type: Boolean,
    default: false
  },
  certificateTemplateId: {
    type: mongoose.Schema.Types.ObjectId
  },
  liveClassEnabled: {
    type: Boolean,
    default: false
  },
  bundleIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CourseBundle'
  }],

  // ==================== GLOBAL DISPATCHER ====================
  // Linked Atomic Content references (Atomic Identity Engine)
  linkedAtomicContent: [{
    contentId: { type: String, required: true },
    role: { type: String, required: true },
    metadata: mongoose.Schema.Types.Mixed,
    addedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  collection: 'courses'
});

// ==================== INDEXES ====================
courseSchema.index({ courseTitle: 'text', courseDescription: 'text', tags: 'text' });
courseSchema.index({ teacherId: 1 });
courseSchema.index({ category: 1, subCategory: 1 });
courseSchema.index({ courseStatus: 1, isActive: 1 });
courseSchema.index({ pricingType: 1 });
courseSchema.index({ rating: -1 });
courseSchema.index({ enrolledCount: -1 });
courseSchema.index({ publishedAt: -1 });
courseSchema.index({ createdAt: -1 });
courseSchema.index({ tags: 1 });
courseSchema.index({ level: 1 });

// ==================== PRE-SAVE MIDDLEWARE ====================
courseSchema.pre('save', async function () {
  // Auto-generate slug from title
  if (this.isModified('courseTitle') || !this.courseSlug) {
    let baseSlug = slugify(this.courseTitle, {
      lower: true,
      strict: true,
      trim: true
    });

    // Ensure uniqueness by appending timestamp if needed
    let slug = baseSlug;
    let counter = 1;

    while (await mongoose.model('Course').findOne({ courseSlug: slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.courseSlug = slug;
  }

  // Set lastUpdatedAt
  this.lastUpdatedAt = new Date();

  // Calculate total duration from syllabus
  if (this.syllabus && this.syllabus.length > 0) {
    let totalMinutes = 0;
    this.syllabus.forEach(module => {
      if (module.lessons) {
        module.lessons.forEach(lesson => {
          totalMinutes += lesson.duration || 0;
        });
      }
    });
    // Convert to hours (round to 1 decimal)
    this.duration = Math.round((totalMinutes / 60) * 10) / 10;
  }

});

// ==================== INSTANCE METHODS ====================
courseSchema.methods.submitForReview = async function () {
  if (this.courseStatus !== 'Draft' && this.courseStatus !== 'Rejected') {
    throw new Error('Only draft or rejected courses can be submitted for review');
  }

  // Validate minimum requirements
  if (!this.syllabus || this.syllabus.length === 0) {
    throw new Error('Course must have at least one module');
  }

  const totalLessons = this.syllabus.reduce((acc, mod) => acc + (mod.lessons?.length || 0), 0);
  if (totalLessons === 0) {
    throw new Error('Course must have at least one lesson');
  }

  this.courseStatus = 'Submitted';
  this.submittedAt = new Date();
  return this.save();
};

courseSchema.methods.approve = async function (reviewerId, reviewerRole, remarks = '') {
  if (this.courseStatus !== 'Submitted' && this.courseStatus !== 'UnderReview') {
    throw new Error('Only submitted courses can be approved');
  }

  const review = {
    reviewerId,
    reviewerRole,
    reviewedAt: new Date(),
    remarks,
    action: 'Approved'
  };

  this.reviewHistory.push(review);
  this.lastReviewedBy = review;
  this.courseStatus = 'Approved';
  this.rejectionReason = undefined;

  return this.save();
};

courseSchema.methods.reject = async function (reviewerId, reviewerRole, reason) {
  if (this.courseStatus !== 'Submitted' && this.courseStatus !== 'UnderReview') {
    throw new Error('Only submitted courses can be rejected');
  }

  if (!reason) {
    throw new Error('Rejection reason is required');
  }

  const review = {
    reviewerId,
    reviewerRole,
    reviewedAt: new Date(),
    remarks: reason,
    action: 'Rejected'
  };

  this.reviewHistory.push(review);
  this.lastReviewedBy = review;
  this.courseStatus = 'Rejected';
  this.rejectionReason = reason;

  return this.save();
};

courseSchema.methods.publish = async function () {
  if (this.courseStatus !== 'Approved') {
    throw new Error('Only approved courses can be published');
  }

  this.courseStatus = 'Published';
  this.publishedAt = new Date();
  this.isActive = true;

  return this.save();
};

courseSchema.methods.unpublish = async function () {
  if (this.courseStatus !== 'Published') {
    throw new Error('Only published courses can be unpublished');
  }

  this.courseStatus = 'Unpublished';
  this.isActive = false;

  return this.save();
};

courseSchema.methods.archive = async function () {
  this.courseStatus = 'Archived';
  this.isActive = false;
  return this.save();
};

courseSchema.methods.incrementEnrollment = async function () {
  this.enrolledCount += 1;
  return this.save();
};

courseSchema.methods.updateRating = async function (newRating) {
  const oldTotal = this.rating * this.ratingCount;
  this.ratingCount += 1;
  this.rating = (oldTotal + newRating) / this.ratingCount;

  // Update breakdown
  const ratingKey = ['one', 'two', 'three', 'four', 'five'][Math.floor(newRating) - 1];
  if (ratingKey) {
    this.ratingBreakdown[ratingKey] += 1;
  }

  return this.save();
};

courseSchema.methods.getEffectivePrice = function () {
  if (this.pricingType === 'Free') return 0;

  if (!this.discount || !this.discount.isActive) return this.price;

  const now = new Date();
  if (now < this.discount.validFrom || now > this.discount.validTill) {
    return this.price;
  }

  if (this.discount.discountType === 'Percentage') {
    return this.price * (1 - this.discount.discountValue / 100);
  }

  return Math.max(0, this.price - this.discount.discountValue);
};

// ==================== STATIC METHODS ====================
courseSchema.statics.findPublishedCourses = function (filters = {}) {
  return this.find({
    courseStatus: 'Published',
    isActive: true,
    ...filters
  });
};

courseSchema.statics.findByTeacher = function (teacherId) {
  return this.find({ teacherId });
};

courseSchema.statics.findByCategory = function (category, subCategory = null) {
  const filter = { category, courseStatus: 'Published', isActive: true };
  if (subCategory) filter.subCategory = subCategory;
  return this.find(filter);
};

courseSchema.statics.findPendingReview = function () {
  return this.find({
    courseStatus: { $in: ['Submitted', 'UnderReview'] }
  }).sort({ submittedAt: 1 });
};

courseSchema.statics.searchCourses = function (query, filters = {}) {
  const searchFilter = {
    $text: { $search: query },
    courseStatus: 'Published',
    isActive: true,
    ...filters
  };

  return this.find(searchFilter, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } });
};

// ==================== VIRTUALS ====================
courseSchema.virtual('totalLessons').get(function () {
  if (!this.syllabus) return 0;
  return this.syllabus.reduce((acc, module) => acc + (module.lessons?.length || 0), 0);
});

courseSchema.virtual('totalModules').get(function () {
  return this.syllabus?.length || 0;
});

courseSchema.virtual('isEnrollable').get(function () {
  if (this.courseStatus !== 'Published' || !this.isActive) return false;
  if (this.maxStudents && this.enrolledCount >= this.maxStudents) return false;
  return true;
});

// Ensure virtuals are included in JSON
courseSchema.set('toJSON', { virtuals: true });
courseSchema.set('toObject', { virtuals: true });

const Course = mongoose.model('Course', courseSchema);
module.exports = Course;
