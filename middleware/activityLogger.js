const { Pool } = require('pg');
const path = require('path');

// Use the main app's DATABASE_URL for logging
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper function to get client IP address
const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         (req.connection?.socket ? req.connection.socket.remoteAddress : null) ||
         'unknown';
};

// Helper function to get user agent
const getUserAgent = (req) => {
  return req.headers['user-agent'] || 'unknown';
};

// Activity logger middleware
const activityLogger = (action, entity = null, entityId = null, details = null) => {
  return (req, res, next) => {
    const originalSend = res.send;

    res.send = function(data) {
      // Log the activity after the response is sent
      const logActivity = async () => {
        const logData = {
          user_id: req.user?.userId || req.user?.id || 'anonymous',
          user_email: req.user?.email || 'anonymous@campuslink.com',
          user_role: req.user?.role || 'anonymous',
          action: action,
          entity: entity,
          entity_id: entityId,
          details: details || JSON.stringify({
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            timestamp: new Date().toISOString()
          }),
          ip_address: getClientIP(req),
          user_agent: getUserAgent(req),
          college_id: req.user?.collegeId || req.user?.college_id || 'system'
        };

        const query = `
          INSERT INTO activity_logs (
            user_id, user_email, user_role, action, entity, entity_id, 
            details, ip_address, user_agent, college_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;

        try {
          await pool.query(query, [
            logData.user_id,
            logData.user_email,
            logData.user_role,
            logData.action,
            logData.entity,
            logData.entity_id,
            logData.details,
            logData.ip_address,
            logData.user_agent,
            logData.college_id
          ]);
        } catch (err) {
          console.error('Error logging activity:', err);
        }
      };

      logActivity();
      originalSend.call(this, data);
    };

    next();
  };
};

// Specific activity loggers for common actions
const loggers = {
  // Authentication
  login: (req, res, next) => {
    activityLogger('LOGIN', 'auth', req.body?.email || 'unknown', 
      `User logged in: ${req.body?.email || 'unknown'}`)(req, res, next);
  },
  
  logout: (req, res, next) => {
    activityLogger('LOGOUT', 'auth', req.user?.email || 'unknown', 
      `User logged out: ${req.user?.email || 'unknown'}`)(req, res, next);
  },

  // User Management
  createUser: (req, res, next) => {
    activityLogger('CREATE_USER', 'user', req.body?.email, 
      `Created user: ${req.body?.email} with role: ${req.body?.role}`)(req, res, next);
  },

  updateUser: (req, res, next) => {
    activityLogger('UPDATE_USER', 'user', req.params?.id, 
      `Updated user: ${req.params?.id}`)(req, res, next);
  },

  deleteUser: (req, res, next) => {
    activityLogger('DELETE_USER', 'user', req.params?.id, 
      `Deleted user: ${req.params?.id}`)(req, res, next);
  },

  // College Management
  createCollege: (req, res, next) => {
    activityLogger('CREATE_COLLEGE', 'college', req.body?.name, 
      `Created college: ${req.body?.name}`)(req, res, next);
  },

  updateCollege: (req, res, next) => {
    activityLogger('UPDATE_COLLEGE', 'college', req.params?.id, 
      `Updated college: ${req.params?.id}`)(req, res, next);
  },

  deleteCollege: (req, res, next) => {
    activityLogger('DELETE_COLLEGE', 'college', req.params?.id, 
      `Deleted college: ${req.params?.id}`)(req, res, next);
  },

  // Course Management
  createCourse: (req, res, next) => {
    activityLogger('CREATE_COURSE', 'course', req.body?.name, 
      `Created course: ${req.body?.name}`)(req, res, next);
  },

  updateCourse: (req, res, next) => {
    activityLogger('UPDATE_COURSE', 'course', req.params?.id, 
      `Updated course: ${req.params?.id}`)(req, res, next);
  },

  deleteCourse: (req, res, next) => {
    activityLogger('DELETE_COURSE', 'course', req.params?.id, 
      `Deleted course: ${req.params?.id}`)(req, res, next);
  },

  // Fee Management
  createFee: (req, res, next) => {
    activityLogger('CREATE_FEE', 'fee', req.body?.student_id, 
      `Created fee record for student: ${req.body?.student_id}`)(req, res, next);
  },

  updateFee: (req, res, next) => {
    activityLogger('UPDATE_FEE', 'fee', req.params?.id, 
      `Updated fee: ${req.params?.id}`)(req, res, next);
  },

  // Dashboard Access
  dashboardAccess: (req, res, next) => {
    activityLogger('DASHBOARD_ACCESS', 'dashboard', req.user?.role, 
      `Dashboard accessed by: ${req.user?.email} (${req.user?.role})`)(req, res, next);
  },

  // Report Generation
  generateReport: (req, res, next) => {
    activityLogger('GENERATE_REPORT', 'report', req.body?.report_type, 
      `Generated report: ${req.body?.report_type}`)(req, res, next);
  },

  // Password Changes
  changePassword: (req, res, next) => {
    activityLogger('CHANGE_PASSWORD', 'auth', req.user?.email, 
      `Password changed for: ${req.user?.email}`)(req, res, next);
  },

  // Generic logger for custom actions
  custom: (action, entity = null, entityId = null, details = null) => {
    return activityLogger(action, entity, entityId, details);
  }
};

module.exports = { activityLogger, loggers };