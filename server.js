const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const prerender = require('prerender-node');

require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const WebSocketServer = require('./websocket');
const wss = new WebSocketServer(server);

// Make WebSocket server available to routes
app.set('websocket', wss);

// Prerender.io Configuration - MUST BE FIRST MIDDLEWARE
if (process.env.NODE_ENV === 'production' && process.env.PRERENDER_TOKEN) {
  app.use(prerender
    .set('prerenderToken', process.env.PRERENDER_TOKEN)
    .set('protocol', 'https')
    .set('host', 'www.oracs.in')
    .set('forwardHeaders', true)
    
    // Whitelist domains
    .set('whitelist', [
      'www.oracs.in',
      'oracs.in'
    ])
    
    // Blacklist API and static routes
    .blacklisted([
      '/api/*',
      '*.json',
      '*.xml',
      '*.txt',
      '/sitemap*',
      '/robots.txt',
      '/health',
      '/api/*',
      '/socket.io/*',
      '*.js',
      '*.css',
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.ico'
    ])
    
    // After render callback for debugging
    .set('afterRender', function(error, req) {
      if (error) {
        console.log('❌ Prerender error for URL:', req.url, error.message);
      } else {
        console.log('✅ Prerender successfully rendered:', req.url);
      }
    })
  );
  
  console.log('✅ Prerender.io configured for production');
} else if (process.env.NODE_ENV === 'production') {
  console.log('⚠️  Prerender.io token not found - SEO may be affected');
}

// Middleware - Production CORS settings
app.use(cors({
  origin: [
    'https://www.therein.in',
    'https://therein.in',
    process.env.CLIENT_URL || 'https://www.therein.in'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Security middleware for production
app.use((req, res, next) => {
  // Skip HTTPS redirect for API routes
  if (process.env.NODE_ENV === 'production' && !req.secure && !req.path.startsWith('/api/')) {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Allow Prerender bot to access content
  const userAgent = req.headers['user-agent'] || '';
  const isPrerenderBot = userAgent.includes('Prerender');
  
  if (!isPrerenderBot) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  
  next();
});

// Static files middleware - AFTER prerender
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  index: false // Let the SPA handle routing
}));

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

// Prerender test endpoint
app.get('/prerender-test', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  const isCrawler = prerender.isCrawler ? prerender.isCrawler(req) : false;
  
  res.json({
    success: true,
    message: 'Prerender Test Endpoint',
    userAgent: userAgent,
    isCrawler: isCrawler,
    prerender: {
      configured: !!(process.env.PRERENDER_TOKEN),
      token: process.env.PRERENDER_TOKEN ? 'Set' : 'Not Set',
      environment: process.env.NODE_ENV
    },
    timestamp: new Date().toISOString(),
    url: 'https://www.oracs.in/prerender-test'
  });
});

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
    prerender: {
      configured: !!(process.env.PRERENDER_TOKEN),
      status: process.env.PRERENDER_TOKEN ? 'Active' : 'Inactive'
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    domain: 'https://www.oracs.in'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'therein API is running!',
    version: '1.0.0',
    realtime: true,
    domain: 'https://www.oracs.in',
    prerender: process.env.PRERENDER_TOKEN ? 'Enabled' : 'Disabled',
    endpoints: {
      auth: '/api/auth',
      posts: '/api/posts',
      users: '/api/users',
      notifications: '/api/notifications',
      comments: '/api/posts/:postId/comments',
      health: '/api/health',
      prerender_test: '/prerender-test'
    }
  });
});

// Serve frontend for all other routes - SPA fallback
app.get('*', (req, res) => {
  // Don't serve HTML for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      message: 'API endpoint not found'
    });
  }
  
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
    console.log(`🔍 Prerender Test: https://www.oracs.in/prerender-test`);
    console.log(`⚡ Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`📡 MongoDB: Connected to Atlas Cluster`);
    console.log(`🔌 WebSocket: Real-time server running`);
    console.log(`👥 Connected clients: 0`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
    console.log(`🔒 HTTPS: Enabled`);
    console.log(`🌐 CORS: Configured for production domain`);
    
    // Prerender status
    if (process.env.PRERENDER_TOKEN) {
      console.log(`🤖 Prerender.io: ✅ Enabled with token`);
    } else {
      console.log(`🤖 Prerender.io: ❌ Disabled - No token found`);
    }
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server gracefully...');
  
  // Close WebSocket connections
  wss.clients.forEach(client => {
    client.terminate();
  });
  
  // Close MongoDB connection
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  }
  
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

module.exports = app;
