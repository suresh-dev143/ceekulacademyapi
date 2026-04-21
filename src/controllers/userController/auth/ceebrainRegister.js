const { User } = require('../../../models/authModels');
const { generateToken } = require('../../../utils/generateToken');

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
      ceebrainId,
      agreeToFramework,
    } = req.body;

    // Basic presence checks
    if (!mobileNo || !password || !ceebrainId) {
      return res.status(400).json({
        status: false,
        message: 'mobileNo, password, and ceebrainId are required',
      });
    }

    if (!agreeToFramework) {
      return res.status(400).json({
        status: false,
        message: 'You must agree to the self regulatory framework',
      });
    }

    // Duplicate checks
    const phoneExists = await User.findOne({ phone: mobileNo });
    if (phoneExists) {
      return res.status(409).json({ status: false, message: 'Mobile number already registered' });
    }

    const ceebrainExists = await User.findOne({ ceebrainId });
    if (ceebrainExists) {
      return res.status(409).json({ status: false, message: 'Ceebrain ID already in use, please refresh and try again' });
    }

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
