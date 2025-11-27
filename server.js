const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');

// 1. Import prerender-node
const prerender = require('prerender-node'); 

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
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`📡 MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

// 2. INTEGRATE PRERENDER-NODE
// This middleware must be placed BEFORE serving static files or the catch-all route.
// If you are using a Prerender.io token, set it in your Railway environment variables
// as PRERENDER_TOKEN, or set it directly here: .set('prerenderToken', 'YOUR_TOKEN_HERE')
// You can also use a self-hosted Prerender service by setting the base URL:
// .set('prerenderServiceUrl', 'http://your-prerender-server.com/')
if (process.env.NODE_ENV === 'production') {
  app.use(prerender.set('prerenderToken', process.env.PRERENDER_TOKEN));
}


// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/health', (req, res) => res.json({ success: true, message: 'Server is healthy', endpoints: {
    auth: '/api/auth',
    users: '/api/users/:username',
    posts: '/api/posts',
    comments: '/api/posts/:postId/comments'
  }
}));

// Serve frontend for all other routes
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files here

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
  });
});
