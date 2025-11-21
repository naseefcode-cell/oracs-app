const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user insights
router.get('/:username/insights', auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's posts with engagement data
    const userPosts = await Post.find({ author: user._id })
      .select('likes comments views createdAt');

    const totalPosts = userPosts.length;
    const totalLikes = userPosts.reduce((sum, post) => sum + post.likes.length, 0);
    const totalComments = userPosts.reduce((sum, post) => sum + post.comments.length, 0);
    const totalViews = userPosts.reduce((sum, post) => sum + post.views, 0);

    // Calculate average engagement
    const avgEngagement = totalPosts > 0 ? (totalLikes + totalComments) / totalPosts : 0;

    // Get top performing posts
    const topPosts = await Post.find({ author: user._id })
      .populate('author', 'username name avatar')
      .sort({ likes: -1, views: -1 })
      .limit(3);

    res.json({
      success: true,
      insights: {
        summary: {
          totalPosts,
          totalLikes,
          totalComments,
          totalViews,
          avgEngagement: Math.round(avgEngagement * 100) / 100
        },
        topPosts,
        followerCount: user.followers.length,
        followingCount: user.following.length
      }
    });
  } catch (error) {
    console.error('Get user insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching insights'
    });
  }
});

module.exports = router;