const { User } = require("../../../models/authModels");
const { generateToken } = require("../../../utils/generateToken");

const login = async (req, res) => {
  try {
    const { email, password, phone, loginMethod } = req.body;

    // Determine login method
    const method = loginMethod || (email ? 'EMAIL_PASSWORD' : 'MOBILE_OTP');

    // ==================== EMAIL + PASSWORD LOGIN ====================
    if (method === 'EMAIL_PASSWORD') {
      if (!email || !password) {
        return res.status(400).json({
          status: false,
          message: "Email and password are required"
        });
      }

      // Find user with password field - Trim email to handle accidental spaces
      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail }).select('+password');

      if (!user) {
        return res.status(401).json({
          status: false,
          message: "Invalid credentials"
        });
      }

      // Check if account is suspended
      if (user.status === 'Suspended') {
        return res.status(403).json({
          status: false,
          message: "Your account has been suspended. Please contact support."
        });
      }

      // Check if account is locked
      if (user.isLocked()) {
        return res.status(423).json({
          status: false,
          message: "Account is temporarily locked due to too many failed attempts. Please try again later."
        });
      }

      // Check if user has email auth enabled
      if (user.authProvider === 'MOBILE_OTP') {
        return res.status(400).json({
          status: false,
          message: "This account uses mobile OTP authentication. Please login with your phone number."
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        await user.incrementLoginAttempts();
        return res.status(401).json({
          status: false,
          message: "Invalid credentials"
        });
      }

      // Reset login attempts on successful login
      await user.resetLoginAttempts();

      // Generate token
      const token = generateToken({
        id: user._id,
        authProvider: user.authProvider
      });

      // Prepare user response (exclude sensitive data)
      const userResponse = {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        authProvider: user.authProvider,
        selectedRole: user.selectedRole,
        verificationStatus: user.verificationStatus,
        status: user.status,
        profileImage: user.profileImage,
        lastLoginAt: user.lastLoginAt
      };

      return res.status(200).json({
        status: true,
        message: "Login successful",
        token,
        user: userResponse
      });
    }

    // ==================== MOBILE OTP LOGIN ====================
    if (method === 'MOBILE_OTP') {
      if (!phone) {
        return res.status(400).json({
          status: false,
          message: "Phone number is required"
        });
      }

      // Validate phone format
      if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
        return res.status(400).json({
          status: false,
          message: "Invalid phone number format"
        });
      }

      // Check if user exists
      const user = await User.findByMobile(phone);

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "No account found with this phone number. Please register first."
        });
      }

      // Check if account is suspended
      if (user.status === 'Suspended') {
        return res.status(403).json({
          status: false,
          message: "Your account has been suspended. Please contact support."
        });
      }

      // For mobile login, redirect to OTP flow
      return res.status(200).json({
        status: true,
        message: "Please use the /sendOTP endpoint to receive OTP",
        requiresOTP: true,
        phone: phone
      });
    }

    // ==================== MOBILE PASSWORD LOGIN ====================
    if (method === 'MOBILE_PASSWORD') {
      if (!phone || !password) {
        return res.status(400).json({ status: false, message: "Phone number and password are required" });
      }

      const user = await User.findOne({ phone }).select('+password');
      if (!user) {
        return res.status(401).json({ status: false, message: "Invalid credentials" });
      }
      if (user.status === 'Suspended') {
        return res.status(403).json({ status: false, message: "Your account has been suspended. Please contact support." });
      }
      if (user.isLocked()) {
        return res.status(423).json({ status: false, message: "Account is temporarily locked due to too many failed attempts." });
      }
      if (user.authProvider !== 'MOBILE_PASSWORD') {
        return res.status(400).json({ status: false, message: "This account does not use phone/password login." });
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        await user.incrementLoginAttempts();
        return res.status(401).json({ status: false, message: "Invalid credentials" });
      }
      await user.resetLoginAttempts();

      const token = generateToken({ id: user._id, authProvider: user.authProvider });
      return res.status(200).json({
        status: true,
        message: "Login successful",
        token,
        user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, ceebrainId: user.ceebrainId, authProvider: user.authProvider, selectedRole: user.selectedRole, verificationStatus: user.verificationStatus, status: user.status, profileImage: user.profileImage, lastLoginAt: user.lastLoginAt }
      });
    }

    // ==================== CEEBRAIN ID LOGIN ====================
    if (method === 'CEEBRAIN_ID') {
      const { ceebrainId } = req.body;
      if (!ceebrainId || !password) {
        return res.status(400).json({ status: false, message: "Ceebrain ID and password are required" });
      }

      const user = await User.findOne({ ceebrainId }).select('+password');
      if (!user) {
        return res.status(401).json({ status: false, message: "Invalid credentials" });
      }
      if (user.status === 'Suspended') {
        return res.status(403).json({ status: false, message: "Your account has been suspended. Please contact support." });
      }
      if (user.isLocked()) {
        return res.status(423).json({ status: false, message: "Account is temporarily locked due to too many failed attempts." });
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        await user.incrementLoginAttempts();
        return res.status(401).json({ status: false, message: "Invalid credentials" });
      }
      await user.resetLoginAttempts();

      const token = generateToken({ id: user._id, authProvider: user.authProvider });
      return res.status(200).json({
        status: true,
        message: "Login successful",
        token,
        user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, ceebrainId: user.ceebrainId, authProvider: user.authProvider, selectedRole: user.selectedRole, verificationStatus: user.verificationStatus, status: user.status, profileImage: user.profileImage, lastLoginAt: user.lastLoginAt }
      });
    }

    return res.status(400).json({
      status: false,
      message: "Invalid login method"
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      status: false,
      message: "An unexpected error occurred"
    });
  }
};

module.exports = login;
