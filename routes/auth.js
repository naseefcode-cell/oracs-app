// routes/authRoutes.js - Complete with All Authentication Features
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const { sendOTPEmail, sendPasswordResetEmail, sendPasswordResetConfirmationEmail } = require('../services/emailService');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Generate JWT
const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined');
  }
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Validation middleware
const validateRegistration = [
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
];

// Check if username is available
router.get('/check-username/:username', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    
    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters'
      });
    }

    const user = await User.findOne({ username });
    
    res.json({
      success: true,
      available: !user,
      suggestions: user ? [
        `${username}${Math.floor(Math.random() * 100)}`,
        `${username}_${Math.floor(Math.random() * 1000)}`,
        `${username}${new Date().getFullYear()}`
      ] : []
    });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking username'
    });
  }
});

// Register user (send OTP)
router.post('/register', validateRegistration, async (req, res) => {
  try {
    console.log('📝 Registration attempt:', { 
      username: req.body.username, 
      name: req.body.name, 
      email: req.body.email 
    });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const { username, name, email, password, field } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email.toLowerCase() 
          ? 'Email already registered' 
          : 'Username already taken'
      });
    }

    // Generate OTP
    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user (not verified yet)
    const user = new User({
      username: username.toLowerCase(),
      name: name.trim(),
      email: email.toLowerCase(),
      password: password,
      field: field || 'Other',
      emailVerified: false,
      otp: {
        code: otpCode,
        expires: otpExpires
      }
    });

    await user.save();
    console.log('✅ User saved to database:', user.email);

    // Send OTP email
    try {
      await sendOTPEmail(email, otpCode);
      console.log('✅ OTP sent successfully');
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Verification code sent to your email',
      userId: user._id,
      email: user.email,
      developmentOTP: process.env.NODE_ENV !== 'production' ? otpCode : undefined
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        success: false,
        message: `${field} already exists` 
      });
    }
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Registration failed. Please try again.' 
    });
  }
});

// Verify OTP and complete registration
router.post('/verify-otp', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    if (user.emailVerified) {
      const token = generateToken(user._id);
      return res.json({
        success: true,
        message: 'Email already verified',
        token,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          email: user.email,
          field: user.field,
          avatar: user.avatar,
          emailVerified: user.emailVerified
        }
      });
    }

    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Development OTP accepted:', otp);
    } else {
      
      if (!user.otp || user.otp.code !== otp) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid verification code' 
        });
      }

      if (new Date() > user.otp.expires) {
        return res.status(400).json({ 
          success: false,
          message: 'Verification code has expired' 
        });
      }
    }

    
    user.emailVerified = true;
    user.otp = undefined;
    await user.save();


    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Email verified successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        field: user.field,
        avatar: user.avatar,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Verification failed' 
    });
  }
});


router.post('/login', [
  body('identifier').notEmpty().withMessage('Email or username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { identifier, password } = req.body;

    
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() }
      ]
    });

    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid email/username or password' 
      });
    }

    
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid email/username or password' 
      });
    }

    
    if (!user.emailVerified) {
      // Generate new OTP for verification
      const otpCode = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      user.otp = {
        code: otpCode,
        expires: otpExpires
      };
      await user.save();

      
      await sendOTPEmail(user.email, otpCode);

      return res.status(400).json({ 
        success: false,
        message: 'Please verify your email first. A new verification code has been sent.',
        needsVerification: true,
        userId: user._id,
        email: user.email,
        developmentOTP: process.env.NODE_ENV !== 'production' ? otpCode : undefined
      });
    }

    
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        field: user.field,
        avatar: user.avatar,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Login failed. Please try again.' 
    });
  }
});


router.post('/change-password', [
  auth,
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    
    user.password = newPassword;
    await user.save();

    console.log('✅ Password changed successfully for user:', user.email);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password. Please try again.'
    });
  }
});


router.post('/forgot-password', [
  body('email').isEmail().withMessage('Please enter a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { email } = req.body;
    console.log('🔑 Forgot password request for:', email);

    const user = await User.findOne({ email: email.toLowerCase() });
    
    
    if (!user) {
      console.log('📧 Email not found in database (for security, not revealing)');
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset code has been sent.'
      });
    }

    
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    
    const resetToken = generateOTP();
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); 

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();

    console.log('✅ Reset token generated for:', email, 'Token:', resetToken);


    try {
      await sendPasswordResetEmail(user.email, resetToken);
      console.log('✅ Password reset email sent successfully');
    } catch (emailError) {
      console.error('❌ Reset email sending failed:', emailError);
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset code has been sent.',
      developmentToken: process.env.NODE_ENV !== 'production' ? resetToken : undefined
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending reset email. Please try again.'
    });
  }
});


router.post('/verify-reset-token', [
  body('token').isLength({ min: 6, max: 6 }).withMessage('Reset token must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { token } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.'
      });
    }

    res.json({
      success: true,
      message: 'Token is valid',
      email: user.email
    });

  } catch (error) {
    console.error('Verify reset token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying token. Please try again.'
    });
  }
});


router.post('/reset-password', [
  body('token').isLength({ min: 6, max: 6 }).withMessage('Reset token must be 6 digits'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { token, password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.'
      });
    }

    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log('✅ Password reset successfully for:', user.email);

    
    try {
      await sendPasswordResetConfirmationEmail(user.email);
      console.log('✅ Password reset confirmation email sent');
    } catch (emailError) {
      console.error('❌ Confirmation email failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password. Please try again.'
    });
  }
});


router.patch('/preferences', [
  auth,
  body('emailNotifications').optional().isBoolean(),
  body('pushNotifications').optional().isBoolean(),
  body('privateAccount').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { emailNotifications, pushNotifications, privateAccount } = req.body;

    const updateData = {};
    if (emailNotifications !== undefined) updateData['preferences.emailNotifications'] = emailNotifications;
    if (pushNotifications !== undefined) updateData['preferences.pushNotifications'] = pushNotifications;
    if (privateAccount !== undefined) updateData['preferences.privateAccount'] = privateAccount;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true }
    ).select('-password -otp -resetPasswordToken -resetPasswordExpires');

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      user
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating preferences'
    });
  }
});


router.post('/delete-account', [
  auth,
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { password } = req.body;
    const userId = req.user._id;

    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    
    await Post.deleteMany({ author: userId });

    
    await User.updateMany(
      { 
        $or: [
          { followers: userId },
          { following: userId }
        ]
      },
      {
        $pull: {
          followers: userId,
          following: userId
        }
      }
    );

    
    await Post.updateMany(
      { likes: userId },
      { $pull: { likes: userId } }
    );

    
    await Post.updateMany(
      { 'comments.author': userId },
      { $pull: { comments: { author: userId } } }
    );

    
    await Post.updateMany(
      { savedBy: userId },
      { $pull: { savedBy: userId } }
    );

    
    await User.findByIdAndDelete(userId);

    console.log(`✅ Account deleted for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Account and all associated data have been permanently deleted.'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting account. Please try again.'
    });
  }
});


router.post('/deactivate-account', [
  auth,
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { password } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    
    user.isActive = false;
    await user.save();

    console.log(`✅ Account deactivated for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Account has been deactivated. You can reactivate by logging in again.'
    });

  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating account. Please try again.'
    });
  }
});


router.post('/reactivate-account', [
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    
    user.isActive = true;
    await user.save();

    
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Account reactivated successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        field: user.field,
        avatar: user.avatar,
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
    console.error('Reactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Error reactivating account. Please try again.'
    });
  }
});


router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -otp -resetPasswordToken -resetPasswordExpires')
      .populate('followers', 'username name avatar')
      .populate('following', 'username name avatar');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get user profile' 
    });
  }
});


router.put('/profile', [
  auth,
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot be more than 500 characters'),
  body('website')
    .optional()
    .isURL()
    .withMessage('Please enter a valid website URL')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const {
      name,
      bio,
      field,
      institution,
      location,
      website,
      socialLinks
    } = req.body;

    const updateData = {};
    
    if (name) updateData.name = name.trim();
    if (bio !== undefined) updateData.bio = bio.trim();
    if (field) updateData.field = field.trim();
    if (institution !== undefined) updateData.institution = institution.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (website !== undefined) updateData.website = website.trim();
    
    if (socialLinks) {
      updateData.socialLinks = {};
      if (socialLinks.twitter !== undefined) updateData.socialLinks.twitter = socialLinks.twitter.trim();
      if (socialLinks.linkedin !== undefined) updateData.socialLinks.linkedin = socialLinks.linkedin.trim();
      if (socialLinks.github !== undefined) updateData.socialLinks.github = socialLinks.github.trim();
      if (socialLinks.orcid !== undefined) updateData.socialLinks.orcid = socialLinks.orcid.trim();
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password -otp -resetPasswordToken -resetPasswordExpires');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
});



router.post('/resend-otp', [
  body('userId').notEmpty().withMessage('User ID is required')
], async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    user.otp = {
      code: otpCode,
      expires: otpExpires
    };

    await user.save();

 
    await sendOTPEmail(user.email, otpCode);

    res.json({
      success: true,
      message: 'Verification code sent to your email',
      developmentOTP: process.env.NODE_ENV !== 'production' ? otpCode : undefined
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification code'
    });
  }
});

router.post('/logout', auth, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});



router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Authentication service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
