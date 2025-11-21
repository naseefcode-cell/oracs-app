// routes/insights.js
const express = require('express');
const Post = require('../models/Post');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user insights
router.get('/', auth, async (req, res) => {
  try {
    const { period = 'week' } = req.query; // week, month, year, all
    const userId = req.user._id;

    // Calculate date range based on period
    let startDate;
    const endDate = new Date();
    
    switch (period) {
      case 'week':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startDate = new Date(0); // Beginning of time
        break;
    }

    // Get user's posts with engagement data
    const userPosts = await Post.find({
      author: userId,
      createdAt: { $gte: startDate, $lte: endDate }
    }).select('likes comments repostCount views createdAt');

    // Calculate insights
    const totalPosts = userPosts.length;
    const totalLikes = userPosts.reduce((sum, post) => sum + post.likes.length, 0);
    const totalComments = userPosts.reduce((sum, post) => sum + post.comments.length, 0);
    const totalReposts = userPosts.reduce((sum, post) => sum + post.repostCount, 0);
    const totalViews = userPosts.reduce((sum, post) => sum + post.views, 0);

    // Calculate average engagement per post
    const avgEngagement = totalPosts > 0 ? (totalLikes + totalComments + totalReposts) / totalPosts : 0;

    // Get top performing posts
    const topPosts = await Post.find({
      author: userId,
      createdAt: { $gte: startDate, $lte: endDate }
    })
    .populate('author', 'username name avatar')
    .sort({ hotScore: -1 })
    .limit(5);

    // Engagement over time (simplified - last 7 days)
    const engagementOverTime = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayPosts = userPosts.filter(post => 
        post.createdAt >= date && post.createdAt < nextDate
      );

      const dayLikes = dayPosts.reduce((sum, post) => sum + post.likes.length, 0);
      const dayComments = dayPosts.reduce((sum, post) => sum + post.comments.length, 0);
      const dayReposts = dayPosts.reduce((sum, post) => sum + post.repostCount, 0);

      engagementOverTime.push({
        date: date.toISOString().split('T')[0],
        likes: dayLikes,
        comments: dayComments,
        reposts: dayReposts,
        total: dayLikes + dayComments + dayReposts
      });
    }

    // Category distribution
    const categoryStats = await Post.aggregate([
      {
        $match: {
          author: userId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalLikes: { $sum: { $size: '$likes' } },
          totalComments: { $sum: { $size: '$comments' } }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.json({
      success: true,
      insights: {
        summary: {
          totalPosts,
          totalLikes,
          totalComments,
          totalReposts,
          totalViews,
          avgEngagement: Math.round(avgEngagement * 100) / 100
        },
        engagementOverTime,
        topPosts,
        categoryStats,
        period
      }
    });
  } catch (error) {
    console.error('Get insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching insights'
    });
  }
});

// Get follower growth
router.get('/followers', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('createdAt');
    
    // This is a simplified version - in a real app, you'd track follower growth over time
    const followerStats = await User.aggregate([
      { $match: { _id: req.user._id } },
      { $unwind: '$followers' },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      followerStats
    });
  } catch (error) {
    console.error('Get follower stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching follower stats'
    });
  }
});

module.exports = router;