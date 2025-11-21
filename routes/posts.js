const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');
const mongoose = require('mongoose');

const router = express.Router();

// Get WebSocket server from app
const getWebSocketServer = (req) => {
  return req.app.get('websocket');
};

// ----------- REMOVED THE createAdComment FUNCTION AND ALL use of adComment ------------

// Get all posts with pagination, search, and feed filtering
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { 
      search, 
      category, 
      page = 1, 
      limit = 10,
      sortBy = 'hot',
      feed = 'all'  // 'all', 'following', 'trending', 'saved', 'my-posts'
    } = req.query;

    let query = { visibility: 'public' };
    let sortOptions = {};

    // Feed filtering logic
    switch (feed) {
      case 'following':
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required for following feed'
          });
        }
        const user = await User.findById(req.user._id);
        query.author = { $in: user.following };
        break;

      case 'my-posts':
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required for my posts feed'
          });
        }
        query.author = req.user._id;
        break;

      case 'saved':
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required for saved posts feed'
          });
        }
        const currentUser = await User.findById(req.user._id);
        query._id = { $in: currentUser.savedPosts };
        break;

      case 'trending':
        query.createdAt = { 
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        };
        break;

      case 'all':
      default:
        // Show all public posts
        break;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Category filter
    if (category && category !== 'All') {
      query.category = category;
    }

    // Sort options
    switch (sortBy) {
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'old':
        sortOptions = { createdAt: 1 };
        break;
      case 'top':
        sortOptions = { likeCount: -1 };
        break;
      case 'trending':
        sortOptions = { trendingScore: -1 };
        break;
      case 'hot':
      default:
        sortOptions = { hotScore: -1 };
        break;
    }

    const posts = await Post.find(query)
      .populate('author', 'username name avatar field')
      .populate('likes', 'username name avatar')
      .populate('comments.author', 'username name avatar')
      .populate('comments.replies.author', 'username name avatar')
      .populate('originalPost')
      .populate('repostedBy', 'username name avatar')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // ----------- REMOVED "addAdsToPosts" and ad injection code here -----------
    // Only send real user comments

    const total = await Post.countDocuments(query);

    // Increment views for posts
    if (posts.length > 0) {
      await Post.updateMany(
        { _id: { $in: posts.map(p => p._id) } },
        { $inc: { views: 1 } }
      );
    }

    res.json({
      success: true,
      posts: posts, // only real comments
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total,
      feedType: feed
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while fetching posts' 
    });
  }
});

// Get single post by ID - REMOVED ad comment logic
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username name avatar field')
      .populate('likes', 'username name avatar')
      .populate('comments.author', 'username name avatar')
      .populate('comments.replies.author', 'username name avatar')
      .populate('originalPost')
      .populate('repostedBy', 'username name avatar');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // ----------- REMOVED "createAdComment" and ad injection here -----------
    // Just send raw post and comments

    // Increment views
    post.views += 1;
    await post.save();

    res.json({
      success: true,
      post: post // only real comments
    });
  } catch (error) {
    console.error('Get post error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error while fetching post'
    });
  }
});

// Get personalized feed recommendations - REMOVED ad injection
router.get('/feed/recommendations', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Get posts from followed users
    const followingPosts = await Post.find({
      author: { $in: user.following },
      visibility: 'public'
    })
      .populate('author', 'username name avatar field')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get trending posts in user's field of interest
    const fieldPosts = await Post.find({
      category: user.field,
      visibility: 'public',
      author: { $ne: req.user._id } // Exclude user's own posts
    })
      .populate('author', 'username name avatar field')
      .sort({ trendingScore: -1 })
      .limit(5);

    // Get posts with similar tags
    const userPosts = await Post.find({ author: req.user._id });
    const userTags = [...new Set(userPosts.flatMap(post => post.tags))];
    
    const similarPosts = await Post.find({
      tags: { $in: userTags },
      visibility: 'public',
      author: { $ne: req.user._id }
    })
      .populate('author', 'username name avatar field')
      .sort({ hotScore: -1 })
      .limit(5);

    // Combine and deduplicate posts
    const allPosts = [...followingPosts, ...fieldPosts, ...similarPosts];
    const uniquePosts = allPosts.filter((post, index, self) => 
      index === self.findIndex(p => p._id.toString() === post._id.toString())
    );

    // ----------- REMOVED "addAdsToPosts" and ad injection here -----------

    res.json({
      success: true,
      posts: uniquePosts.slice(0, 15), // Limit to 15 posts, only real comments
      breakdown: {
        fromFollowing: followingPosts.length,
        fromField: fieldPosts.length,
        similarInterests: similarPosts.length
      }
    });
  } catch (error) {
    console.error('Feed recommendations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching feed recommendations'
    });
  }
});

// Get trending posts - REMOVED ad injection
router.get('/trending/all', async (req, res) => {
  try {
    const trendingPosts = await Post.aggregate([
      {
        $match: {
          createdAt: { 
            $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          },
          visibility: 'public'
        }
      },
      {
        $project: {
          title: 1,
          content: 1,
          category: 1,
          tags: 1,
          author: 1,
          likesCount: { $size: '$likes' },
          commentsCount: { $size: '$comments' },
          repostCount: 1,
          saveCount: { $size: '$savedBy' },
          views: 1,
          createdAt: 1,
          trendingScore: 1,
          comments: 1
        }
      },
      { $sort: { trendingScore: -1, createdAt: -1 } },
      { $limit: 10 }
    ]);

    // Populate author information
    await Post.populate(trendingPosts, { 
      path: 'author', 
      select: 'username name avatar field' 
    });

    // Populate comments for each post
    for (let post of trendingPosts) {
      if (post.comments && post.comments.length > 0) {
        await Post.populate(post, {
          path: 'comments.author',
          select: 'username name avatar'
        });
      }
    }

    // ----------- REMOVED "addAdsToPosts" and ad injection here -----------

    res.json({
      success: true,
      posts: trendingPosts // only real comments
    });
  } catch (error) {
    console.error('Trending posts error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while fetching trending posts' 
    });
  }
});

// Create post - REMOVED ad injection
router.post('/', [
  auth,
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot be more than 200 characters'),
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Content is required')
    .isLength({ max: 10000 })
    .withMessage('Content cannot be more than 10000 characters'),
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isIn(['Neuroscience', 'Climate Science', 'Computer Science', 'Biology', 'Physics', 'Medicine', 'Psychology', 'Economics', 'Other'])
    .withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { title, content, category, tags, visibility = 'public', isRepost, originalPostId } = req.body;

    // Handle repost
    if (isRepost && originalPostId) {
      const originalPost = await Post.findById(originalPostId);
      if (!originalPost) {
        return res.status(404).json({
          success: false,
          message: 'Original post not found'
        });
      }

      // Create repost
      const repost = new Post({
        title: originalPost.title,
        content: originalPost.content,
        category: originalPost.category,
        tags: originalPost.tags,
        author: req.user._id,
        isRepost: true,
        originalPost: originalPostId,
        repostedBy: req.user._id,
        visibility: 'public'
      });

      await repost.save();

      // Update original post repost count
      originalPost.repostCount += 1;
      await originalPost.save();

      // Populate and return
      await repost.populate('author', 'username name avatar field');
      await repost.populate('originalPost');

      // ----------- REMOVED ad injection here -----------

      // REAL-TIME: Notify all clients about new repost
      const wss = getWebSocketServer(req);
      if (wss) {
        await wss.notifyNewPost(repost);
      }

      return res.status(201).json({
        success: true,
        post: repost,
        message: 'Post reposted successfully'
      });
    }

    // Create new post
    const post = new Post({
      title: title.trim(),
      content: content.trim(),
      category,
      tags: tags ? tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag) : [],
      author: req.user._id,
      visibility
    });

    await post.save();
    
    // Update user's post count
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.postCount': 1 }
    });

    await post.populate('author', 'username name avatar field');

    // ----------- REMOVED ad injection here -----------

    // REAL-TIME: Notify all clients about new post
    const wss = getWebSocketServer(req);
    if (wss) {
      await wss.notifyNewPost(post);
    }

    res.status(201).json({
      success: true,
      post: post // only real comments
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while creating post' 
    });
  }
});

// Update post - REMOVED ad injection
router.put('/:id', [
  auth,
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot be more than 200 characters'),
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Content is required')
    .isLength({ max: 10000 })
    .withMessage('Content cannot be more than 10000 characters'),
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isIn(['Neuroscience', 'Climate Science', 'Computer Science', 'Biology', 'Physics', 'Medicine', 'Psychology', 'Economics', 'Other'])
    .withMessage('Invalid category')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { title, content, category, tags } = req.body;
    const postId = req.params.id;

    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this post'
      });
    }

    post.title = title.trim();
    post.content = content.trim();
    post.category = category;
    post.tags = tags ? tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag) : [];

    await post.save();
    await post.populate('author', 'username name avatar field');

    // ----------- REMOVED ad injection here -----------

    // REAL-TIME: Notify all clients about updated post
    const wss = getWebSocketServer(req);
    if (wss) {
      await wss.notifyUpdatedPost(post);
    }

    res.json({
      success: true,
      message: 'Post updated successfully',
      post: post // only real comments
    });
  } catch (error) {
    console.error('Update post error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Server error while updating post' 
    });
  }
});

// Like/Unlike post - REMOVED ad injection
router.post('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username name');
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: 'Post not found' 
      });
    }

    const likeIndex = post.likes.indexOf(req.user._id);
    
    if (likeIndex === -1) {
      // Like the post
      post.likes.push(req.user._id);
      
      // Send notification to post author (if not liking own post)
      if (post.author._id.toString() !== req.user._id.toString()) {
        const author = await User.findById(post.author._id);
        await author.addNotification({
          type: 'like',
          fromUser: req.user._id,
          post: post._id,
          message: `${req.user.name} liked your post`
        });

        // REAL-TIME: Notify post author about new like
        const wss = getWebSocketServer(req);
        if (wss) {
          const notification = {
            type: 'like',
            fromUser: req.user._id,
            post: post._id,
            message: `${req.user.name} liked your post`,
            read: false,
            createdAt: new Date()
          };
          wss.notifyNewNotification(post.author._id, notification);
        }
      }
    } else {
      // Unlike the post
      post.likes.splice(likeIndex, 1);
    }

    await post.save();
    await post.populate('likes', 'username name avatar');

    // ----------- REMOVED ad injection here -----------

    // REAL-TIME: Notify all clients about like update
    const wss = getWebSocketServer(req);
    if (wss) {
      wss.notifyPostLiked(post, req.user._id, likeIndex === -1);
    }

    res.json({
      success: true,
      liked: likeIndex === -1,
      likeCount: post.likes.length,
      post: post // only real comments
    });
  } catch (error) {
    console.error('Like post error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Server error while updating like' 
    });
  }
});

// Save/Unsave post - NO ad injection ever
router.post('/:id/save', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    // Find post and user within transaction
    const post = await Post.findById(postId).session(session);
    const user = await User.findById(userId).session(session);
    
    if (!post) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Ensure arrays exist
    if (!post.savedBy) post.savedBy = [];
    if (!user.savedPosts) user.savedPosts = [];

    const isCurrentlySaved = post.savedBy.some(
      savedUserId => savedUserId.toString() === userId.toString()
    );

    if (!isCurrentlySaved) {
      // Save the post - using atomic operations
      await Post.findByIdAndUpdate(
        postId,
        { $addToSet: { savedBy: userId } },
        { session }
      );
      await User.findByIdAndUpdate(
        userId,
        { $addToSet: { savedPosts: postId } },
        { session }
      );
    } else {
      // Unsave the post
      await Post.findByIdAndUpdate(
        postId,
        { $pull: { savedBy: userId } },
        { session }
      );
      await User.findByIdAndUpdate(
        userId,
        { $pull: { savedPosts: postId } },
        { session }
      );
    }

    await session.commitTransaction();

    // Get updated post to return current state
    const updatedPost = await Post.findById(postId)
      .populate('savedBy', 'username name avatar');

    // ----------- REMOVED ad injection here -----------

    res.json({
      success: true,
      saved: !isCurrentlySaved,
      saveCount: updatedPost.savedBy.length,
      post: updatedPost // only real comments
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Save post error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict detected. Please try again.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error while saving post'
    });
  } finally {
    session.endSession();
  }
});

// Delete post - NO ad injection ever
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this post'
      });
    }

    const postId = post._id;
    await Post.findByIdAndDelete(req.params.id);

    // Update user's post count
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.postCount': -1 }
    });

    // REAL-TIME: Notify all clients about deleted post
    const wss = getWebSocketServer(req);
    if (wss) {
      wss.notifyDeletedPost(postId);
    }

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error while deleting post'
    });
  }
});

module.exports = router;