// server.js - Updated CORS configuration
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');

require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'https://www.therein.in',
    'https://therein.in',
    'http://localhost:3000', // For development
    process.env.CLIENT_URL || 'https://www.therein.in'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Enhanced security middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  next();
});

// MongoDB Connection with enhanced error handling
const connectDB = async () => {
  try {
    console.log('🔗 Connecting to MongoDB Atlas...');
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000, // 45 seconds
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    
    // Handle MongoDB connection events
    mongoose.connection.on('error', err => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
    });
    
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('💡 Please check your MONGODB_URI in environment variables');
    process.exit(1);
  }
};

// Import routes
const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const userRoutes = require('./routes/users');
const profileRoutes = require('./routes/profile');
const notificationRoutes = require('./routes/notifications');
const followRoutes = require('./routes/follow');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/follow', followRoutes);

// Enhanced health check endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const memoryUsage = process.memoryUsage();
  
  res.json({ 
    success: true,
    status: 'OK', 
    database: dbStatus,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    domain: 'https://www.therein.in',
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
    }
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'ThereIn API is running!',
    version: '1.0.0',
    domain: 'https://www.therein.in',
    authentication: true,
    endpoints: {
      auth: '/api/auth',
      posts: '/api/posts',
      users: '/api/users',
      profile: '/api/profile',
      notifications: '/api/notifications'
    }
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('🚨 Server Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl
  });
});

const PORT = process.env.PORT || 5000;

// Connect to database and start server
connectDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ThereIn Production Server Started Successfully!');
    console.log(`📍 Server URL: http://0.0.0.0:${PORT}`);
    console.log(`🌐 Production URL: https://www.therein.in`);
    console.log(`🔗 API: https://www.therein.in/api`);
    console.log(`❤️  Health: https://www.therein.in/api/health`);
    console.log(`⚡ Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    
    // Log important environment variables (without sensitive data)
    console.log(`🔧 Config:`, {
      nodeEnv: process.env.NODE_ENV,
      hasMongoURI: !!process.env.MONGODB_URI,
      hasJWTSecret: !!process.env.JWT_SECRET,
      hasGmailUser: !!process.env.GMAIL_USER
    });
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
