const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 20
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  avatar: {
    type: String,
    default: '{"initials":"US","color":"#2563eb"}'
  },
  bio: {
    type: String,
    maxlength: 500,
    default: ''
  },
  field: {
    type: String,
    default: 'Other'
  },
  institution: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
  },
  website: {
    type: String,
    default: ''
  },
  socialLinks: {
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' },
    orcid: { type: String, default: '' }
  },
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  emailVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    code: String,
    expires: Date
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    privateAccount: { type: Boolean, default: false }
  },
  notifications: [{
    type: {
      type: String,
      enum: ['follow', 'like', 'comment', 'reply', 'mention', 'system'],
      required: true
    },
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post'
    },
    message: {
      type: String,
      required: true
    },
    read: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Index for better performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ 'notifications.createdAt': -1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Generate avatar based on name
userSchema.pre('save', function(next) {
  if (this.isModified('name') || !this.avatar) {
    const colors = [
      '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', 
      '#db2777', '#0891b2', '#65a30d', '#ca8a04', '#9333ea'
    ];
    const initials = this.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    
    const color = colors[Math.floor(Math.random() * colors.length)];
    this.avatar = JSON.stringify({ initials, color });
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Add notification method (updated to avoid version conflicts)
userSchema.methods.addNotification = async function(notificationData) {
  try {
    const notification = {
      _id: new mongoose.Types.ObjectId(),
      type: notificationData.type,
      fromUser: notificationData.fromUser,
      message: notificationData.message,
      post: notificationData.post,
      read: false,
      createdAt: new Date()
    };

    // Use findByIdAndUpdate to avoid version conflicts
    await this.constructor.findByIdAndUpdate(
      this._id,
      {
        $push: {
          notifications: {
            $each: [notification],
            $position: 0
          }
        }
      }
    );

    return notification;
  } catch (error) {
    console.error('Add notification error:', error);
    throw error;
  }
};

// Virtual for follower count
userSchema.virtual('followerCount').get(function() {
  return this.followers.length;
});

// Virtual for following count
userSchema.virtual('followingCount').get(function() {
  return this.following.length;
});

// Virtual for posts count (you'll need to populate this from Post model)
userSchema.virtual('postsCount').get(function() {
  return 0; // This should be populated from the Post model
});

// To JSON transform
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.otp;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  return user;
};

module.exports = mongoose.model('User', userSchema);
