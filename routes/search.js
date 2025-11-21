// routes/search.js
const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Search users
router.get('/users', async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const users = await User.searchUsers(q.trim(), page, limit);

    res.json({
      success: true,
      users,
      query: q,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching users'
    });
  }
});

// Search posts
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const { 
      q, 
      category, 
      author, 
      tags,
      sortBy = 'relevance',
      page = 1, 
      limit = 10 
    } = req.query;

    let query = {};
    let sortOptions = {};

    // Text search
    if (q && q.trim().length > 0) {
      query.$text = { $search: q.trim() };
    }

    // Category filter
    if (category && category !== 'All') {
      query.category = category;
    }

    // Author filter
    if (author) {
      const authorUser = await User.findOne({ username: author.toLowerCase() });
      if (authorUser) {
        query.author = authorUser._id;
      }
    }

    // Tags filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim().toLowerCase());
      query.tags = { $in: tagArray };
    }

    // Sort options
    switch (sortBy) {
      case 'newest':
        sortOptions = { createdAt: -1 };
        break;
      case 'oldest':
        sortOptions = { createdAt: 1 };
        break;
      case 'popular':
        sortOptions = { hotScore: -1 };
        break;
      case 'trending':
        sortOptions = { trendingScore: -1 };
        break;
      case 'relevance':
      default:
        if (q && q.trim().length > 0) {
          sortOptions = { score: { $meta: 'textScore' } };
        } else {
          sortOptions = { createdAt: -1 };
        }
        break;
    }

    const findOptions = {
      ...(q && q.trim().length > 0 ? { score: { $meta: 'textScore' } } : {})
    };

    const posts = await Post.find(query, findOptions)
      .populate('author', 'username name avatar field')
      .populate('likes', 'username name avatar')
      .populate('comments.author', 'username name avatar')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      posts,
      total,
      query: q || '',
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Search posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching posts'
    });
  }
});

// Get search suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        suggestions: []
      });
    }

    // Search users for suggestions
    const userSuggestions = await User.find({
      $or: [
        { username: { $regex: q.trim(), $options: 'i' } },
        { name: { $regex: q.trim(), $options: 'i' } }
      ],
      isActive: true
    })
    .select('username name avatar')
    .limit(5);

    // Search categories for suggestions
    const categorySuggestions = await Post.distinct('category', {
      category: { $regex: q.trim(), $options: 'i' }
    }).limit(5);

    // Search tags for suggestions
    const tagSuggestions = await Post.distinct('tags', {
      tags: { $regex: q.trim(), $options: 'i' }
    }).limit(5);

    res.json({
      success: true,
      suggestions: {
        users: userSuggestions,
        categories: categorySuggestions,
        tags: tagSuggestions
      }
    });
  } catch (error) {
    console.error('Search suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching suggestions'
    });
  }
});

module.exports = router;