const express = require('express');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get WebSocket server from app
const getWebSocketServer = (req) => {
  return req.app.get('websocket');
};

// Follow user - UPDATED with real-time
router.post('/:username/follow', auth, async (req, res) => {
  try {
    const targetUser = await User.findOne({ username: req.params.username });
    const currentUser = await User.findById(req.user._id);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot follow yourself'
      });
    }

    // Check if already following
    const isFollowing = currentUser.following.includes(targetUser._id);
    
    if (isFollowing) {
      // Unfollow
      await User.findByIdAndUpdate(
        req.user._id,
        { $pull: { following: targetUser._id } }
      );
      
      await User.findByIdAndUpdate(
        targetUser._id,
        { $pull: { followers: req.user._id } }
      );

      // REAL-TIME: Notify users about follow update
      const wss = getWebSocketServer(req);
      if (wss) {
        wss.notifyFollowUpdate(req.user._id, targetUser._id, false);
      }

      res.json({
        success: true,
        message: `Unfollowed ${targetUser.name}`,
        following: false,
        followerCount: targetUser.followers.length - 1
      });
    } else {
      // Follow
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { following: targetUser._id } }
      );
      
      await User.findByIdAndUpdate(
        targetUser._id,
        { $addToSet: { followers: req.user._id } }
      );

      // Create notification
      const notification = {
        type: 'follow',
        fromUser: req.user._id,
        message: `${currentUser.name} started following you`,
        read: false,
        createdAt: new Date()
      };

      await User.findByIdAndUpdate(
        targetUser._id,
        { 
          $push: { 
            notifications: { 
              $each: [notification], 
              $position: 0 
            } 
          } 
        }
      );

      // REAL-TIME: Notify users about follow update and new notification
      const wss = getWebSocketServer(req);
      if (wss) {
        wss.notifyFollowUpdate(req.user._id, targetUser._id, true);
        wss.notifyNewNotification(targetUser._id, notification);
      }

      // Get updated follower count
      const updatedTargetUser = await User.findById(targetUser._id);

      res.json({
        success: true,
        message: `You are now following ${targetUser.name}`,
        following: true,
        followerCount: updatedTargetUser.followers.length
      });
    }
  } catch (error) {
    console.error('Follow user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while following user'
    });
  }
});

// Check follow status
router.get('/:username/status', auth, async (req, res) => {
  try {
    const targetUser = await User.findOne({ username: req.params.username });
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = await User.findById(req.user._id);
    const isFollowing = currentUser.following.includes(targetUser._id);

    res.json({
      success: true,
      isFollowing
    });
  } catch (error) {
    console.error('Check follow status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking follow status'
    });
  }
});

// Get user's followers
router.get('/:username/followers', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .populate('followers', 'username name avatar field bio')
      .select('followers');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      followers: user.followers
    });
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching followers'
    });
  }
});

// Get user's following
router.get('/:username/following', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .populate('following', 'username name avatar field bio')
      .select('following');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      following: user.following
    });
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching following'
    });
  }
});

module.exports = router;