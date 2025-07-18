const { body, validationResult } = require('express-validator');
const path = require('path');
const crypto = require('crypto');

class SecurityMiddleware {
  constructor() {
    // Whitelist of allowed field names for dynamic SQL updates
    this.allowedFields = {
      student_fee_status: [
        'due_date', 'total_amount', 'status', 'remarks', 'amount_paid'
      ],
      users: [
        'username', 'email', 'first_name', 'last_name', 'phone', 
        'address', 'date_of_birth', 'gender', 'status'
      ],
      courses: [
        'name', 'code', 'description', 'credits', 'duration_months', 
        'fee_amount', 'status'
      ],
      assignments: [
        'title', 'description', 'due_date', 'total_marks', 
        'weightage', 'assignment_type', 'status'
      ],
      messages: [
        'title', 'content', 'type', 'priority', 'target_type', 
        'target_ids', 'expires_at', 'status'
      ]
    };

    // Allowed file types and their MIME types
    this.allowedFileTypes = {
      'image': ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'],
      'document': [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'application/zip',
        'application/x-rar-compressed'
      ]
    };

    this.maxFileSize = 5 * 1024 * 1024; // 5MB
  }

  // Validate field names for dynamic SQL updates
  validateFieldNames = (tableName, fieldNames) => {
    const allowedFields = this.allowedFields[tableName];
    if (!allowedFields) {
      throw new Error(`Table ${tableName} not allowed for dynamic updates`);
    }

    const invalidFields = fieldNames.filter(field => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      throw new Error(`Invalid fields: ${invalidFields.join(', ')}`);
    }

    return true;
  };

  // Secure dynamic SQL update helper
  secureUpdate = (tableName, updateFields, whereClause, params) => {
    try {
      // Validate field names
      this.validateFieldNames(tableName, Object.keys(updateFields));

      // Build safe update query
      const setClause = Object.keys(updateFields)
        .map(field => `${field} = ?`)
        .join(', ');

      const query = `UPDATE ${tableName} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`;
      const queryParams = [...Object.values(updateFields), ...params];

      return { query, params: queryParams };
    } catch (error) {
      throw new Error(`Secure update failed: ${error.message}`);
    }
  };

  // Enhanced file validation
  validateFile = (file, allowedTypes = ['image', 'document']) => {
    if (!file) {
      throw new Error('No file provided');
    }

    // Check file size
    if (file.size > this.maxFileSize) {
      throw new Error(`File size exceeds maximum limit of ${this.maxFileSize / (1024 * 1024)}MB`);
    }

    // Check file extension
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.txt', '.zip', '.rar'];
    
    if (!allowedExtensions.includes(ext)) {
      throw new Error('File type not allowed');
    }

    // Check MIME type
    const allowedMimeTypes = allowedTypes.flatMap(type => this.allowedFileTypes[type]);
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error('File MIME type not allowed');
    }

    // Generate secure filename
    const secureFilename = this.generateSecureFilename(file.originalname);

    return {
      isValid: true,
      secureFilename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype
    };
  };

  // Generate secure filename
  generateSecureFilename = (originalName) => {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName);
    return `${timestamp}-${randomString}${ext}`;
  };

  // Input sanitization
  sanitizeInput = (input) => {
    if (typeof input !== 'string') {
      return input;
    }

    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  };

  // XSS prevention middleware
  preventXSS = (req, res, next) => {
    // Sanitize body
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
          req.body[key] = this.sanitizeInput(req.body[key]);
        }
      });
    }

    // Sanitize query parameters
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (typeof req.query[key] === 'string') {
          req.query[key] = this.sanitizeInput(req.query[key]);
        }
      });
    }

    next();
  };

  // SQL injection prevention middleware
  preventSQLInjection = (req, res, next) => {
    const checkValue = (value) => {
      if (typeof value === 'string') {
        // Check for common SQL injection patterns
        const sqlPatterns = [
          /(\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
          /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,
          /(\b(union|select|insert|update|delete|drop|create|alter)\b.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
          /(--|#|\/\*|\*\/)/,
          /(\b(exec|execute|xp_|sp_)\b)/i
        ];

        for (const pattern of sqlPatterns) {
          if (pattern.test(value)) {
            throw new Error('Potential SQL injection detected');
          }
        }
      }
      return value;
    };

    try {
      // Check body
      if (req.body) {
        Object.keys(req.body).forEach(key => {
          req.body[key] = checkValue(req.body[key]);
        });
      }

      // Check query parameters
      if (req.query) {
        Object.keys(req.query).forEach(key => {
          req.query[key] = checkValue(req.query[key]);
        });
      }

      // Check URL parameters
      if (req.params) {
        Object.keys(req.params).forEach(key => {
          req.params[key] = checkValue(req.params[key]);
        });
      }

      next();
    } catch (error) {
      res.status(400).json({
        error: 'Invalid input detected',
        message: 'Request contains potentially malicious content'
      });
    }
  };

  // Enhanced validation for common operations
  validateUserInput = [
    body('username')
      .isLength({ min: 3, max: 30 })
      .withMessage('Username must be between 3 and 30 characters')
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username can only contain letters, numbers, and underscores')
      .trim()
      .escape(),
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email address')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    body('first_name')
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name can only contain letters and spaces')
      .trim()
      .escape(),
    body('last_name')
      .isLength({ min: 2, max: 50 })
      .withMessage('Last name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name can only contain letters and spaces')
      .trim()
      .escape(),
    body('phone')
      .optional()
      .isMobilePhone()
      .withMessage('Please provide a valid phone number'),
    body('date_of_birth')
      .optional()
      .isISO8601()
      .withMessage('Please provide a valid date of birth'),
    body('gender')
      .optional()
      .isIn(['male', 'female', 'other'])
      .withMessage('Gender must be male, female, or other')
  ];

  // Validation for file uploads
  validateFileUpload = (req, res, next) => {
    if (!req.files || req.files.length === 0) {
      return next();
    }

    try {
      for (const file of req.files) {
        this.validateFile(file);
      }
      next();
    } catch (error) {
      res.status(400).json({
        error: 'File validation failed',
        message: error.message
      });
    }
  };

  // Check validation results
  checkValidationResult = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input',
        details: errors.array()
      });
    }
    next();
  };

  // Rate limiting helper
  createRateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
      windowMs,
      max,
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
  };

  // Security headers middleware
  securityHeaders = (req, res, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', 
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "font-src 'self'; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none';"
    );

    // XSS Protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Frame options
    res.setHeader('X-Frame-Options', 'DENY');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions policy
    res.setHeader('Permissions-Policy', 
      'geolocation=(), microphone=(), camera=()'
    );

    next();
  };

  // Error handling middleware
  errorHandler = (err, req, res, next) => {
    console.error('Security error:', err);

    // Don't expose internal errors in production
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (err.message.includes('SQL injection') || 
        err.message.includes('XSS') || 
        err.message.includes('validation')) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Request contains invalid data'
      });
    }

    // Generic error response
    res.status(500).json({
      error: 'Internal server error',
      message: isProduction ? 'Something went wrong' : err.message
    });
  };
}

module.exports = SecurityMiddleware; 