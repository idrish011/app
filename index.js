const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const dotenv = require('dotenv');
const compression = require('compression');
const xss = require('xss-clean');
const hpp = require('hpp');
const slowDown = require('express-slow-down');
const winston = require('winston');
const expressWinston = require('express-winston');
const { v4: uuidv4 } = require('uuid');

// Import routes
const authRoutes = require('./routes/auth');
const collegeRoutes = require('./routes/colleges');
const academicRoutes = require('./routes/academic');
const feeRoutes = require('./routes/fees');
const adminRoutes = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');
const crudRoutes = require('./routes/crud');
const collegeFeeManagementRoutes = require('./routes/collegeFeeManagement');
const appRoutes = require('./routes/app');
const messageRoutes = require('./routes/messages');
const publicRoutes = require('./routes/public');

// Import middleware
const SecurityMiddleware = require('./middleware/security');

// Import database model
const Database = require('./models/database');

// Load environment variables
dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// SECURITY: Enforce strong JWT secret in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('CRITICAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8081',
  'https://app-in84.onrender.com',
  'https://fullapp-ijlz.onrender.com'
];

// Initialize database
const db = new Database();
const security = new SecurityMiddleware();
const AuthMiddleware = require('./middleware/auth');
const auth = new AuthMiddleware();

(async function startup() {
  try {
    // Ensure all tables are created before any queries
    await db.initializeTables();

    // Wait for tables to be ready before checking/creating super admin
    const usersTable = await db.get(
      `SELECT to_regclass('public.users') as exists`
    );
    if (!usersTable || !usersTable.exists) {
      throw new Error('Users table was not created. Check your database connection and schema.');
    }

    // --- Super Admin Auto-Creation Logic ---
    const existingAdmin = await db.get('SELECT id FROM users WHERE email = $1', ['admin@campuslink.com']);
    if (!existingAdmin) {
      const userId = uuidv4();
      const passwordHash = await auth.hashPassword('admin123');
      await db.run(
        `INSERT INTO users (
          id, college_id, username, email, password_hash, first_name, last_name, 
          role, phone, date_of_birth, gender, address, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          userId,
          null,
          'admin',
          'admin@campuslink.com',
          passwordHash,
          'Super',
          'Admin',
          'super_admin',
          null,
          null,
          null,
          null,
          'active'
        ]
      );
      console.log('Default super admin created: admin@campuslink.com / admin123');
    } else {
      console.log('Default super admin already exists');
    }
  } catch (error) {
    console.error('Error during startup:', error);
    process.exit(1); // Exit if tables are not created or admin cannot be created
  }
})();

// Enhanced security middleware setup
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration with security
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['X-Total-Count']
}));

// Rate limiting - ENABLED FOR PRODUCTION
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  // General rate limiter
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.'
      });
    }
  });

  // Stricter rate limiter for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: {
      error: 'Too many authentication attempts',
      message: 'Too many login attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Apply rate limiting
  app.use('/api/auth', authLimiter);
  app.use(generalLimiter);

  // Slow down requests
  const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // allow 50 requests per 15 minutes, then...
    delayMs: 500, // begin adding 500ms of delay per request above 50
    maxDelayMs: 20000 // maximum delay of 20 seconds
  });
  app.use(speedLimiter);
}

// Additional security middleware
app.use(compression()); // Compress responses
app.use(xss()); // Prevent XSS attacks
app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Security headers middleware
app.use(security.securityHeaders);

// Input sanitization middleware
app.use(security.preventXSS);
app.use(security.preventSQLInjection);

// Logging setup with security considerations
const logger = winston.createLogger({
  level: isProduction ? 'warn' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'campuslink-api' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
  ],
});

if (!isProduction) {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Request logging with security filtering
app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: "HTTP {{req.method}} {{req.url}}",
  expressFormat: true,
  colorize: false,
  // Filter out sensitive data
  requestFilter: (req, propName) => {
    if (propName === 'headers') {
      const filtered = { ...req.headers };
      delete filtered.authorization;
      delete filtered.cookie;
      return filtered;
    }
    return req[propName];
  }
}));

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'CampusLink Multi-Tenant SaaS API', 
    version: '1.0.0',
    status: 'secure',
    features: [
      'Multi-tenant architecture',
      'Role-based access control',
      'Academic management',
      'Fee collection',
      'Attendance tracking',
      'Assignment management',
      'Result publishing',
      'Parent portal',
      'Dashboard analytics',
      'CRUD operations'
    ]
  });
});

// Static file serving for uploads with security
app.use('/uploads', express.static('uploads', {
  setHeaders: (res, path) => {
    // Set security headers for uploaded files
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Set appropriate content type for common file types
    const ext = path.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
      res.setHeader('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    }
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/colleges', collegeRoutes);
app.use('/api/academic', academicRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/crud', crudRoutes);
app.use('/api/college', collegeFeeManagementRoutes);
app.use('/api/app', appRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/public', publicRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// Security error handling middleware
app.use(security.errorHandler);

// General error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Don't expose internal errors in production
  const errorMessage = isProduction ? 'Internal server error' : err.message;
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: errorMessage
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: 'The requested resource was not found'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  try {
    await db.close();
    console.log('Database connection closed.');
  } catch (err) {
    console.error('Error closing database:', err.message);
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Utility: Generate password hash for manual admin creation
if (process.argv.includes('--hash-admin-password')) {
  const password = process.argv[process.argv.indexOf('--hash-admin-password') + 1];
  if (!password) {
    console.error('Usage: node index.js --hash-admin-password <password>');
    process.exit(1);
  }
  bcrypt.hash(password, 12).then(hash => {
    console.log(`Password hash for "${password}":\n${hash}`);
    process.exit(0);
  });
}

// Only start the server if not running the hash utility
if (!process.argv.includes('--hash-admin-password')) {
  app.listen(PORT, async () => {
    console.log(`🚀 CampusLink API server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Security: ${isProduction ? 'Production mode' : 'Development mode'}`);
    if (isProduction) {
      console.log('✅ Rate limiting enabled');
      console.log('✅ Security headers enabled');
      console.log('✅ Input validation enabled');
    }
    try {
      // Test Neon/Postgres DB connection
      await db.pool.query('SELECT 1');
      console.log('🟢 Neon/Postgres DB connection is ready');
    } catch (err) {
      console.error('🔴 Neon/Postgres DB connection failed:', err.message);
    }

    // Prevent server sleep: ping /api/health every 10 minutes
    setInterval(() => {
      const http = require('http');
      const url = `http://localhost:${PORT}/api/health`;
      http.get(url, (res) => {
        console.log(`[KeepAlive] Pinged /api/health - Status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.error('[KeepAlive] Error pinging /api/health:', err.message);
      });
    }, 10 * 60 * 1000); // 10 minutes
  });
}