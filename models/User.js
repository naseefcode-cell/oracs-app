const mongoose = require('mongoose');
const argon2 = require('argon2');

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
    minlength: 8
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
    expires: Date,
    attempts: { type: Number, default: 0 }
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date,
  lastLogin: Date,
  lastPasswordChange: Date,
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
userSchema.index({ lockUntil: 1 });

// Virtual for account lock status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Hash password before saving using Argon2
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    // Use Argon2id for password hashing (resistant to both GPU and side-channel attacks)
    this.password = await argon2.hash(this.password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16, // 64MB
      timeCost: 3,
      parallelism: 1,
      hashLength: 32
    });
    
    // Update last password change
    this.lastPasswordChange = new Date();
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

// Compare password method with Argon2
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await argon2.verify(this.password, candidatePassword);
  } catch (error) {
    console.error('Password comparison error:', error);
    return false;
  }
};

// Increment login attempts
userSchema.methods.incrementLoginAttempts = async function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  // Otherwise, increment
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock the account if we've reached max attempts and it's not locked already
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  
  return this.updateOne(updates);
};

// Reset login attempts on successful login
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
    lastLogin: new Date()
  });
};

// Add notification method
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

// Virtual for posts count
userSchema.virtual('postsCount').get(function() {
  return 0;
});

// To JSON transform
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.otp;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  delete user.loginAttempts;
  delete user.lockUntil;
  return user;
};

module.exports = mongoose.model('User', userSchema);
