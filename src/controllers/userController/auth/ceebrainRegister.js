const mongoose = require('mongoose');
const { User } = require('../../../models/authModels');
const { generateToken } = require('../../../utils/generateToken');

const SEQ_KEY   = 'ceebrain_user';
const SEQ_START = 100_000_000_001;

const sequenceSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'id_sequences' }
);
const Sequence = mongoose.models.IdSequence ?? mongoose.model('IdSequence', sequenceSchema);

const GENDER_MAP = {
  male: 'Male',
  female: 'Female',
  transgender: 'Transgender',
};

const ceebrainRegister = async (req, res) => {
  try {
    const {
      mobileNo,
      dateOfBirth,
      placeOfBirth,
      identity,
      gender,
      bplCategory,
      underprivilegedCategory,
      password,
      agreeToFramework,
    } = req.body;

    if (!mobileNo || !password) {
      return res.status(400).json({
        status: false,
        message: 'mobileNo and password are required',
      });
    }

    if (!agreeToFramework) {
      return res.status(400).json({
        status: false,
        message: 'You must agree to the self regulatory framework',
      });
    }

    const phoneExists = await User.findOne({ phone: mobileNo });
    if (phoneExists) {
      return res.status(409).json({ status: false, message: 'Mobile number already registered' });
    }

    const seqDoc = await Sequence.findOneAndUpdate(
      { _id: SEQ_KEY },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const ceebrainId = (SEQ_START - 1 + seqDoc.seq).toString();

    const normalizedGender = GENDER_MAP[gender?.toLowerCase()] ?? undefined;

    const user = new User({
      phone: mobileNo,
      password,
      authProvider: 'MOBILE_PASSWORD',
      name: `Ceebrain-${ceebrainId}`,
      selectedRole: 'Student',
      ceebrainId,
      dateOfBirth: dateOfBirth || undefined,
      placeOfBirth: placeOfBirth || undefined,
      identity: identity || undefined,
      gender: normalizedGender,
      bplCategory: bplCategory || undefined,
      underprivilegedCategory: underprivilegedCategory || undefined,
    });

    await user.save();

    const token = generateToken({ id: user._id, authProvider: user.authProvider });

    return res.status(201).json({
      status: true,
      message: 'Successfully registered',
      result: {
        user: {
          _id: user._id,
          ceebrainId: user.ceebrainId,
          phone: user.phone,
          authProvider: user.authProvider,
          verificationStatus: user.verificationStatus,
          status: user.status,
        },
        token,
      },
    });
  } catch (err) {
    console.error('CeebrainRegister Error:', err);

    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ status: false, message: messages.join(', ') });
    }

    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(409).json({ status: false, message: `${field} already exists` });
    }

    return res.status(500).json({ status: false, message: 'An error occurred during registration' });
  }
};

module.exports = ceebrainRegister;
