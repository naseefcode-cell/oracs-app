// routes/profile.js - Complete version
const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user profile by username
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() })
      .select('-password -otp -resetPasswordToken -resetPasswordExpires')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's posts count
    const postsCount = await Post.countDocuments({ author: user._id });
    
    // Get total likes received
    const userPosts = await Post.find({ author: user._id }).select('likes');
    const totalLikes = userPosts.reduce((acc, post) => acc + post.likes.length, 0);

    // Get comments count
    const userComments = await Post.aggregate([
      { $unwind: '$comments' },
      { $match: { 'comments.author': user._id } },
      { $count: 'commentsCount' }
    ]);
    const commentsCount = userComments.length > 0 ? userComments[0].commentsCount : 0;

    // Get follower stats
    const followerCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;

    res.json({
      success: true,
      profile: {
        ...user,
        stats: {
          postsCount,
          totalLikes,
          commentsCount,
          followerCount,
          followingCount
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
});

// Get current user's profile
router.get('/me/info', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -otp -resetPasswordToken -resetPasswordExpires')
      .lean();

    const postsCount = await Post.countDocuments({ author: req.user._id });
    const userPosts = await Post.find({ author: req.user._id }).select('likes');
    const totalLikes = userPosts.reduce((acc, post) => acc + post.likes.length, 0);

    // Get comments count
    const userComments = await Post.aggregate([
      { $unwind: '$comments' },
      { $match: { 'comments.author': req.user._id } },
      { $count: 'commentsCount' }
    ]);
    const commentsCount = userComments.length > 0 ? userComments[0].commentsCount : 0;

    // Get follower stats
    const followerCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;

    res.json({
      success: true,
      profile: {
        ...user,
        stats: {
          postsCount,
          totalLikes,
          commentsCount,
          followerCount,
          followingCount
        }
      }
    });
  } catch (error) {
    console.error('Get my profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
});

// Update user profile
router.put('/update', [
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
    .custom((value) => {
      if (!value) return true;
      const urlRegex = /^(http|https):\/\/[^ "]+$/;
      return urlRegex.test(value);
    })
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
      socialLinks,
      isPublic
    } = req.body;

    const updateData = {};
    
    if (name) updateData.name = name.trim();
    if (bio !== undefined) updateData.bio = bio.trim();
    if (field) updateData.field = field.trim();
    if (institution !== undefined) updateData.institution = institution.trim();
    if (location !== undefined) updateData.location = location.trim();
    if (website !== undefined) updateData.website = website.trim();
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    
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

// Update user preferences
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


// Get user's posts for profile page
router.get('/:username/posts', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { page = 1, limit = 10 } = req.query;

    const posts = await Post.find({ author: user._id })
      .populate('author', 'username name avatar field')
      .populate('likes', 'username name avatar')
      .populate('comments.author', 'username name avatar')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments({ author: user._id });

    res.json({
      success: true,
      posts,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Get user profile posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user posts'
    });
  }
});

// Update user preferences
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

module.exports = router;