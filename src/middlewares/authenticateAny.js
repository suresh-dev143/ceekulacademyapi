const { ApiError } = require('../errorHandler');
const { User, Admin } = require('../models/authModels');
const { verifyAccessToken } = require('../utils');

/**
 * Accepts a valid JWT from either the User or Admin collection.
 * Normalises the result to req.user so downstream controllers are unchanged.
 * req.userType is set to 'user' | 'admin' for routes that need to distinguish.
 */
const authenticateAny = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    const legit = verifyAccessToken(token);

    const user = await User.findById(legit.id);
    if (user) {
      req.user = user;
      req.userType = 'user';
      req.token = token;
      return next();
    }

    const admin = await Admin.findById(legit.id);
    if (admin) {
      req.user = admin;   // normalise — controllers use req.user._id unchanged
      req.userType = 'admin';
      req.token = token;
      return next();
    }

    throw new ApiError('Access forbidden', 403);
  } catch (err) {
    next(err);
  }
};

module.exports = authenticateAny;
