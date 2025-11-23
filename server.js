const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');

require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const WebSocketServer = require('./websocket');
const wss = new WebSocketServer(server);

// Make WebSocket server available to routes
app.set('websocket', wss);

// Middleware - Production CORS settings
app.use(cors({
  origin: [
    'https://www.therein.in',
    'https://therein.in',
    process.env.CLIENT_URL || 'https://www.therein.in'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Security middleware for production
// Security middleware for production
app.use((req, res, next) => {
  // Skip HTTPS redirect for API routes - they should always use HTTPS from frontend
  if (process.env.NODE_ENV === 'production' && !req.secure && !req.path.startsWith('/api/')) {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// MongoDB Connection with better error handling
const connectDB = async () => {
  try {
    console.log('Connecting to MongoDB Atlas...');
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/posts', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/profile', require('./routes/profile'));
const notificationRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationRoutes);
app.use('/api/follow', require('./routes/follow'));

app.get('/api/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'OK', 
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    websocket: {
      clients: wss.clients.size,
      status: 'Running'
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    domain: 'https://www.therein.in'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Oracs API is running!',
    version: '1.0.0',
    realtime: true,
    domain: 'https://www.therein.in',
    endpoints: {
      auth: '/api/auth',
      posts: '/api/posts',
      users: '/api/users',
      notifications: '/api/notifications',
      comments: '/api/posts/:postId/comments'
    }
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🚨 Error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

const PORT = process.env.PORT || 5000;

// Connect to database and start server
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log('\n🚀 Oracs Production Server Started Successfully!');
    console.log(`📍 Production URL: https://www.oracs.in`);
    console.log(`🔗 API: https://www.oracs.in/api`);
    console.log(`❤️  Health: https://www.oracs.in/api/health`);
    console.log(`⚡ Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`📡 MongoDB: Connected to Atlas Cluster`);
    console.log(`🔌 WebSocket: Real-time server running`);
    console.log(`👥 Connected clients: 0`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    console.log(`🔒 HTTPS: Enabled`);
    console.log(`🌐 CORS: Configured for production domain`);
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
