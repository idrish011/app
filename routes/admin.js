const express = require('express');
const AuthMiddleware = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const Database = require('../models/database');
const { loggers } = require('../middleware/activityLogger');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

function toCamelCaseStats(stats) {
  if (!stats) return {};
  return {
    totalUsers: stats.total_users,
    totalColleges: stats.total_colleges,
    totalCollegeAdmins: stats.total_college_admins,
    totalTeachers: stats.total_teachers,
    totalStudents: stats.total_students,
    totalParents: stats.total_parents,
    totalCourses: stats.total_courses,
    totalRevenue: stats.total_revenue,
    activeStudents: stats.active_students,
    pendingAdmissions: stats.pending_admissions,
    attendanceRate: stats.attendance_rate,
    // keep original keys for backward compatibility
    ...stats
  };
}

// Dashboard Statistics
router.get('/dashboard/stats', auth.authenticateToken, loggers.dashboardAccess, async (req, res) => {
  try {
    const { user } = req;
    let stats = {};
    let recentActivity = [];

    if (!user || !user.role) {
      return res.status(401).json({ error: 'Unauthorized: No user or role found' });
    }

    if (user.role === 'super_admin') {
      // Global stats for super admin
      stats = await db.get(`
        SELECT 
          (SELECT COUNT(*) FROM colleges WHERE status = 'active') as total_colleges,
          (SELECT COUNT(*) FROM users WHERE role != 'super_admin') as total_users,
          (SELECT COUNT(*) FROM users WHERE role = 'college_admin') as total_college_admins,
          (SELECT COUNT(*) FROM users WHERE role = 'teacher') as total_teachers,
          (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students,
          (SELECT COUNT(*) FROM users WHERE role = 'parent') as total_parents,
          (SELECT COUNT(*) FROM courses WHERE status = 'active') as total_courses,
          (SELECT IFNULL(SUM(amount_paid), 0) FROM fee_collections WHERE status = 'paid') as total_revenue
      `);

      // Fetch recent activity logs (all roles)
      recentActivity = await db.all(`
        SELECT id, timestamp, user_email, user_role, action, entity, entity_id, details
        FROM activity_logs
        ORDER BY timestamp DESC
        LIMIT 10
      `);
    } else if (user.role === 'college_admin') {
      // College-specific stats for college admin
      if (!user.college_id) {
        return res.status(400).json({ error: 'College admin must have a college_id' });
      }
      stats = await db.get(`
        SELECT 
          (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'student') as total_students,
          (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'teacher') as total_teachers,
          (SELECT COUNT(*) FROM courses WHERE college_id = ? AND status = 'active') as total_courses,
          (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'student' AND status = 'active') as active_students,
          (SELECT COUNT(*) FROM admissions WHERE college_id = ? AND status = 'pending') as pending_admissions,
          (SELECT IFNULL(SUM(amount_paid), 0) FROM fee_collections fc 
           JOIN fee_structures fs ON fc.fee_structure_id = fs.id 
           JOIN courses c ON fs.course_id = c.id 
           WHERE c.college_id = ? AND fc.status = 'paid') as total_revenue,
          (SELECT IFNULL(AVG(attendance_percentage), 0) FROM (
            SELECT AVG(CASE WHEN status = 'present' THEN 100 ELSE 0 END) as attendance_percentage
            FROM attendance a
            JOIN classes cl ON a.class_id = cl.id
            JOIN courses c ON cl.course_id = c.id
            WHERE c.college_id = ? AND a.date >= date('now', '-30 days')
            GROUP BY a.student_id
          )) as attendance_rate
      `, [
        user.college_id, user.college_id, user.college_id, user.college_id,
        user.college_id, user.college_id, user.college_id
      ]);
    } else {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    res.json({ stats: toCamelCaseStats(stats), recentActivity });
  } catch (error) {
    // Log the error and user object for debugging
    console.error('Dashboard stats error:', error);
    console.error('User object:', req.user);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics', message: error.message });
  }
});

// Get all users
router.get('/users', auth.authenticateToken, auth.authorizeRoles('super_admin', 'college_admin'), loggers.dashboardAccess, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', role = '', college_id: query_college_id = '' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];
    let paramIndex = 1;

    // For college_admin, restrict to their own college
    if (req.user.role === 'college_admin') {
      whereConditions.push(`u.college_id = $${paramIndex++}`);
      params.push(req.user.college_id);
      
      // College admins can only see students, teachers, and parents
      whereConditions.push(`u.role IN ('student', 'teacher', 'parent')`);
    }

    if (search) {
      whereConditions.push(`(u.first_name ILIKE $${paramIndex++} OR u.last_name ILIKE $${paramIndex++} OR u.email ILIKE $${paramIndex++})`);
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (role) {
      whereConditions.push(`u.role = $${paramIndex++}`);
      params.push(role);
    }

    if (query_college_id && req.user.role === 'super_admin') {
      whereConditions.push(`u.college_id = $${paramIndex++}`);
      params.push(query_college_id);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM users u 
      ${whereClause}
    `;
    const totalResult = await db.get(countQuery, params);
    const total = totalResult ? parseInt(totalResult.total, 10) : 0;

    // Get users with pagination
    const usersQuery = `
      SELECT u.*, c.name as college_name, c.domain as college_domain
      FROM users u 
      LEFT JOIN colleges c ON u.college_id = c.id 
      ${whereClause}
      ORDER BY u.created_at DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const users = await db.all(usersQuery, [...params, limitNum, offset]);

    // Remove sensitive information
    users.forEach(user => {
      delete user.password_hash;
    });

    // Set no-cache headers to prevent 304 responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.json({
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      error: 'Failed to fetch users',
      message: 'Internal server error'
    });
  }
});

// Get specific user
router.get('/users/:userId', auth.authenticateToken, auth.authorizeRoles('super_admin', 'college_admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user with college info
    const user = await db.get(`
      SELECT u.*, c.name as college_name, c.domain as college_domain
      FROM users u 
      LEFT JOIN colleges c ON u.college_id = c.id 
      WHERE u.id = $1
    `, [userId]);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // For college_admin, ensure they can only access users from their own college
    if (req.user.role === 'college_admin') {
      if (user.college_id !== req.user.college_id) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access users from your own college'
        });
      }
      
      // College admins can only access students, teachers, and parents
      if (!['student', 'teacher', 'parent'].includes(user.role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'College admins can only access students, teachers, and parents'
        });
      }
    }

    // Remove sensitive information
    delete user.password_hash;

    res.json({
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      error: 'Failed to fetch user',
      message: 'Internal server error'
    });
  }
});

// Create user
router.post('/users', auth.authenticateToken, auth.authorizeRoles('super_admin', 'college_admin'), loggers.createUser, async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      first_name,
      last_name,
      role,
      college_id,
      phone,
      date_of_birth,
      gender,
      address
    } = req.body;

    // Validate required fields
    if (!username || !email || !password || !first_name || !last_name || !role) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Username, email, password, first_name, last_name, and role are required'
      });
    }

    // For college_admin, ensure they can only create users for their own college
    let finalCollegeId = college_id;
    if (req.user.role === 'college_admin') {
      finalCollegeId = req.user.college_id;
      
      // College admins can only create students, teachers, and parents
      if (!['student', 'teacher', 'parent'].includes(role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'College admins can only create students, teachers, and parents'
        });
      }
    } else if (req.user.role === 'super_admin') {
      finalCollegeId = (role === 'super_admin') ? null : college_id;
    }

    // Check if user already exists in the same scope (college or global for super_admin)
    let existingUserQuery = 'SELECT id FROM users WHERE email = $1';
    const existingUserParams = [email];

    if (finalCollegeId) {
      existingUserQuery += ' AND college_id = $2';
      existingUserParams.push(finalCollegeId);
    } else {
      // This handles the case for super_admins where college_id is NULL
      existingUserQuery += ' AND college_id IS NULL';
    }

    const existingUser = await db.get(existingUserQuery, existingUserParams);

    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists in this college',
        message: 'A user with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await auth.hashPassword(password);

    // Insert new user
    const userId = uuidv4();
    
    await db.run(
      `INSERT INTO users (
        id, college_id, username, email, password_hash, first_name, last_name, 
        role, phone, date_of_birth, gender, address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [userId, finalCollegeId, username, email, passwordHash, first_name, last_name, 
       role, phone, date_of_birth, gender, address]
    );

    // Get created user
    const user = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
    delete user.password_hash;

    res.status(201).json({
      message: 'User created successfully',
      user
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      error: 'Failed to create user',
      message: 'Internal server error'
    });
  }
});

// Update user
router.put('/users/:userId', auth.authenticateToken, auth.authorizeRoles('super_admin', 'college_admin'), loggers.updateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    // Check if user exists
    const existingUser = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
    if (!existingUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // For college_admin, ensure they can only update users from their own college
    if (req.user.role === 'college_admin') {
      if (existingUser.college_id !== req.user.college_id) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only update users from your own college'
        });
      }
      
      // College admins can only update certain roles
      const allowedRolesToUpdate = ['student', 'teacher', 'parent'];
      if (!allowedRolesToUpdate.includes(existingUser.role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `College admins can only update ${allowedRolesToUpdate.join(', ')}.`
        });
      }
      // And they cannot change a user's role to something they can't manage
      if (updates.role && !allowedRolesToUpdate.includes(updates.role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `Cannot change role to ${updates.role}.`
        });
      }
    }

    // Prepare dynamic update query
    const updateFields = [];
    const params = [];
    let paramIndex = 1;

    // Handle college_id separately based on role
    let finalCollegeId = updates.college_id;
    if (req.user.role === 'college_admin') {
      finalCollegeId = req.user.college_id; // Force their own college_id
    } else if (req.user.role === 'super_admin') {
      // Super admin can change college_id, or set it to null for another super_admin
      if (updates.role === 'super_admin') {
        finalCollegeId = null;
      }
    }

    // Check for email uniqueness if it's being changed
    if (updates.email && updates.email !== existingUser.email) {
      let uniqueCheckQuery = 'SELECT id FROM users WHERE email = $1 AND id != $2';
      const uniqueCheckParams = [updates.email, userId];
      
      const checkCollegeId = finalCollegeId !== undefined ? finalCollegeId : existingUser.college_id;
      if (checkCollegeId) {
        uniqueCheckQuery += ' AND college_id = $3';
        uniqueCheckParams.push(checkCollegeId);
      } else {
        uniqueCheckQuery += ' AND college_id IS NULL';
      }

      const duplicateUser = await db.get(uniqueCheckQuery, uniqueCheckParams);
      if (duplicateUser) {
        return res.status(409).json({
          error: 'Email already in use',
          message: 'This email address is already taken by another user in this college.'
        });
      }
    }

    // Dynamically add other fields to update
    const allowedUpdates = ['username', 'email', 'first_name', 'last_name', 'role', 'college_id', 'phone', 'date_of_birth', 'gender', 'address', 'status'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined && updates[field] !== existingUser[field]) {
        // Use finalCollegeId if the field is college_id
        const value = field === 'college_id' ? finalCollegeId : updates[field];
        updateFields.push(`${field} = $${paramIndex++}`);
        params.push(value);
      }
    });

    if (updateFields.length === 0) {
      const noChangeUser = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
      delete noChangeUser.password_hash;
      return res.json({ message: 'No changes detected. User not updated.', user: noChangeUser });
    }

    // Add the WHERE clause parameter
    params.push(userId);

    // Construct and run the final query
    const query = `
      UPDATE users SET 
        ${updateFields.join(', ')}, 
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${paramIndex}
    `;
    
    await db.run(query, params);

    // Get updated user
    const user = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
    delete user.password_hash;

    res.json({
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: 'Internal server error'
    });
  }
});

// Delete user
router.delete('/users/:userId', auth.authenticateToken, auth.authorizeRoles('super_admin', 'college_admin'), loggers.deleteUser, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const existingUser = await db.get('SELECT id, college_id, role FROM users WHERE id = $1', [userId]);
    if (!existingUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // For college_admin, ensure they can only delete users from their own college
    if (req.user.role === 'college_admin') {
      if (existingUser.college_id !== req.user.college_id) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only delete users from your own college'
        });
      }
      
      // College admins can only delete students, teachers, and parents
      if (!['student', 'teacher', 'parent'].includes(existingUser.role)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'College admins can only delete students, teachers, and parents'
        });
      }
    }

    // Soft delete - update status to 'deleted'
    await db.run(
      "UPDATE users SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [userId]
    );

    res.json({
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      error: 'Failed to delete user',
      message: 'Internal server error'
    });
  }
});

// Change password (for admin)
router.put('/change-password', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get current user
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // Verify current password
    const isValidPassword = await auth.comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid current password',
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const newPasswordHash = await auth.hashPassword(newPassword);

    // Update password
    await db.run(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, req.user.id]
    );

    res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Password change failed',
      message: 'Internal server error during password change'
    });
  }
});

// Reset user password (admin only)
router.put('/users/:userId/reset-password', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword, sendEmail = true } = req.body;

    // Get user to reset
    const user = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // Hash new password
    const newPasswordHash = await auth.hashPassword(newPassword);

    // Update password
    await db.run(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, userId]
    );

    // TODO: Send email notification if sendEmail is true
    if (sendEmail) {
      // Implement email sending logic here
      console.log(`Password reset email would be sent to ${user.email}`);
    }

    res.json({
      message: 'Password reset successfully',
      user: {
        id: user.id,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`
      }
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      error: 'Password reset failed',
      message: 'Internal server error during password reset'
    });
  }
});

// Generate secure password (admin only)
router.post('/generate-password', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    // Generate a secure password
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    
    // Ensure at least one of each required character type
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]; // uppercase
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]; // lowercase
    password += '0123456789'[Math.floor(Math.random() * 10)]; // number
    password += '!@#$%^&*'[Math.floor(Math.random() * 8)]; // special char
    
    // Fill the rest randomly
    for (let i = 4; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle the password
    password = password.split('').sort(() => Math.random() - 0.5).join('');

    res.json({
      password,
      message: 'Secure password generated successfully'
    });
  } catch (error) {
    console.error('Generate password error:', error);
    res.status(500).json({
      error: 'Password generation failed',
      message: 'Internal server error during password generation'
    });
  }
});

// Get all colleges
router.get('/colleges', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', subscription_status = '' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const params = [];
    const whereConditions = [];
    let paramIndex = 1;

    if (search) {
      // Use ILIKE for case-insensitive search in PostgreSQL
      whereConditions.push(`(name ILIKE $${paramIndex++} OR domain ILIKE $${paramIndex++})`);
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (subscription_status) {
      whereConditions.push(`subscription_status = $${paramIndex++}`);
      params.push(subscription_status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM colleges ${whereClause}`;
    const totalResult = await db.get(countQuery, params);
    const total = totalResult ? parseInt(totalResult.total, 10) : 0;

    // Get colleges with pagination
    const collegesQuery = `
      SELECT * FROM colleges 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const colleges = await db.all(collegesQuery, [...params, limitNum, offset]);

    // Set no-cache headers to prevent 304 responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    
    res.json({
      colleges,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get colleges error:', error);
    res.status(500).json({
      error: 'Failed to fetch colleges',
      message: 'Internal server error'
    });
  }
});

// Create college
router.post('/colleges', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const {
      name,
      domain,
      address,
      contact_phone,
      contact_email,
      subscription_status = 'active',
      subscription_plan = 'basic',
      max_users = 100,
      description
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Name is required'
      });
    }

    // Check if college already exists
    const existingCollege = await db.get(
      'SELECT id FROM colleges WHERE domain = $1',
      [domain]
    );

    if (existingCollege) {
      return res.status(409).json({
        error: 'College already exists',
        message: 'A college with this domain already exists'
      });
    }

    // Insert new college
    const collegeId = require('uuid').v4();
    await db.run(
      `INSERT INTO colleges (
        id, name, domain, address, contact_phone, contact_email, subscription_status, 
        subscription_plan, max_users
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [collegeId, name, domain, address, contact_phone, contact_email, subscription_status, 
       subscription_plan, max_users]
    );

    // Get created college
    const college = await db.get('SELECT * FROM colleges WHERE id = $1', [collegeId]);

    res.status(201).json({
      message: 'College created successfully',
      college
    });
  } catch (error) {
    console.error('Create college error:', error);
    res.status(500).json({
      error: 'Failed to create college',
      message: 'Internal server error'
    });
  }
});

// Update college
router.put('/colleges/:collegeId', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { collegeId } = req.params;
    const {
      name,
      domain,
      address,
      contact_phone,
      contact_email,
      subscription_status,
      subscription_plan,
      max_users,
      description
    } = req.body;

    // Check if college exists
    const existingCollege = await db.get('SELECT id FROM colleges WHERE id = $1', [collegeId]);
    if (!existingCollege) {
      return res.status(404).json({
        error: 'College not found',
        message: 'College not found'
      });
    }

    // Update college
    await db.run(
      `UPDATE colleges SET 
        name = $1, domain = $2, address = $3, contact_phone = $4, contact_email = $5, 
        subscription_status = $6, subscription_plan = $7, max_users = $8, 
        updated_at = CURRENT_TIMESTAMP 
        WHERE id = $9`,
      [name, domain, address, contact_phone, contact_email, subscription_status, 
       subscription_plan, max_users, collegeId]
    );

    // Get updated college
    const college = await db.get('SELECT * FROM colleges WHERE id = $1', [collegeId]);

    res.json({
      message: 'College updated successfully',
      college
    });
  } catch (error) {
    console.error('Update college error:', error);
    res.status(500).json({
      error: 'Failed to update college',
      message: 'Internal server error'
    });
  }
});

// Delete college
router.delete('/colleges/:collegeId', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { collegeId } = req.params;

    // Check if college exists
    const existingCollege = await db.get('SELECT id FROM colleges WHERE id = $1', [collegeId]);
    if (!existingCollege) {
      return res.status(404).json({
        error: 'College not found',
        message: 'College not found'
      });
    }

    // Soft delete - update subscription_status to 'inactive'
    await db.run(
      'UPDATE colleges SET subscription_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['inactive', collegeId]
    );

    res.json({
      message: 'College deleted successfully'
    });
  } catch (error) {
    console.error('Delete college error:', error);
    res.status(500).json({
      error: 'Failed to delete college',
      message: 'Internal server error'
    });
  }
});

// Activity Logs and Reports Routes
router.get('/logs', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      user_id,
      user_role,
      action,
      entity,
      start_date,
      end_date,
      search
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = [];
    let params = [];

    // Build where conditions
    if (user_id) {
      whereConditions.push('user_id = ?');
      params.push(user_id);
    }

    if (user_role) {
      whereConditions.push('user_role = ?');
      params.push(user_role);
    }

    if (action) {
      whereConditions.push('action = ?');
      params.push(action);
    }

    if (entity) {
      whereConditions.push('entity = ?');
      params.push(entity);
    }

    if (start_date) {
      whereConditions.push('timestamp >= ?');
      params.push(start_date);
    }

    if (end_date) {
      whereConditions.push('timestamp <= ?');
      params.push(end_date);
    }

    if (search) {
      whereConditions.push('(details LIKE ? OR user_email LIKE ? OR action LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM activity_logs ${whereClause}`;
    const countResult = await db.get(countQuery, params);

    // Get logs with pagination
    const logsQuery = `
      SELECT * FROM activity_logs 
      ${whereClause}
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `;
    const logsResult = await db.all(logsQuery, [...params, limit, offset]);

    // Get unique values for filters
    const [users, roles, actions, entities] = await Promise.all([
      db.all('SELECT DISTINCT user_id, user_email FROM activity_logs WHERE user_id != "anonymous" ORDER BY user_email'),
      db.all('SELECT DISTINCT user_role FROM activity_logs ORDER BY user_role'),
      db.all('SELECT DISTINCT action FROM activity_logs ORDER BY action'),
      db.all('SELECT DISTINCT entity FROM activity_logs WHERE entity IS NOT NULL ORDER BY entity')
    ]);

    res.json({
      logs: logsResult,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit)
      },
      filters: {
        users,
        roles,
        actions,
        entities
      }
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// Usage Reports
router.get('/reports/usage', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    let dateFilter = '';
    let params = [];

    // Set date filter based on period
    switch (period) {
      case '1d':
        dateFilter = 'WHERE timestamp >= datetime("now", "-1 day")';
        break;
      case '7d':
        dateFilter = 'WHERE timestamp >= datetime("now", "-7 days")';
        break;
      case '30d':
        dateFilter = 'WHERE timestamp >= datetime("now", "-30 days")';
        break;
      case '90d':
        dateFilter = 'WHERE timestamp >= datetime("now", "-90 days")';
        break;
      default:
        dateFilter = 'WHERE timestamp >= datetime("now", "-7 days")';
    }

    // Get activity summary
    const activitySummary = await db.get(`
      SELECT 
        COUNT(*) as total_activities,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT DATE(timestamp)) as active_days
      FROM activity_logs 
      ${dateFilter}
    `);

    // Get top actions
    const topActions = await db.all(`
      SELECT action, COUNT(*) as count
      FROM activity_logs 
      ${dateFilter}
      GROUP BY action 
      ORDER BY count DESC 
      LIMIT 10
    `);

    // Get top users
    const topUsers = await db.all(`
      SELECT user_email, user_role, COUNT(*) as activity_count
      FROM activity_logs 
      ${dateFilter}
      WHERE user_id != 'anonymous'
      GROUP BY user_id 
      ORDER BY activity_count DESC 
      LIMIT 10
    `);

    // Get daily activity
    const dailyActivity = await db.all(`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as activities,
        COUNT(DISTINCT user_id) as unique_users
      FROM activity_logs 
      ${dateFilter}
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `);

    // Get role distribution
    const roleDistribution = await db.all(`
      SELECT user_role, COUNT(*) as count
      FROM activity_logs 
      ${dateFilter}
      WHERE user_role != 'anonymous'
      GROUP BY user_role
      ORDER BY count DESC
    `);

    res.json({
      period,
      summary: activitySummary,
      topActions,
      topUsers,
      dailyActivity,
      roleDistribution
    });
  } catch (error) {
    console.error('Error generating usage report:', error);
    res.status(500).json({ error: 'Failed to generate usage report' });
  }
});

// Profitability Reports
router.get('/reports/profit', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    let dateFilter = '';
    let params = [];

    // Set date filter based on period
    switch (period) {
      case '7d':
        dateFilter = 'WHERE created_at >= datetime("now", "-7 days")';
        break;
      case '30d':
        dateFilter = 'WHERE created_at >= datetime("now", "-30 days")';
        break;
      case '90d':
        dateFilter = 'WHERE created_at >= datetime("now", "-90 days")';
        break;
      default:
        dateFilter = 'WHERE created_at >= datetime("now", "-30 days")';
    }

    // Get fee summary
    const feeSummary = await db.get(`
      SELECT 
        COUNT(*) as total_fees,
        SUM(amount) as total_amount,
        SUM(paid_amount) as total_paid,
        SUM(amount - paid_amount) as total_outstanding
      FROM fees 
      ${dateFilter}
    `);

    // Get college-wise financials
    const collegeFinancials = await db.all(`
      SELECT 
        c.name as college_name,
        COUNT(f.id) as fee_count,
        SUM(f.amount) as total_amount,
        SUM(f.paid_amount) as total_paid,
        SUM(f.amount - f.paid_amount) as outstanding
      FROM fees f
      JOIN users u ON f.student_id = u.id
      JOIN colleges c ON u.college_id = c.id
      ${dateFilter}
      GROUP BY c.id
      ORDER BY total_amount DESC
    `);

    // Get monthly revenue trend
    const monthlyRevenue = await db.all(`
      SELECT 
        strftime('%Y-%m', created_at) as month,
        SUM(paid_amount) as revenue
      FROM fees 
      ${dateFilter}
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month DESC
    `);

    // Get payment status distribution
    const paymentStatus = await db.all(`
      SELECT 
        CASE 
          WHEN paid_amount = 0 THEN 'Unpaid'
          WHEN paid_amount = amount THEN 'Fully Paid'
          ELSE 'Partially Paid'
        END as status,
        COUNT(*) as count,
        SUM(amount) as total_amount
      FROM fees 
      ${dateFilter}
      GROUP BY 
        CASE 
          WHEN paid_amount = 0 THEN 'Unpaid'
          WHEN paid_amount = amount THEN 'Fully Paid'
          ELSE 'Partially Paid'
        END
    `);

    res.json({
      period,
      summary: feeSummary,
      collegeFinancials,
      monthlyRevenue,
      paymentStatus
    });
  } catch (error) {
    console.error('Error generating profit report:', error);
    res.status(500).json({ error: 'Failed to generate profit report' });
  }
});

// System Health Report
router.get('/reports/system-health', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    // Get database stats
    const dbStats = await db.get(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM colleges) as total_colleges,
        (SELECT COUNT(*) FROM courses) as total_courses,
        (SELECT COUNT(*) FROM fees) as total_fees,
        (SELECT COUNT(*) FROM activity_logs) as total_logs
    `);

    // Get recent errors (if any)
    const recentErrors = await db.all(`
      SELECT * FROM activity_logs 
      WHERE action LIKE '%ERROR%' OR action LIKE '%FAIL%'
      ORDER BY timestamp DESC 
      LIMIT 10
    `);

    // Get system uptime (approximate)
    const systemStart = await db.get(`
      SELECT MIN(timestamp) as system_start 
      FROM activity_logs 
      WHERE action = 'SYSTEM_STARTUP'
    `);

    // Get active sessions (users who logged in recently)
    const activeSessions = await db.all(`
      SELECT user_email, user_role, MAX(timestamp) as last_activity
      FROM activity_logs 
      WHERE timestamp >= datetime("now", "-24 hours")
      AND user_id != 'anonymous'
      GROUP BY user_id
      ORDER BY last_activity DESC
    `);

    res.json({
      database: dbStats,
      recentErrors,
      systemStart: systemStart?.system_start,
      activeSessions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating system health report:', error);
    res.status(500).json({ error: 'Failed to generate system health report' });
  }
});

// Export logs to CSV
router.get('/logs/export', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
  try {
    const { start_date, end_date, format = 'csv' } = req.query;
    
    let whereClause = '';
    let params = [];

    if (start_date && end_date) {
      whereClause = 'WHERE timestamp BETWEEN ? AND ?';
      params = [start_date, end_date];
    }

    const logs = await db.all(`
      SELECT 
        timestamp,
        user_email,
        user_role,
        action,
        entity,
        entity_id,
        details,
        ip_address,
        college_id
      FROM activity_logs 
      ${whereClause}
      ORDER BY timestamp DESC
    `, params);

    if (format === 'csv') {
      const csvHeader = 'Timestamp,User Email,User Role,Action,Entity,Entity ID,Details,IP Address,College ID\n';
      const csvData = logs.map(log => 
        `"${log.timestamp}","${log.user_email}","${log.user_role}","${log.action}","${log.entity || ''}","${log.entity_id || ''}","${log.details || ''}","${log.ip_address}","${log.college_id}"`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="activity_logs_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvHeader + csvData);
    } else {
      res.json({ logs });
    }
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({ error: 'Failed to export logs' });
  }
});

module.exports = router;