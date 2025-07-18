const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const SecurityMiddleware = require('../middleware/security');
const Database = require('../models/database');
const multer = require('multer');
const path = require('path');
const pushNotificationService = require('../utils/pushNotifications');

const router = express.Router();
const auth = new AuthMiddleware();
const security = new SecurityMiddleware();
const db = new Database();

// Configure multer for message attachments with enhanced security
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/messages/');
  },
  filename: (req, file, cb) => {
    // Use secure filename generation
    const secureFilename = security.generateSecureFilename(file.originalname);
    cb(null, secureFilename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    try {
      // Use security middleware for file validation
      const validation = security.validateFile(file);
      if (validation.isValid) {
        cb(null, true);
      } else {
        cb(new Error('File validation failed'));
      }
    } catch (error) {
      cb(new Error(error.message));
    }
  }
});

// ==================== MESSAGES API ====================

// Send message (admin, teacher, college_admin)
router.post('/', 
  auth.authenticateToken,
  auth.authorizeRoles('teacher', 'college_admin', 'super_admin'),
  upload.array('attachments', 5), // Allow up to 5 attachments
  security.validateFileUpload,
  async (req, res) => {
    try {
      const {
        title,
        content,
        type = 'announcement',
        priority = 'normal',
        target_type = 'all',
        target_ids,
        expires_at
      } = req.body;

      if (!title || !content) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Title and content are required'
        });
      }

      const messageId = uuidv4();
      const senderId = req.user.id;
      const senderName = `${req.user.first_name} ${req.user.last_name}`;

      // Handle attachments with secure filenames
      let attachments = null;
      if (req.files && req.files.length > 0) {
        attachments = JSON.stringify(req.files.map(file => file.path));
      }

      // Parse target_ids if provided
      let parsedTargetIds = null;
      if (target_ids) {
        try {
          parsedTargetIds = JSON.stringify(JSON.parse(target_ids));
        } catch (e) {
          return res.status(400).json({
            error: 'Invalid target_ids format',
            message: 'target_ids must be a valid JSON array'
          });
        }
      }

      // Create message
      await db.run(`
        INSERT INTO messages (
          id, title, content, type, priority, sender_id, sender_name,
          target_type, target_ids, attachments, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [
        messageId, title, content, type, priority, senderId, senderName,
        target_type, parsedTargetIds, attachments, expires_at
      ]);

      // Determine recipients based on target_type and user role
      let recipients = [];

      if (req.user.role === 'teacher') {
        // Teachers can send to their students only
        const teacherClasses = await db.all(
          'SELECT id FROM classes WHERE teacher_id = ?',
          [req.user.id]
        );

        if (teacherClasses.length === 0) {
          return res.status(400).json({
            error: 'No classes found',
            message: 'You must have classes to send messages'
          });
        }

        const classIds = teacherClasses.map(cls => cls.id);
        const placeholders = classIds.map(() => '?').join(',');

        if (target_type === 'specific') {
          // Send to specific students in teacher's classes
          const targetIds = JSON.parse(target_ids);
          recipients = await db.all(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.push_token
            FROM users u
            JOIN class_enrollments ce ON u.id = ce.student_id
            WHERE ce.class_id IN (${placeholders}) AND u.id IN (${targetIds.map(() => '?').join(',')})
          `, [...classIds, ...targetIds]);
        } else {
          // Send to all students in teacher's classes
          recipients = await db.all(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.push_token
            FROM users u
            JOIN class_enrollments ce ON u.id = ce.student_id
            WHERE ce.class_id IN (${placeholders})
          `, classIds);
        }
      } else if (req.user.role === 'college_admin') {
        // College admins can send to all users in their college
        if (target_type === 'specific') {
          const targetIds = JSON.parse(target_ids);
          const placeholders = targetIds.map(() => '?').join(',');
          recipients = await db.all(`
            SELECT id, first_name, last_name, email, push_token
            FROM users
            WHERE college_id = ? AND id IN (${placeholders})
          `, [req.user.college_id, ...targetIds]);
        } else {
          recipients = await db.all(`
            SELECT id, first_name, last_name, email, push_token
            FROM users
            WHERE college_id = ?
          `, [req.user.college_id]);
        }
      } else if (req.user.role === 'super_admin') {
        // Super admin can send to all users
        if (target_type === 'specific') {
          const targetIds = JSON.parse(target_ids);
          const placeholders = targetIds.map(() => '?').join(',');
          recipients = await db.all(`
            SELECT id, first_name, last_name, email, push_token
            FROM users
            WHERE id IN (${placeholders})
          `, targetIds);
        } else {
          recipients = await db.all(`
            SELECT id, first_name, last_name, email, push_token
            FROM users
          `);
        }
      }

      // Create recipient records
      for (const recipient of recipients) {
        const recipientId = uuidv4();
        await db.run(`
          INSERT INTO message_recipients (
            id, message_id, recipient_id, is_read, created_at
          ) VALUES (?, ?, ?, 0, datetime('now'))
        `, [recipientId, messageId, recipient.id]);

        // Send push notification if token exists
        if (recipient.push_token) {
          try {
            await pushNotificationService.sendNotification(
              recipient.push_token,
              title,
              content.substring(0, 100) + (content.length > 100 ? '...' : ''),
              {
                messageId,
                type: 'message'
              }
            );
          } catch (error) {
            console.error('Push notification error:', error);
          }
        }
      }

      res.status(201).json({
        message: 'Message sent successfully',
        message_id: messageId,
        recipients_count: recipients.length
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({
        error: 'Failed to send message',
        message: 'Internal server error while sending message'
      });
    }
  }
);

// Get messages for current user
router.get('/', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, type = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT m.*, mr.is_read, mr.read_at
      FROM messages m
      JOIN message_recipients mr ON m.id = mr.message_id
      WHERE mr.recipient_id = ?
    `;
    const params = [userId];

    if (type) {
      query += ' AND m.type = ?';
      params.push(type);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const messages = await db.all(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
      JOIN message_recipients mr ON m.id = mr.message_id
      WHERE mr.recipient_id = ?
    `;
    const countParams = [userId];

    if (type) {
      countQuery += ' AND m.type = ?';
      countParams.push(type);
    }

    const totalResult = await db.get(countQuery, countParams);

    res.json({
      messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalResult.total,
        pages: Math.ceil(totalResult.total / limit)
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      error: 'Failed to fetch messages',
      message: 'Internal server error while fetching messages'
    });
  }
});

// Get specific message
router.get('/:messageId', auth.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await db.get(`
      SELECT m.*, mr.is_read, mr.read_at
      FROM messages m
      JOIN message_recipients mr ON m.id = mr.message_id
      WHERE m.id = ? AND mr.recipient_id = ?
    `, [messageId, userId]);

    if (!message) {
      return res.status(404).json({
        error: 'Message not found',
        message: 'Message not found or you do not have access to it'
      });
    }

    // Mark as read if not already read
    if (!message.is_read) {
      await db.run(`
        UPDATE message_recipients 
        SET is_read = 1, read_at = datetime('now')
        WHERE message_id = ? AND recipient_id = ?
      `, [messageId, userId]);
    }

    res.json({ message });
  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({
      error: 'Failed to fetch message',
      message: 'Internal server error while fetching message'
    });
  }
});

// Mark message as read
router.put('/:messageId/read', auth.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const result = await db.run(`
      UPDATE message_recipients 
      SET is_read = 1, read_at = datetime('now')
      WHERE message_id = ? AND recipient_id = ?
    `, [messageId, userId]);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Message not found',
        message: 'Message not found or you do not have access to it'
      });
    }

    res.json({
      message: 'Message marked as read'
    });
  } catch (error) {
    console.error('Mark message as read error:', error);
    res.status(500).json({
      error: 'Failed to mark message as read',
      message: 'Internal server error'
    });
  }
});

// Delete message (sender only)
router.delete('/:messageId', auth.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Check if user is the sender
    const message = await db.get(`
      SELECT id FROM messages WHERE id = ? AND sender_id = ?
    `, [messageId, userId]);

    if (!message) {
      return res.status(404).json({
        error: 'Message not found',
        message: 'Message not found or you are not the sender'
      });
    }

    // Delete message and all recipient records
    await db.run('DELETE FROM message_recipients WHERE message_id = ?', [messageId]);
    await db.run('DELETE FROM messages WHERE id = ?', [messageId]);

    res.json({
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      error: 'Failed to delete message',
      message: 'Internal server error while deleting message'
    });
  }
});

module.exports = router; 