const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const Database = require('../models/database');

class AuthMiddleware {
  constructor() {
    this.db = new Database();
    
    // SECURITY: Enforce strong JWT secret
    this.JWT_SECRET = process.env.JWT_SECRET;
    if (!this.JWT_SECRET && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
    
    // Fallback for development only
    if (!this.JWT_SECRET) {
      this.JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
      console.warn('⚠️  Using default JWT secret. Set JWT_SECRET environment variable for production.');
    }
  }

  // Validate JWT token and extract user info
  authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }

    jwt.verify(token, this.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ 
          error: 'Invalid or expired token',
          message: 'Your session has expired. Please login again.'
        });
      }

      try {
        // Get user from database with college info (handle super admin case)
        let user;
        if (decoded.role === 'super_admin') {
          // For super admin, don't join with colleges table
          user = await this.db.get(`
            SELECT u.*, 'system' as college_name, 'system' as college_domain 
            FROM users u 
            WHERE u.id = ? AND u.status = 'active'
          `, [decoded.userId]);
        } else {
          // For regular users, join with colleges table
          user = await this.db.get(`
            SELECT u.*, c.name as college_name, c.domain as college_domain 
            FROM users u 
            JOIN colleges c ON u.college_id = c.id 
            WHERE u.id = ? AND u.status = 'active'
          `, [decoded.userId]);
        }

        if (!user) {
          return res.status(403).json({ 
            error: 'User not found or inactive',
            message: 'Your account is not active. Please contact administrator.'
          });
        }

        req.user = user;
        req.college = {
          id: user.college_id,
          name: user.college_name,
          domain: user.college_domain
        };
        next();
      } catch (error) {
        console.error('Authentication error:', error);
        return res.status(500).json({ 
          error: 'Authentication failed',
          message: 'Internal server error during authentication'
        });
      }
    });
  };

  // Role-based authorization middleware
  authorizeRoles = (...roles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Authentication required',
          message: 'Please login to access this resource'
        });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          message: `Access denied. Required roles: ${roles.join(', ')}`
        });
      }

      next();
    };
  };

  // Check if user can access specific college data
  authorizeCollegeAccess = (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please login to access this resource'
      });
    }

    const requestedCollegeId = req.params.collegeId || req.body.collegeId;
    
    // Super admin can access all colleges
    if (req.user.role === 'super_admin') {
      return next();
    }

    // Other users can only access their own college
    if (req.user.college_id !== requestedCollegeId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You can only access data from your own college'
      });
    }

    next();
  };

  // Validate user registration data
  validateRegistration = [
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
    body('role')
      .isIn(['super_admin', 'college_admin', 'teacher', 'student', 'parent'])
      .withMessage('Invalid role specified'),
    body('college_id')
      .optional()
      .custom((value, { req }) => {
        // College ID is required for all roles except super_admin
        if (req.body.role !== 'super_admin' && !value) {
          throw new Error('College ID is required for non-super admin users');
        }
        return true;
      }),
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

  // Validate login data
  validateLogin = [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email address')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ];

  // Validate college creation data
  validateCollegeCreation = [
    body('name')
      .isLength({ min: 2, max: 100 })
      .withMessage('College name must be between 2 and 100 characters')
      .trim()
      .escape(),
    body('domain')
      .isLength({ min: 3, max: 50 })
      .withMessage('Domain must be between 3 and 50 characters')
      .matches(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/)
      .withMessage('Please provide a valid domain name'),
    body('contact_email')
      .isEmail()
      .withMessage('Please provide a valid contact email')
      .normalizeEmail(),
    body('contact_phone')
      .optional()
      .isMobilePhone()
      .withMessage('Please provide a valid contact phone number'),
    body('subscription_plan')
      .optional()
      .isIn(['basic', 'premium', 'enterprise'])
      .withMessage('Subscription plan must be basic, premium, or enterprise')
  ];

  // Validate course creation data
  validateCourseCreation = [
    body('name')
      .isLength({ min: 2, max: 100 })
      .withMessage('Course name must be between 2 and 100 characters')
      .trim()
      .escape(),
    body('code')
      .isLength({ min: 2, max: 20 })
      .withMessage('Course code must be between 2 and 20 characters')
      .trim()
      .escape(),
    body('credits')
      .optional()
      .isInt({ min: 1, max: 12 })
      .withMessage('Credits must be between 1 and 12'),
    body('duration_months')
      .optional()
      .isInt({ min: 1, max: 48 })
      .withMessage('Duration must be between 1 and 48 months'),
    body('fee_amount')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Fee amount must be a positive number')
  ];

  // Validate assignment creation data
  validateAssignmentCreation = [
    body('title')
      .isLength({ min: 5, max: 200 })
      .withMessage('Assignment title must be between 5 and 200 characters')
      .trim()
      .escape(),
    body('description')
      .optional()
      .isLength({ max: 1000 })
      .withMessage('Description must not exceed 1000 characters')
      .trim()
      .escape(),
    body('class_id')
      .notEmpty()
      .withMessage('Class ID is required'),
    body('due_date')
      .isISO8601()
      .withMessage('Please provide a valid due date'),
    body('total_marks')
      .isInt({ min: 1, max: 100 })
      .withMessage('Total marks must be between 1 and 100'),
    body('weightage')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage('Weightage must be between 0 and 100'),
    body('assignment_type')
      .optional()
      .isIn(['assignment', 'project', 'quiz', 'exam'])
      .withMessage('Assignment type must be assignment, project, quiz, or exam')
  ];

  // Validate fee collection data
  validateFeeCollection = [
    body('student_id')
      .notEmpty()
      .withMessage('Student ID is required'),
    body('fee_structure_id')
      .notEmpty()
      .withMessage('Fee structure ID is required'),
    body('amount_paid')
      .isFloat({ min: 0 })
      .withMessage('Amount paid must be a positive number'),
    body('payment_date')
      .isISO8601()
      .withMessage('Please provide a valid payment date'),
    body('payment_method')
      .optional()
      .isIn(['cash', 'card', 'bank_transfer', 'online'])
      .withMessage('Payment method must be cash, card, bank_transfer, or online'),
    body('transaction_id')
      .optional()
      .isLength({ max: 100 })
      .withMessage('Transaction ID must not exceed 100 characters')
  ];

  // Validate attendance data
  validateAttendance = [
    body('class_id')
      .notEmpty()
      .withMessage('Class ID is required'),
    body('student_id')
      .notEmpty()
      .withMessage('Student ID is required'),
    body('date')
      .isISO8601()
      .withMessage('Please provide a valid date'),
    body('status')
      .isIn(['present', 'absent', 'late', 'excused'])
      .withMessage('Status must be present, absent, late, or excused'),
    body('remarks')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Remarks must not exceed 500 characters')
      .trim()
      .escape()
  ];

  // Validate result data
  validateResult = [
    body('assignment_id')
      .notEmpty()
      .withMessage('Assignment ID is required'),
    body('student_id')
      .notEmpty()
      .withMessage('Student ID is required'),
    body('grade_percentage')
      .isFloat({ min: 0, max: 100 })
      .withMessage('Grade percentage must be between 0 and 100'),
    body('grade_letter')
      .optional()
      .isIn(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'])
      .withMessage('Invalid grade letter'),
    body('feedback')
      .optional()
      .isLength({ max: 1000 })
      .withMessage('Feedback must not exceed 1000 characters')
      .trim()
      .escape()
  ];

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

  // Generate JWT token with enhanced security
  generateToken = (user) => {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      college_id: user.college_id,
      iat: Math.floor(Date.now() / 1000)
      // DO NOT include exp here!
    };

    return jwt.sign(payload, this.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '24h'
    });
  };

  // Hash password with enhanced security
  hashPassword = async (password) => {
    const saltRounds = 12; // Increased from default 10 for better security
    return await bcrypt.hash(password, saltRounds);
  };

  // Compare password
  comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
  };

  // Check resource permission
  checkResourcePermission = (resourceType, resourceId) => {
    return async (req, res, next) => {
      try {
        // Implementation depends on resource type
        // This is a placeholder for resource-specific permission checks
        next();
      } catch (error) {
        res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to access this resource'
        });
      }
    };
  };
}

module.exports = AuthMiddleware; 