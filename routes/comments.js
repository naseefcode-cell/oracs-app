const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get WebSocket server from app
const getWebSocketServer = (req) => {
  return req.app.get('websocket');
};

// Add comment to post
router.post('/:postId/comments', [
  auth,
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Comment content is required')
    .isLength({ max: 1000 })
    .withMessage('Comment cannot be more than 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: 'Post not found' 
      });
    }

    const comment = {
      content: req.body.content.trim(),
      author: req.user._id,
      likes: [],
      replies: []
    };

    post.comments.push(comment);
    await post.save();

    // Update user's comment count
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.commentCount': 1 }
    });

    // Send notification to post author (if not commenting on own post)
    if (post.author.toString() !== req.user._id.toString()) {
      const postAuthor = await User.findById(post.author);
      await postAuthor.addNotification({
        type: 'comment',
        fromUser: req.user._id,
        post: post._id,
        message: `${req.user.name} commented on your post`
      });

      // REAL-TIME: Notify post author
      const wss = getWebSocketServer(req);
      if (wss && typeof wss.notifyNewNotification === 'function') {
        const notification = {
          type: 'comment',
          fromUser: req.user._id,
          post: post._id,
          message: `${req.user.name} commented on your post`,
          read: false,
          createdAt: new Date()
        };
        wss.notifyNewNotification(post.author, notification);
      }
    }

    // Populate the new comment
    const populatedPost = await Post.findById(post._id)
      .populate('comments.author', 'username name avatar')
      .populate('comments.replies.author', 'username name avatar');
    
    const newComment = populatedPost.comments[populatedPost.comments.length - 1];

    // REAL-TIME: Notify all clients about new comment using existing method
    const wss = getWebSocketServer(req);
    if (wss) {
      if (typeof wss.notifyNewComment === 'function') {
        await wss.notifyNewComment(post._id, newComment);
      } else if (typeof wss.notifyPostUpdated === 'function') {
        // Fallback: update the entire post
        const updatedPost = await Post.findById(post._id)
          .populate('author', 'username name avatar')
          .populate('comments.author', 'username name avatar')
          .populate('comments.replies.author', 'username name avatar');
        wss.notifyPostUpdated(updatedPost);
      }
    }

    res.status(201).json({
      success: true,
      comment: newComment
    });
  } catch (error) {
    console.error('Add comment error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Server error while adding comment' 
    });
  }
});

// Add reply to comment
router.post('/:postId/comments/:commentId/replies', [
  auth,
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Reply content is required')
    .isLength({ max: 500 })
    .withMessage('Reply cannot be more than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        message: 'Post not found' 
      });
    }

    const comment = post.comments.id(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = {
      content: req.body.content.trim(),
      author: req.user._id,
      likes: []
    };

    comment.replies.push(reply);
    await post.save();

    // Update user's comment count
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.commentCount': 1 }
    });

    // Send notification to comment author (if not replying to own comment)
    if (comment.author.toString() !== req.user._id.toString()) {
      const commentAuthor = await User.findById(comment.author);
      await commentAuthor.addNotification({
        type: 'comment',
        fromUser: req.user._id,
        post: post._id,
        comment: comment._id,
        message: `${req.user.name} replied to your comment`
      });

      // REAL-TIME: Notify comment author
      const wss = getWebSocketServer(req);
      if (wss && typeof wss.notifyNewNotification === 'function') {
        const notification = {
          type: 'comment',
          fromUser: req.user._id,
          post: post._id,
          comment: comment._id,
          message: `${req.user.name} replied to your comment`,
          read: false,
          createdAt: new Date()
        };
        wss.notifyNewNotification(comment.author, notification);
      }
    }

    // Populate the reply
    const populatedPost = await Post.findById(post._id)
      .populate('comments.replies.author', 'username name avatar');
    
    const updatedComment = populatedPost.comments.id(req.params.commentId);
    const newReply = updatedComment.replies[updatedComment.replies.length - 1];

    // REAL-TIME: Notify all clients about new reply using existing method
    const wss = getWebSocketServer(req);
    if (wss) {
      if (typeof wss.notifyReplyAdded === 'function') {
        await wss.notifyReplyAdded(post._id, req.params.commentId, newReply);
      } else if (typeof wss.notifyPostUpdated === 'function') {
        // Fallback: update the entire post
        const updatedPost = await Post.findById(post._id)
          .populate('author', 'username name avatar')
          .populate('comments.author', 'username name avatar')
          .populate('comments.replies.author', 'username name avatar');
        wss.notifyPostUpdated(updatedPost);
      }
    }

    res.status(201).json({
      success: true,
      reply: newReply
    });
  } catch (error) {
    console.error('Add reply error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post or comment ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while adding reply'
    });
  }
});

// Like comment - FIXED: Use atomic operations to avoid VersionError
router.post('/:postId/comments/:commentId/like', auth, async (req, res) => {
  try {
    const postId = req.params.postId;
    const commentId = req.params.commentId;
    const userId = req.user._id;

    // Use atomic update instead of loading the entire post
    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const likeIndex = comment.likes.indexOf(userId);
    const isLiking = likeIndex === -1;
    
    // Use atomic update to avoid version conflicts
    let update;
    if (isLiking) {
      update = { $addToSet: { "comments.$[comment].likes": userId } };
    } else {
      update = { $pull: { "comments.$[comment].likes": userId } };
    }

    const options = {
      arrayFilters: [{ "comment._id": commentId }],
      new: true
    };

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      update,
      options
    ).populate('comments.author', 'username name avatar');

    if (!updatedPost) {
      return res.status(404).json({
        success: false,
        message: 'Post not found after update'
      });
    }

    const updatedComment = updatedPost.comments.id(commentId);
    const newLikeCount = updatedComment.likes.length;

    // Send notification only when liking (not unliking)
    if (isLiking && comment.author.toString() !== userId.toString()) {
      const commentAuthor = await User.findById(comment.author);
      await commentAuthor.addNotification({
        type: 'like',
        fromUser: userId,
        post: postId,
        comment: commentId,
        message: `${req.user.name} liked your comment`
      });

      // REAL-TIME: Notify comment author
      const wss = getWebSocketServer(req);
      if (wss && typeof wss.notifyNewNotification === 'function') {
        const notification = {
          type: 'like',
          fromUser: userId,
          post: postId,
          comment: commentId,
          message: `${req.user.name} liked your comment`,
          read: false,
          createdAt: new Date()
        };
        wss.notifyNewNotification(comment.author, notification);
      }
    }

    // REAL-TIME: Notify all clients about comment like update
    const wss = getWebSocketServer(req);
    if (wss && typeof wss.notifyCommentLiked === 'function') {
      wss.notifyCommentLiked(
        postId, 
        commentId, 
        userId, 
        isLiking, 
        newLikeCount
      );
    }

    res.json({
      success: true,
      liked: isLiking,
      likeCount: newLikeCount
    });
  } catch (error) {
    console.error('Like comment error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post or comment ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while liking comment'
    });
  }
});

// Like reply - FIXED: Use atomic operations to avoid VersionError
router.post('/:postId/comments/:commentId/replies/:replyId/like', auth, async (req, res) => {
  try {
    const postId = req.params.postId;
    const commentId = req.params.commentId;
    const replyId = req.params.replyId;
    const userId = req.user._id;

    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(replyId);
    
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    const likeIndex = reply.likes.indexOf(userId);
    const isLiking = likeIndex === -1;
    
    // Use atomic update to avoid version conflicts
    let update;
    if (isLiking) {
      update = { 
        $addToSet: { 
          "comments.$[comment].replies.$[reply].likes": userId 
        } 
      };
    } else {
      update = { 
        $pull: { 
          "comments.$[comment].replies.$[reply].likes": userId 
        } 
      };
    }

    const options = {
      arrayFilters: [
        { "comment._id": commentId },
        { "reply._id": replyId }
      ],
      new: true
    };

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      update,
      options
    ).populate('comments.replies.author', 'username name avatar');

    if (!updatedPost) {
      return res.status(404).json({
        success: false,
        message: 'Post not found after update'
      });
    }

    const updatedComment = updatedPost.comments.id(commentId);
    const updatedReply = updatedComment.replies.id(replyId);
    const newLikeCount = updatedReply.likes.length;

    // Send notification only when liking (not unliking)
    if (isLiking && reply.author.toString() !== userId.toString()) {
      const replyAuthor = await User.findById(reply.author);
      await replyAuthor.addNotification({
        type: 'like',
        fromUser: userId,
        post: postId,
        comment: commentId,
        reply: replyId,
        message: `${req.user.name} liked your reply`
      });

      // REAL-TIME: Notify reply author
      const wss = getWebSocketServer(req);
      if (wss && typeof wss.notifyNewNotification === 'function') {
        const notification = {
          type: 'like',
          fromUser: userId,
          post: postId,
          comment: commentId,
          reply: replyId,
          message: `${req.user.name} liked your reply`,
          read: false,
          createdAt: new Date()
        };
        wss.notifyNewNotification(reply.author, notification);
      }
    }

    // REAL-TIME: Use specific reply like notification
    const wss = getWebSocketServer(req);
    if (wss) {
      if (typeof wss.notifyReplyLiked === 'function') {
        wss.notifyReplyLiked(
          postId,
          commentId,
          replyId,
          userId,
          isLiking,
          newLikeCount
        );
      } else if (typeof wss.notifyPostUpdated === 'function') {
        // Fallback: update the entire post
        const fullyPopulatedPost = await Post.findById(postId)
          .populate('author', 'username name avatar')
          .populate('comments.author', 'username name avatar')
          .populate('comments.replies.author', 'username name avatar');
        wss.notifyPostUpdated(fullyPopulatedPost);
      }
    }

    res.json({
      success: true,
      liked: isLiking,
      likeCount: newLikeCount
    });
  } catch (error) {
    console.error('Like reply error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post, comment or reply ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while liking reply'
    });
  }
});

// Delete comment
router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if user is the author of the comment OR the post author
    const isCommentAuthor = comment.author.toString() === req.user._id.toString();
    const isPostAuthor = post.author.toString() === req.user._id.toString();
    
    if (!isCommentAuthor && !isPostAuthor) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this comment'
      });
    }

    // Store IDs for WebSocket notification
    const postId = post._id;
    const commentId = comment._id;
    const commentAuthorId = comment.author;

    // Use pull method to remove comment from array
    post.comments.pull({ _id: req.params.commentId });
    await post.save();

    // Update user's comment count (only if user deleted their own comment)
    if (isCommentAuthor) {
      await User.findByIdAndUpdate(commentAuthorId, {
        $inc: { 'stats.commentCount': -1 }
      });
    }

    // REAL-TIME: Notify all clients about deleted comment
    const wss = getWebSocketServer(req);
    if (wss && typeof wss.notifyCommentDeleted === 'function') {
      await wss.notifyCommentDeleted(postId, commentId);
    }

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post or comment ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while deleting comment'
    });
  }
});

// Delete reply
router.delete('/:postId/comments/:commentId/replies/:replyId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(req.params.replyId);
    
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check if user is the author of the reply
    if (reply.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this reply'
      });
    }

    // Store IDs for WebSocket notification
    const postId = post._id;
    const commentId = comment._id;
    const replyId = reply._id;
    const replyAuthorId = reply.author;

    // Use pull method to remove reply from array
    comment.replies.pull({ _id: req.params.replyId });
    await post.save();

    // Update user's comment count
    await User.findByIdAndUpdate(replyAuthorId, {
      $inc: { 'stats.commentCount': -1 }
    });

    // REAL-TIME: Notify all clients about deleted reply
    const wss = getWebSocketServer(req);
    if (wss && typeof wss.notifyReplyDelete === 'function') {
      await wss.notifyReplyDelete(postId, commentId, replyId);
    }

    res.json({
      success: true,
      message: 'Reply deleted successfully'
    });
  } catch (error) {
    console.error('Delete reply error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post, comment or reply ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while deleting reply'
    });
  }
});

// Get comments for a post
router.get('/:postId/comments', async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId)
      .populate('comments.author', 'username name avatar')
      .populate('comments.replies.author', 'username name avatar')
      .select('comments');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    res.json({
      success: true,
      comments: post.comments
    });
  } catch (error) {
    console.error('Get comments error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while fetching comments'
    });
  }
});

// Edit comment
router.put('/:postId/comments/:commentId', [
  auth,
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Comment content is required')
    .isLength({ max: 1000 })
    .withMessage('Comment cannot be more than 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if user is the author of the comment
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this comment'
      });
    }

    // Update comment content
    comment.content = req.body.content.trim();
    comment.updatedAt = new Date();

    await post.save();

    // Populate the updated comment
    const populatedPost = await Post.findById(post._id)
      .populate('comments.author', 'username name avatar')
      .populate('comments.replies.author', 'username name avatar');
    
    const updatedComment = populatedPost.comments.id(req.params.commentId);

    // REAL-TIME: Notify all clients about updated comment
    const wss = getWebSocketServer(req);
    if (wss && typeof wss.notifyCommentUpdated === 'function') {
      await wss.notifyCommentUpdated(post._id, updatedComment);
    }

    res.json({
      success: true,
      comment: updatedComment,
      message: 'Comment updated successfully'
    });
  } catch (error) {
    console.error('Edit comment error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post or comment ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while editing comment'
    });
  }
});

// Edit reply
router.put('/:postId/comments/:commentId/replies/:replyId', [
  auth,
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Reply content is required')
    .isLength({ max: 500 })
    .withMessage('Reply cannot be more than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const post = await Post.findById(req.params.postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const comment = post.comments.id(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const reply = comment.replies.id(req.params.replyId);
    
    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check if user is the author of the reply
    if (reply.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this reply'
      });
    }

    // Update reply content
    reply.content = req.body.content.trim();
    reply.updatedAt = new Date();

    await post.save();

    // Populate the updated reply
    const populatedPost = await Post.findById(post._id)
      .populate('comments.replies.author', 'username name avatar');
    
    const updatedComment = populatedPost.comments.id(req.params.commentId);
    const updatedReply = updatedComment.replies.id(req.params.replyId);

    // REAL-TIME: Notify all clients about updated reply
    const wss = getWebSocketServer(req);
    if (wss && typeof wss.notifyReplyUpdated === 'function') {
      await wss.notifyReplyUpdated(post._id, req.params.commentId, updatedReply);
    }

    res.json({
      success: true,
      reply: updatedReply,
      message: 'Reply updated successfully'
    });
  } catch (error) {
    console.error('Edit reply error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid post, comment or reply ID'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while editing reply'
    });
  }
});

module.exports = router;