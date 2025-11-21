
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Post = require('./models/Post');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map();
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on('connection', async (ws, req) => {
      console.log('🔗 New WebSocket connection attempt');

      try {
        // Authenticate connection using JWT from query string
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (!token) {
          ws.close(1008, 'Authentication required');
          return;
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
          ws.close(1008, 'User not found');
          return;
        }

        // Store connection with user info
        this.clients.set(user._id.toString(), { ws, user });
        console.log(`✅ WebSocket connected for user: ${user.username}`);
        console.log(`👥 Total connected clients: ${this.clients.size}`);

        // Send initial connection confirmation
        this.sendToUser(user._id, {
          type: 'connection_established',
          message: 'Real-time connection established',
          timestamp: new Date().toISOString()
        });

        // Handle messages from client
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            this.handleMessage(user, message);
          } catch (error) {
            console.error('WebSocket message error:', error);
            this.sendToUser(user._id, {
              type: 'error',
              message: 'Invalid message format'
            });
          }
        });

        // Handle disconnection
        ws.on('close', () => {
          this.clients.delete(user._id.toString());
          console.log(`❌ WebSocket disconnected for user: ${user.username}`);
          console.log(`👥 Remaining clients: ${this.clients.size}`);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.clients.delete(user._id.toString());
        });

        // Send periodic ping to keep connection alive
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            this.sendToUser(user._id, { type: 'ping', timestamp: Date.now() });
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);

        ws.on('close', () => {
          clearInterval(pingInterval);
        });

      } catch (error) {
        console.error('WebSocket authentication error:', error);
        ws.close(1008, 'Authentication failed');
      }
    });
  }

  handleMessage(user, message) {
    switch (message.type) {
      case 'ping':
        this.sendToUser(user._id, { type: 'pong', timestamp: Date.now() });
        break;
      case 'subscribe_posts':
        this.sendToUser(user._id, { 
          type: 'subscription_confirmed', 
          subscription: 'posts' 
        });
        break;
      case 'subscribe_user':
        this.sendToUser(user._id, { 
          type: 'subscription_confirmed', 
          subscription: `user:${message.userId}` 
        });
        break;
      case 'typing_start':
        this.broadcastToPost(message.postId, user._id, {
          type: 'user_typing',
          userId: user._id,
          username: user.username,
          typing: true
        });
        break;
      case 'typing_stop':
        this.broadcastToPost(message.postId, user._id, {
          type: 'user_typing',
          userId: user._id,
          username: user.username,
          typing: false
        });
        break;
      default:
        console.log('Unknown message type:', message.type);
        this.sendToUser(user._id, {
          type: 'error',
          message: `Unknown message type: ${message.type}`
        });
    }
  }

  // Send message to specific user
  sendToUser(userId, data) {
    const client = this.clients.get(userId.toString());
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify({
          ...data,
          timestamp: new Date().toISOString()
        }));
      } catch (error) {
        console.error('Error sending message to user:', error);
      }
    }
  }

  // Broadcast to all connected clients
  broadcast(data, excludeUserId = null) {
    this.clients.forEach((client, userId) => {
      if (userId !== excludeUserId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify({
            ...data,
            timestamp: new Date().toISOString()
          }));
        } catch (error) {
          console.error('Error broadcasting message:', error);
        }
      }
    });
  }

  // Send to multiple specific users
  sendToUsers(userIds, data) {
    userIds.forEach(userId => this.sendToUser(userId, data));
  }

  // Broadcast to users watching a specific post
  broadcastToPost(postId, excludeUserId = null, data) {
    // For now, broadcast to all users. In production, you might want to track post subscriptions
    this.broadcast({
      ...data,
      postId
    }, excludeUserId);
  }

  // Post-related events
  async notifyNewPost(post) {
    try {
      const populatedPost = await Post.findById(post._id)
        .populate('author', 'username name avatar field')
        .populate('likes', 'username name avatar')
        .populate('comments.author', 'username name avatar');

      const data = {
        type: 'new_post',
        post: populatedPost
      };

      // Broadcast to all users except the author
      this.broadcast(data, post.author._id.toString());
    } catch (error) {
      console.error('Error notifying new post:', error);
    }
  }

  async notifyUpdatedPost(post) {
    try {
      const populatedPost = await Post.findById(post._id)
        .populate('author', 'username name avatar field')
        .populate('likes', 'username name avatar')
        .populate('comments.author', 'username name avatar');

      this.broadcast({
        type: 'post_updated',
        post: populatedPost
      });
    } catch (error) {
      console.error('Error notifying updated post:', error);
    }
  }

  async notifyDeletedPost(postId) {
    this.broadcast({
      type: 'post_deleted',
      postId
    });
  }

  async notifyPostCreated(post) {
    try {
      const populatedPost = await Post.findById(post._id)
        .populate('author', 'username name avatar field')
        .populate('likes', 'username name avatar')
        .populate('comments.author', 'username name avatar');

      const data = {
        type: 'post_created',
        post: populatedPost
      };

      // Broadcast to all users except the author
      this.broadcast(data, post.author._id.toString());
      console.log(`📤 Notified post created: ${post._id}`);
    } catch (error) {
      console.error('Error notifying post created:', error);
    }
  }

  async notifyPostShared(postId, shareCount, post = null) {
    try {
      let populatedPost = post;
      if (!populatedPost) {
        populatedPost = await Post.findById(postId)
          .populate('author', 'username name avatar field')
          .populate('shares.sharedBy', 'username name avatar');
      }

      this.broadcast({
        type: 'post_shared',
        postId,
        shareCount,
        post: populatedPost,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📤 Notified post shared: ${postId} with ${shareCount} shares`);
    } catch (error) {
      console.error('Error notifying post shared:', error);
    }
  }

  // Like-related events
  async notifyPostLiked(post, userId, liked) {
    try {
      const user = await User.findById(userId).select('username name');
      this.broadcast({
        type: 'post_like_updated',
        postId: post._id,
        userId,
        user: { username: user.username, name: user.name },
        liked,
        likeCount: post.likes.length
      });
    } catch (error) {
      console.error('Error notifying post like:', error);
    }
  }

  // Post save/unsave events
  async notifyPostSaved(post, userId, saved) {
    try {
      const populatedPost = await Post.findById(post._id)
        .populate('author', 'username name avatar field')
        .populate('likes', 'username name avatar')
        .populate('savedBy', 'username name avatar')
        .populate('comments.author', 'username name avatar');

      // Notify the user who performed the action
      this.sendToUser(userId, {
        type: 'post_save_updated',
        postId: post._id,
        saved,
        saveCount: populatedPost.savedBy.length,
        post: populatedPost
      });

      // Also broadcast to other users viewing the same post
      this.broadcastToPost(post._id, userId.toString(), {
        type: 'post_save_updated',
        postId: post._id,
        saved,
        saveCount: populatedPost.savedBy.length,
        userId: userId.toString()
      });
    } catch (error) {
      console.error('Error notifying post save:', error);
    }
  }

  // Comment-related events - CLEANED UP VERSION
  async notifyNewComment(postId, comment) {
    try {
      const populatedPost = await Post.findOne(
        { _id: postId, 'comments._id': comment._id },
        { 'comments.$': 1 }
      )
      .populate('comments.author', 'username name avatar')
      .populate('comments.likes', 'username name')
      .populate('comments.replies.author', 'username name avatar')
      .populate('comments.replies.likes', 'username name');

      if (populatedPost && populatedPost.comments.length > 0) {
        const fullComment = populatedPost.comments[0];
        
        this.broadcast({
          type: 'new_comment',
          postId,
          comment: fullComment,
          timestamp: new Date().toISOString()
        });
        console.log(`💬 Notified new comment: ${comment._id}`);
      }
    } catch (error) {
      console.error('Error notifying new comment:', error);
      this.broadcast({
        type: 'new_comment',
        postId,
        comment,
        timestamp: new Date().toISOString()
      });
    }
  }

  async notifyCommentLiked(postId, commentId, userId, liked, likeCount) {
    try {
      const post = await Post.findById(postId);
      if (!post) return;

      const comment = post.comments.id(commentId);
      if (!comment) return;

      this.broadcast({
        type: 'comment_like_updated',
        postId,
        commentId,
        userId,
        liked,
        likeCount: comment.likes.length,
        timestamp: new Date().toISOString()
      });
      console.log(`❤️ Notified comment liked: ${commentId}`);
    } catch (error) {
      console.error('Error notifying comment like:', error);
      this.broadcast({
        type: 'comment_like_updated',
        postId,
        commentId,
        userId,
        liked,
        likeCount,
        timestamp: new Date().toISOString()
      });
    }
  }

  async notifyCommentDeleted(postId, commentId) {
    try {
      this.broadcast({
        type: 'comment_deleted',
        postId,
        commentId,
        timestamp: new Date().toISOString()
      });
      console.log(`🗑️ Notified comment deleted: ${commentId} from post: ${postId}`);
    } catch (error) {
      console.error('Error notifying comment deletion:', error);
    }
  }

  // Reply-related events - CLEANED UP VERSION
  async notifyReplyAdded(postId, commentId, reply) {
    try {
      const post = await Post.findOne(
        { _id: postId, 'comments._id': commentId },
        { 'comments.$': 1 }
      )
      .populate('comments.replies.author', 'username name avatar')
      .populate('comments.replies.likes', 'username name');

      if (post && post.comments.length > 0) {
        const comment = post.comments[0];
        const populatedReply = comment.replies.find(r => r._id.toString() === reply._id.toString()) || reply;

        this.broadcast({
          type: 'reply_added',
          postId,
          commentId,
          reply: populatedReply,
          timestamp: new Date().toISOString()
        });
        console.log(`💬 Notified reply added: ${reply._id}`);
      }
    } catch (error) {
      console.error('Error notifying reply added:', error);
      this.broadcast({
        type: 'reply_added',
        postId,
        commentId,
        reply,
        timestamp: new Date().toISOString()
      });
    }
  }

  async notifyReplyLiked(postId, commentId, replyId, userId, liked, likeCount) {
    try {
      const post = await Post.findById(postId);
      if (!post) return;

      const comment = post.comments.id(commentId);
      if (!comment) return;

      const reply = comment.replies.id(replyId);
      if (!reply) return;

      this.broadcast({
        type: 'reply_like_updated',
        postId,
        commentId,
        replyId,
        userId,
        liked,
        likeCount: reply.likes.length,
        timestamp: new Date().toISOString()
      });
      console.log(`❤️ Notified reply liked: ${replyId}`);
    } catch (error) {
      console.error('Error notifying reply like:', error);
      this.broadcast({
        type: 'reply_like_updated',
        postId,
        commentId,
        replyId,
        userId,
        liked,
        likeCount,
        timestamp: new Date().toISOString()
      });
    }
  }
  // Add this to the WebSocketServer class in websocket.js

async notifyReplyLiked(postId, commentId, replyId, userId, liked, likeCount) {
  try {
    const post = await Post.findById(postId);
    if (!post) return;

    const comment = post.comments.id(commentId);
    if (!comment) return;

    const reply = comment.replies.id(replyId);
    if (!reply) return;

    // Broadcast to all connected clients
    this.broadcast({
      type: 'reply_like_updated',
      postId,
      commentId,
      replyId,
      userId,
      liked,
      likeCount: reply.likes.length,
      timestamp: new Date().toISOString()
    });
    
    console.log(`❤️ Notified reply liked: ${replyId}`);
  } catch (error) {
    console.error('Error notifying reply like:', error);
    // Fallback broadcast
    this.broadcast({
      type: 'reply_like_updated',
      postId,
      commentId,
      replyId,
      userId,
      liked,
      likeCount,
      timestamp: new Date().toISOString()
    });
  }
}

  async notifyReplyDelete(postId, commentId, replyId) {
    try {
      this.broadcast({
        type: 'reply_deleted',
        postId,
        commentId,
        replyId,
        timestamp: new Date().toISOString()
      });
      console.log(`🗑️ Notified reply deleted: ${replyId}`);
    } catch (error) {
      console.error('Error notifying reply deletion:', error);
    }
  }

  // Notification events
  notifyNewNotification(userId, notification) {
    this.sendToUser(userId, {
      type: 'new_notification',
      notification
    });
  }

  // User-related events
  notifyUserUpdate(user) {
    this.broadcast({
      type: 'user_updated',
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        bio: user.bio,
        field: user.field
      }
    });
  }

  // Follow-related events
  notifyFollowUpdate(followerId, targetUserId, following) {
    this.sendToUser(targetUserId, {
      type: 'follow_updated',
      followerId,
      following,
      timestamp: Date.now()
    });

    // Also notify the follower
    this.sendToUser(followerId, {
      type: 'follow_status_updated',
      targetUserId,
      following,
      timestamp: Date.now()
    });
  }

  // Online status
  notifyUserOnlineStatus(userId, online) {
    this.broadcast({
      type: 'user_online_status',
      userId,
      online,
      timestamp: Date.now()
    }, userId); // Don't send to the user themselves
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.clients.size;
  }

  // Get connected users
  getConnectedUsers() {
    const users = [];
    this.clients.forEach((client, userId) => {
      users.push({
        userId,
        username: client.user.username,
        name: client.user.name
      });
    });
    return users;
  }
}

module.exports = WebSocketServer;
