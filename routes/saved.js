// routes/saved.js
const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user's saved posts
router.get('/posts', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const user = await User.findById(req.user._id)
      .populate({
        path: 'savedPosts',
        populate: [
          { path: 'author', select: 'username name avatar field' },
          { path: 'likes', select: 'username name avatar' },
          { path: 'comments.author', select: 'username name avatar' }
        ],
        options: {
          sort: { createdAt: -1 },
          skip: skip,
          limit: parseInt(limit)
        }
      })
      .select('savedPosts');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      posts: user.savedPosts,
      total: user.savedPosts.length,
      page: parseInt(page),
      totalPages: Math.ceil(user.savedPosts.length / limit)
    });
  } catch (error) {
    console.error('Get saved posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching saved posts'
    });
  }
});

// Save post with atomic operations
router.post('/posts/:postId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Use atomic operations to update both documents
    const [userUpdate, postUpdate] = await Promise.all([
      // Add to user's savedPosts if not already present
      User.findOneAndUpdate(
        { 
          _id: req.user._id,
          savedPosts: { $ne: req.params.postId }
        },
        { $addToSet: { savedPosts: req.params.postId } },
        { new: true }
      ),
      
      // Add to post's savedBy if not already present
      Post.findOneAndUpdate(
        { 
          _id: req.params.postId,
          savedBy: { $ne: req.user._id }
        },
        { $addToSet: { savedBy: req.user._id } },
        { new: true }
      )
    ]);

    // If userUpdate is null, post was already saved
    if (!userUpdate) {
      return res.status(400).json({
        success: false,
        message: 'Post already saved'
      });
    }

    const updatedPost = await Post.findById(req.params.postId)
      .populate('savedBy', 'username name avatar');

    // Emit WebSocket event
    const webSocketServer = req.app.get('webSocketServer');
    if (webSocketServer) {
      webSocketServer.notifyPostSaved(updatedPost, req.user._id, true);
    }

    res.json({
      success: true,
      message: 'Post saved successfully',
      saved: true,
      saveCount: updatedPost.savedBy.length
    });
  } catch (error) {
    console.error('Save post error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while saving post'
    });
  }
});

// Unsave post with atomic operations
router.delete('/posts/:postId', auth, async (req, res) => {
  try {
    // Use atomic operations to update both documents
    const [userUpdate, postUpdate] = await Promise.all([
      // Remove from user's savedPosts
      User.findByIdAndUpdate(
        req.user._id,
        { $pull: { savedPosts: req.params.postId } },
        { new: true }
      ),
      
      // Remove from post's savedBy
      Post.findByIdAndUpdate(
        req.params.postId,
        { $pull: { savedBy: req.user._id } },
        { new: true }
      )
    ]);

    const updatedPost = await Post.findById(req.params.postId)
      .populate('savedBy', 'username name avatar');

    // Emit WebSocket event
    const webSocketServer = req.app.get('webSocketServer');
    if (webSocketServer) {
      webSocketServer.notifyPostSaved(updatedPost, req.user._id, false);
    }

    res.json({
      success: true,
      message: 'Post unsaved successfully',
      saved: false,
      saveCount: updatedPost.savedBy.length
    });
  } catch (error) {
    console.error('Unsave post error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while unsaving post'
    });
  }
});

module.exports = router;