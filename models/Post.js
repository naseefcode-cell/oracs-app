// models/Post.js - Fixed
const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  content: {
    type: String,
    required: [true, 'Comment content is required'],
    trim: true,
    maxlength: [1000, 'Comment cannot be more than 1000 characters']
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // New: Nested replies
  replies: [{
    content: {
      type: String,
      required: true,
      maxlength: 500
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    likes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

const PostSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot be more than 200 characters']
  },
  content: {
    type: String,
    required: [true, 'Content is required'],
    maxlength: [10000, 'Content cannot be more than 10000 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: [
      'Neuroscience', 
      'Climate Science', 
      'Computer Science', 
      'Biology', 
      'Physics', 
      'Medicine', 
      'Psychology', 
      'Economics', 
      'Other'
    ]
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [CommentSchema],
  // New: Repost functionality
  isRepost: {
    type: Boolean,
    default: false
  },
  originalPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  },
  repostedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  repostCount: {
    type: Number,
    default: 0
  },
  // Track saves
  savedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Post visibility
  visibility: {
    type: String,
    enum: ['public', 'followers', 'private'],
    default: 'public'
  },
  // Engagement metrics
  views: {
    type: Number,
    default: 0
  },
  // For sorting and recommendations
  hotScore: {
    type: Number,
    default: 0
  },
  trendingScore: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Add index for search functionality
PostSchema.index({ 
  title: 'text', 
  content: 'text', 
  category: 'text', 
  tags: 'text' 
});

PostSchema.index({ author: 1, createdAt: -1 });
PostSchema.index({ isRepost: 1, originalPost: 1 });
PostSchema.index({ hotScore: -1 });
PostSchema.index({ trendingScore: -1 });
PostSchema.index({ createdAt: -1 });

// FIXED: Virtual for like count with safe array access
PostSchema.virtual('likeCount').get(function() {
  return this.likes ? this.likes.length : 0;
});

// FIXED: Virtual for comment count with safe array access
PostSchema.virtual('commentCount').get(function() {
  return this.comments ? this.comments.length : 0;
});

// FIXED: Virtual for save count with safe array access
PostSchema.virtual('saveCount').get(function() {
  return this.savedBy ? this.savedBy.length : 0;
});

// FIXED: Calculate hot score with safe array access
PostSchema.methods.calculateHotScore = function() {
  const likes = (this.likes ? this.likes.length : 0) * 2;
  const comments = (this.comments ? this.comments.length : 0) * 3;
  const reposts = this.repostCount * 4;
  const saves = (this.savedBy ? this.savedBy.length : 0) * 2;
  const views = this.views * 0.1;
  
  const engagement = likes + comments + reposts + saves + views;
  
  // Time decay (posts lose score over time)
  const hoursSinceCreation = (Date.now() - this.createdAt) / (1000 * 60 * 60);
  const timeDecay = Math.pow(0.95, hoursSinceCreation);
  
  this.hotScore = engagement * timeDecay;
  return this.hotScore;
};

// FIXED: Calculate trending score with safe array access
PostSchema.methods.calculateTrendingScore = function() {
  const recentEngagement = (this.likes ? this.likes.length : 0) + 
                          (this.comments ? this.comments.length : 0) * 2 + 
                          this.repostCount;
  const timeSinceCreation = (Date.now() - this.createdAt) / (1000 * 60 * 60); // hours
  
  // Higher score for recent posts with high engagement
  if (timeSinceCreation < 24) {
    this.trendingScore = recentEngagement * (1 - (timeSinceCreation / 24));
  } else {
    this.trendingScore = recentEngagement * 0.1; // Older posts get lower score
  }
  
  return this.trendingScore;
};

// Middleware to update scores before saving
PostSchema.pre('save', function(next) {
  if (this.isModified('likes') || this.isModified('comments') || this.isModified('repostCount') || this.isModified('savedBy')) {
    this.calculateHotScore();
    this.calculateTrendingScore();
  }
  next();
});

// FIXED: Ensure virtual fields are serialized in both toObject and toJSON
PostSchema.set('toObject', { virtuals: true });
PostSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Post', PostSchema);