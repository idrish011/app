const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const Database = require('../models/database');
const { loggers } = require('../middleware/activityLogger');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

// Helper: retry a DB call up to N times with delay (for transient Neon/PG issues)
async function retryDbCall(fn, retries = 3, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      // If connection refused, do not retry, fail fast
      if (
        err.code === 'ECONNREFUSED' ||
        (Array.isArray(err.errors) && err.errors.some(e => e.code === 'ECONNREFUSED'))
      ) {
        console.error('[DB] Connection refused. Check your DATABASE_URL and ensure your Postgres/Neon server is running and accessible.');
        throw err;
      }
      lastErr = err;
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }
  throw lastErr;
}

// User registration
router.post('/register', auth.validateRegistration, auth.checkValidationResult, async (req, res) => {
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

    // Handle super admin registration differently
    if (role === 'super_admin') {
      // Check if user already exists globally
      const existingUser = await retryDbCall(() =>
        db.get('SELECT id FROM users WHERE email = $1 AND role = $2', [email, 'super_admin'])
      );

      if (existingUser) {
        return res.status(409).json({
          error: 'Super admin already exists',
          message: 'A super admin with this email already exists'
        });
      }

      // Hash password
      const passwordHash = await auth.hashPassword(password);
      const userId = uuidv4();

      // Insert super admin user (college_id can be null or a system identifier)
      await retryDbCall(() =>
        db.run(
          `INSERT INTO users (
            id, college_id, username, email, password_hash, first_name, last_name, 
            role, phone, date_of_birth, gender, address
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [userId, 'system', username, email, passwordHash, first_name, last_name, 
           role, phone, date_of_birth, gender, address]
        )
      );

      // Generate token
      const user = await retryDbCall(() =>
        db.get('SELECT * FROM users WHERE id = $1', [userId])
      );
      const token = auth.generateToken(user);

      res.status(201).json({
        message: 'Super admin registered successfully',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          college_id: user.college_id
        }
      });
    } else {
      // For non-super admin users, require college_id and validate college
      if (!college_id) {
        return res.status(400).json({
          error: 'College ID required',
          message: 'College ID is required for non-super admin users'
        });
      }

      // Check if college exists
      const college = await retryDbCall(() =>
        db.get('SELECT id, subscription_status FROM colleges WHERE id = $1', [college_id])
      );
      if (!college) {
        return res.status(404).json({
          error: 'College not found',
          message: 'The specified college does not exist'
        });
      }

      if (college.subscription_status !== 'active') {
        return res.status(403).json({
          error: 'College subscription inactive',
          message: 'This college subscription is not active'
        });
      }

      // Check if user already exists in this college
      const existingUser = await retryDbCall(() =>
        db.get('SELECT id FROM users WHERE email = $1 AND college_id = $2', [email, college_id])
      );

      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          message: 'A user with this email already exists in this college'
        });
      }

      // Hash password
      const passwordHash = await auth.hashPassword(password);
      const userId = uuidv4();

      // Insert new user
      await retryDbCall(() =>
        db.run(
          `INSERT INTO users (
            id, college_id, username, email, password_hash, first_name, last_name, 
            role, phone, date_of_birth, gender, address
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [userId, college_id, username, email, passwordHash, first_name, last_name, 
           role, phone, date_of_birth, gender, address]
        )
      );

      // Generate token
      const user = await retryDbCall(() =>
        db.get('SELECT * FROM users WHERE id = $1', [userId])
      );
      const token = auth.generateToken(user);

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          college_id: user.college_id
        }
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: 'Internal server error during registration'
    });
  }
});

// Forgot password - request reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email required',
        message: 'Email address is required'
      });
    }

    // Find user by email
    const user = await retryDbCall(() =>
      db.get(`
        SELECT u.*, c.name as college_name 
        FROM users u 
        LEFT JOIN colleges c ON u.college_id = c.id 
        WHERE u.email = $1 AND u.status = 'active'
      `, [email])
    );

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        message: 'If an account with this email exists, you will receive password reset instructions shortly.'
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = require('crypto').randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token in database
    await retryDbCall(() =>
      db.run(
        'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3',
        [resetToken, resetTokenExpiry, user.id]
      )
    );

    // TODO: Send email with reset link
    // For now, we'll just log the reset token
    console.log(`Password reset token for ${email}: ${resetToken}`);
    console.log(`Reset link: http://localhost:3000/api/auth/reset-password?token=${resetToken}`);

    res.json({
      message: 'If an account with this email exists, you will receive password reset instructions shortly.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      error: 'Forgot password failed',
      message: 'Internal server error during password reset request'
    });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Reset token and new password are required'
      });
    }

    // Find user with valid reset token
    const user = await retryDbCall(() =>
      db.get(
        'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > CURRENT_TIMESTAMP AND status = $2',
        [token, 'active']
      )
    );

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired token',
        message: 'The reset token is invalid or has expired. Please request a new password reset.'
      });
    }

    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'Password too short',
        message: 'Password must be at least 6 characters long'
      });
    }

    // Hash new password
    const newPasswordHash = await auth.hashPassword(newPassword);

    // Update password and clear reset token
    await retryDbCall(() =>
      db.run(
        'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newPasswordHash, user.id]
      )
    );

    res.json({
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      error: 'Password reset failed',
      message: 'Internal server error during password reset'
    });
  }
});

// User login
router.post('/login', auth.validateLogin, auth.checkValidationResult, async (req, res) => {
  try {
    const { email, password } = req.body;
    let user;
    user = await retryDbCall(() =>
      db.get(`
        SELECT u.*, 'system' as college_name, 'active' as subscription_status
        FROM users u 
        WHERE u.email = $1 AND u.role = $2 AND u.status = $3
      `, [email, 'super_admin', 'active'])
    );
    if (!user) {
      user = await retryDbCall(() =>
        db.get(`
          SELECT u.*, c.name as college_name, c.subscription_status 
          FROM users u 
          JOIN colleges c ON u.college_id = c.id 
          WHERE u.email = $1 AND u.status = $2
        `, [email, 'active'])
      );
    }

    if (!user) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Check college subscription status (skip for super admin)
    if (user.role !== 'super_admin' && user.subscription_status !== 'active') {
      return res.status(403).json({
        error: 'College subscription inactive',
        message: 'Your college subscription is not active. Please contact administrator.'
      });
    }

    // Verify password
    console.log(`[Login] password_hash for user ${user.id}: ${user.password_hash}`);
    const isValidPassword = await auth.comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Generate token
    const token = auth.generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        college_id: user.college_id,
        college_name: user.college_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: 'Internal server error during login'
    });
  }
});

// Change password (for authenticated users)
router.put('/change-password', auth.authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get current user
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) {
      console.log(`[Change Password] User not found: ${req.user.id}`);
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    console.log(`[Change Password] password_hash for user ${req.user.id}: ${user.password_hash}`);
    // Verify current password
    const isValidPassword = await auth.comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      console.log(`[Change Password] Invalid current password for user ${req.user.id}`);
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

    console.log(`[Change Password] Password updated for user ${req.user.id}`);

    res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Password change failed',
      message: 'Internal server error during password change${'
    });
  }
});

// Reset user password (admin only)
router.put('/reset-password/:userId', auth.authenticateToken, auth.authorizeRoles('super_admin'), async (req, res) => {
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

// Get current user profile
router.get('/profile', auth.authenticateToken, async (req, res) => {
  try {
    let user;
    
    // Handle super admin profile differently
    if (req.user.role === 'super_admin') {
      user = await db.get(`
        SELECT u.*, 'system' as college_name, 'system' as college_domain
        FROM users u 
        WHERE u.id = ?
      `, [req.user.id]);
    } else {
      user = await db.get(`
        SELECT u.*, c.name as college_name, c.domain as college_domain 
        FROM users u 
        JOIN colleges c ON u.college_id = c.id 
        WHERE u.id = ?
      `, [req.user.id]);
    }

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }

    // Remove sensitive information
    delete user.password_hash;

    res.json({
      message: 'Profile retrieved successfully',
      user
    });
  } catch (error) {
    console.error('Profile retrieval error:', error);
    res.status(500).json({
      error: 'Profile retrieval failed',
      message: 'Internal server error while retrieving profile'
    });
  }
});

// Update user profile
router.put('/profile', auth.authenticateToken, async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      address,
      date_of_birth,
      gender
    } = req.body;

    // Update user profile
    await db.run(
      `UPDATE users SET 
        first_name = $1, last_name = $2, phone = $3, address = $4, 
        date_of_birth = $5, gender = $6, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $7`,
      [first_name, last_name, phone, address, date_of_birth, gender, req.user.id]
    );

    // Get updated user
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
    delete user.password_hash;

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      error: 'Profile update failed',
      message: 'Internal server error while updating profile'
    });
  }
});

// Save or update Expo push token for the logged-in user
router.post('/users/push-token', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { push_token } = req.body;
    if (!push_token) {
      return res.status(400).json({ error: 'Missing push_token' });
    }
    await db.run('UPDATE users SET push_token = $1 WHERE id = $2', [push_token, userId]);
    res.json({ success: true, message: 'Push token saved' });
  } catch (error) {
    console.error('Save push token error:', error);
    res.status(500).json({ error: 'Failed to save push token' });
  }
});

// Logout (client-side token removal)
router.post('/logout', auth.authenticateToken, (req, res) => {
  // In production, you might want to blacklist the token
  res.json({
    message: 'Logged out successfully'
  });
});

// Verify token validity
router.get('/verify', auth.authenticateToken, (req, res) => {
  res.json({
    message: 'Token is valid',
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      college_id: req.user.college_id
    }
  });
});

module.exports = router;