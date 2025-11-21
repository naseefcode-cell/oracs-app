const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const helmet = require('helmet'); // Added for security
const compression = require('compression'); // Added for performance

require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Performance middleware
app.use(compression());

// Initialize WebSocket server
const WebSocketServer = require('./websocket');
const wss = new WebSocketServer(server);

// Make WebSocket server available to routes
app.set('websocket', wss);

// Middleware - Updated CORS for production
app.use(cors({
  origin: [
    'https://www.oracs.in',
    'https://oracs.in',
    process.env.CLIENT_URL || 'https://www.oracs.in'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files with caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: false
}));

// MongoDB Connection with production optimizations
const connectDB = async () => {
  try {
    console.log('Connecting to MongoDB Atlas...');
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10, // Production pool size
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Rate limiting (you might want to add express-rate-limit package)
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/posts', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/profile', require('./routes/profile'));
const notificationRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationRoutes);
app.use('/api/follow', require('./routes/follow'));

// Health check endpoint
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
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Oracs API is running in production!',
    version: '1.0.0',
    realtime: true,
    production: true,
    domain: 'https://www.oracs.in',
    endpoints: {
      auth: '/api/auth',
      posts: '/api/posts',
      users: '/api/users',
      notifications: '/api/notifications',
      comments: '/api/posts/:postId/comments'
    }
  });
});

// Serve frontend for all other routes (SPA support)
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
  server.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces
    console.log('\n🚀 Oracs Production Server Started Successfully!');
    console.log(`📍 Domain: https://www.oracs.in`);
    console.log(`🔗 API: https://www.oracs.in/api`);
    console.log(`❤️  Health: https://www.oracs.in/api/health`);
    console.log(`⚡ Environment: ${process.env.NODE_ENV}`);
    console.log(`📡 MongoDB: Connected to Atlas Cluster`);
    console.log(`🔌 WebSocket: Real-time server running`);
    console.log(`👥 Connected clients: 0`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    console.log(`🔒 Security: Helmet enabled`);
    console.log(`📦 Compression: Enabled`);
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    mongoose.connection.close();
    console.log('Process terminated');
  });
});
