const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const AuthMiddleware = require('../middleware/auth');
const auth = new AuthMiddleware();

// ==================== CONTACT MESSAGES ====================

// Submit contact message
router.post('/contact-messages', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false,
        error: 'Please provide a valid email address' 
      });
    }

    const id = uuidv4();
    const collegeId = req.user?.college_id || null;
    const userId = req.user?.id || null;

    await db.run(
      `INSERT INTO contact_messages (id, college_id, user_id, name, email, subject, message) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, collegeId, userId, name, email, subject, message]
    );

    res.status(201).json({ 
      success: true,
      message: 'Contact message submitted successfully' 
    });
  } catch (error) {
    console.error('Contact message error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to submit contact message' 
    });
  }
});

// Get contact messages (for admin/college admin)
router.get('/contact-messages', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const { status = 'all', limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT cm.*, u.first_name, u.last_name, u.email as user_email
      FROM contact_messages cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.college_id = $1
    `;
    const params = [collegeId];

    if (status !== 'all') {
      query += ' AND cm.status = $2';
      params.push(status);
    }

    query += ' ORDER BY cm.created_at DESC LIMIT $3 OFFSET $4';
    params.push(limit, offset);

    const messages = await db.all(query, params);
    const total = await db.get('SELECT COUNT(*) as count FROM contact_messages WHERE college_id = $1', [collegeId]);

    res.json({
      success: true,
      messages,
      total: total.count,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: messages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get contact messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load contact messages'
    });
  }
});

// Update contact message status
router.put('/contact-messages/:id/status', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const collegeId = req.user.college_id;

    if (!['unread', 'read', 'replied', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value'
      });
    }

    const result = await db.run(
      'UPDATE contact_messages SET status = $1 WHERE id = $2 AND college_id = $3',
      [status, id, collegeId]
    );

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact message not found'
      });
    }

    res.json({
      success: true,
      message: 'Contact message status updated successfully'
    });
  } catch (error) {
    console.error('Update contact message status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contact message status'
    });
  }
});

// ==================== APP RATINGS ====================

// Submit app rating
router.post('/ratings', async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    
    // Validate required fields
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false,
        error: 'Rating must be between 1 and 5' 
      });
    }

    const id = uuidv4();
    const collegeId = req.user?.college_id || null;
    const userId = req.user?.id || null;

    await db.run(
      `INSERT INTO app_ratings (id, college_id, user_id, rating, feedback) 
       VALUES ($1, $2, $3, $4, $5)`,
      [id, collegeId, userId, rating, feedback || null]
    );

    res.status(201).json({ 
      success: true,
      message: 'Rating submitted successfully' 
    });
  } catch (error) {
    console.error('App rating error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to submit rating' 
    });
  }
});

// Get app ratings (for admin/college admin)
router.get('/ratings', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const { limit = 50, offset = 0 } = req.query;

    const ratings = await db.all(`
      SELECT ar.*, u.first_name, u.last_name, u.email as user_email
      FROM app_ratings ar
      LEFT JOIN users u ON ar.user_id = u.id
      WHERE ar.college_id = ?
      ORDER BY ar.created_at DESC
      LIMIT ? OFFSET ?
    `, [collegeId, limit, offset]);

    const total = await db.get('SELECT COUNT(*) as count FROM app_ratings WHERE college_id = $1', [collegeId]);
    const average = await db.get('SELECT AVG(rating) as avg_rating FROM app_ratings WHERE college_id = $1', [collegeId]);

    res.json({
      success: true,
      ratings,
      total: total.count,
      averageRating: average.avg_rating || 0,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: ratings.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get app ratings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load app ratings'
    });
  }
});

// Get app statistics (for dashboard)
router.get('/stats', auth.authenticateToken, async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const role = req.user.role;

    let stats = {};

    // Only college admins and admins can see app stats
    if (role === 'college_admin' || role === 'super_admin') {
      const contactMessages = await db.get(
        'SELECT COUNT(*) as count FROM contact_messages WHERE college_id = $1 AND status = $2',
        [collegeId, 'unread']
      );

      const ratings = await db.get(
        'SELECT COUNT(*) as count, AVG(rating) as avg_rating FROM app_ratings WHERE college_id = $1',
        [collegeId]
      );

      stats = {
        unreadMessages: contactMessages.count,
        totalRatings: ratings.count,
        averageRating: ratings.avg_rating || 0
      };
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get app stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load app statistics'
    });
  }
});

// ==================== APP FEEDBACK ====================

// Submit general app feedback
router.post('/feedback', async (req, res) => {
  try {
    const { type, message, userAgent, appVersion } = req.body;
    
    // Validate required fields
    if (!type || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    // Validate feedback type
    const validTypes = ['bug', 'feature', 'improvement', 'general'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid feedback type' 
      });
    }

    const id = uuidv4();
    const collegeId = req.user?.college_id || null;
    const userId = req.user?.id || null;

    // Store in contact_messages table with special type
    await db.run(
      `INSERT INTO contact_messages (id, college_id, user_id, name, email, subject, message) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, collegeId, userId, 'App Feedback', 'feedback@campuslink.com', `[${type.toUpperCase()}] App Feedback`, message]
    );

    res.status(201).json({ 
      success: true,
      message: 'Feedback submitted successfully' 
    });
  } catch (error) {
    console.error('App feedback error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to submit feedback' 
    });
  }
});

module.exports = router;