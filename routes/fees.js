const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const Database = require('../models/database');
const pushNotificationService = require('../utils/pushNotifications');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

// ==================== FEE STRUCTURES ====================

// Create fee structure
router.post('/structures', 
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const {
        course_id,
        academic_year_id,
        fee_type,
        amount,
        due_date,
        is_optional
      } = req.body;

      const collegeId = req.user.college_id;

      // Validate required fields
      if (!course_id || !academic_year_id || !fee_type || !amount) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Course ID, academic year ID, fee type, and amount are required'
        });
      }

      // Verify course belongs to this college
      const course = await db.get(
        'SELECT id FROM courses WHERE id = ? AND college_id = ?',
        [course_id, collegeId]
      );
      if (!course) {
        return res.status(404).json({
          error: 'Course not found',
          message: 'The specified course does not exist in this college'
        });
      }

      // Verify academic year belongs to this college
      const academicYear = await db.get(
        'SELECT id FROM academic_years WHERE id = ? AND college_id = ?',
        [academic_year_id, collegeId]
      );
      if (!academicYear) {
        return res.status(404).json({
          error: 'Academic year not found',
          message: 'The specified academic year does not exist in this college'
        });
      }

      const feeStructureId = uuidv4();

      // Create fee structure
      await db.run(`
        INSERT INTO fee_structures (id, college_id, course_id, academic_year_id, fee_type, amount, due_date, is_optional)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [feeStructureId, collegeId, course_id, academic_year_id, fee_type, amount, due_date, is_optional]);

      // Assign this fee to all active students in the course for the academic year
      const students = await db.all(
        `SELECT u.id FROM users u
         JOIN admissions a ON u.id = a.student_id
         WHERE u.college_id = ? AND u.role = 'student' AND u.status = 'active' AND a.course_id = ? AND a.academic_year_id = ?`,
        [collegeId, course_id, academic_year_id]
      );
      let assignedCount = 0;
      for (const student of students) {
        try {
          const id = uuidv4();
          await db.run(
            `INSERT INTO student_fee_status (id, college_id, student_id, fee_structure_id, due_date, total_amount, amount_paid, status)
             VALUES (?, ?, ?, ?, ?, ?, 0, 'due')`,
            [id, collegeId, student.id, feeStructureId, due_date, amount]
          );
          assignedCount++;
        } catch (err) {
          // Ignore duplicate assignment errors (UNIQUE constraint)
        }
      }

      const feeStructure = await db.get(`
        SELECT fs.*, c.name as course_name, ay.name as academic_year_name
        FROM fee_structures fs
        JOIN courses c ON fs.course_id = c.id
        JOIN academic_years ay ON fs.academic_year_id = ay.id
        WHERE fs.id = ?
      `, [feeStructureId]);

      // Send push notifications to students about new fee
      const studentIds = students.map(s => s.id);
      if (studentIds.length > 0) {
        await pushNotificationService.sendFeeNotification(studentIds, {
          id: feeStructureId,
          title: `${fee_type} Fee`,
          amount: amount,
          due_date: due_date
        });
      }

      res.status(201).json({
        message: `Fee structure created and assigned to ${assignedCount} students`,
        fee_structure: feeStructure
      });
    } catch (error) {
      console.error('Fee structure creation error:', error);
      res.status(500).json({
        error: 'Fee structure creation failed',
        message: 'Internal server error while creating fee structure'
      });
    }
  }
);

// Get fee structures for college
router.get('/structures', 
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { page = 1, limit = 10, course_id, academic_year_id, fee_type } = req.query;
      const offset = (page - 1) * limit;
      const collegeId = req.user.college_id;

      let query = `
        SELECT fs.*, c.name as course_name, ay.name as academic_year_name
        FROM fee_structures fs
        JOIN courses c ON fs.course_id = c.id
        JOIN academic_years ay ON fs.academic_year_id = ay.id
        WHERE fs.college_id = ?
      `;
      const params = [collegeId];

      if (course_id) {
        query += ' AND fs.course_id = ?';
        params.push(course_id);
      }

      if (academic_year_id) {
        query += ' AND fs.academic_year_id = ?';
        params.push(academic_year_id);
      }

      if (fee_type) {
        query += ' AND fs.fee_type = ?';
        params.push(fee_type);
      }

      query += ' ORDER BY fs.created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);

      const feeStructures = await db.all(query, params);

      res.json({
        message: 'Fee structures retrieved successfully',
        fee_structures: feeStructures
      });
    } catch (error) {
      console.error('Fee structure retrieval error:', error);
      res.status(500).json({
        error: 'Fee structure retrieval failed',
        message: 'Internal server error while retrieving fee structures'
      });
    }
  }
);

// ==================== FEE COLLECTIONS ====================

// Collect fee payment
router.post('/collections', 
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'teacher'),
  auth.validateFeeCollection,
  auth.checkValidationResult,
  async (req, res) => {
    try {
      const {
        student_id,
        fee_structure_id,
        amount_paid,
        payment_date,
        payment_method,
        transaction_id,
        remarks
      } = req.body;

      const collegeId = req.user.college_id;

      // Verify student belongs to this college
      const student = await db.get(
        'SELECT id FROM users WHERE id = ? AND college_id = ? AND role = "student"',
        [student_id, collegeId]
      );
      if (!student) {
        return res.status(404).json({
          error: 'Student not found',
          message: 'The specified student does not exist in this college'
        });
      }

      // Verify fee structure belongs to this college
      const feeStructure = await db.get(
        'SELECT id, amount FROM fee_structures WHERE id = ? AND college_id = ?',
        [fee_structure_id, collegeId]
      );
      if (!feeStructure) {
        return res.status(404).json({
          error: 'Fee structure not found',
          message: 'The specified fee structure does not exist in this college'
        });
      }

      // Check if payment amount exceeds fee amount
      if (amount_paid > feeStructure.amount) {
        return res.status(400).json({
          error: 'Invalid payment amount',
          message: 'Payment amount cannot exceed the fee amount'
        });
      }

      const collectionId = uuidv4();
      const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create fee collection
      await db.run(`
        INSERT INTO fee_collections (
          id, college_id, student_id, fee_structure_id, amount_paid, 
          payment_date, payment_method, transaction_id, receipt_number, 
          remarks, collected_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [collectionId, collegeId, student_id, fee_structure_id, amount_paid, 
           payment_date, payment_method, transaction_id, receiptNumber, 
           remarks, req.user.id]);

      const collection = await db.get(`
        SELECT fc.*, u.first_name, u.last_name as student_name,
               fs.fee_type, fs.amount as total_amount,
               c.first_name, c.last_name as collected_by_name
        FROM fee_collections fc
        JOIN users u ON fc.student_id = u.id
        JOIN fee_structures fs ON fc.fee_structure_id = fs.id
        JOIN users c ON fc.collected_by = c.id
        WHERE fc.id = ?
      `, [collectionId]);

      res.status(201).json({
        message: 'Fee payment collected successfully',
        collection
      });
    } catch (error) {
      console.error('Fee collection error:', error);
      res.status(500).json({
        error: 'Fee collection failed',
        message: 'Internal server error while collecting fee payment'
      });
    }
  }
);

// Get fee collections for college
router.get('/collections', 
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 10, 
        student_id, 
        fee_structure_id, 
        payment_method,
        status,
        start_date,
        end_date
      } = req.query;
      const offset = (page - 1) * limit;
      const collegeId = req.user.college_id;

      let query = `
        SELECT fc.*, u.first_name, u.last_name as student_name,
               fs.fee_type, fs.amount as total_amount,
               c.first_name, c.last_name as collected_by_name
        FROM fee_collections fc
        JOIN users u ON fc.student_id = u.id
        JOIN fee_structures fs ON fc.fee_structure_id = fs.id
        JOIN users c ON fc.collected_by = c.id
        WHERE fc.college_id = ?
      `;
      const params = [collegeId];

      if (student_id) {
        query += ' AND fc.student_id = ?';
        params.push(student_id);
      }

      if (fee_structure_id) {
        query += ' AND fc.fee_structure_id = ?';
        params.push(fee_structure_id);
      }

      if (payment_method) {
        query += ' AND fc.payment_method = ?';
        params.push(payment_method);
      }

      if (status) {
        query += ' AND fc.status = ?';
        params.push(status);
      }

      if (start_date) {
        query += ' AND fc.payment_date >= ?';
        params.push(start_date);
      }

      if (end_date) {
        query += ' AND fc.payment_date <= ?';
        params.push(end_date);
      }

      query += ' ORDER BY fc.payment_date DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);

      const collections = await db.all(query, params);

      res.json({
        message: 'Fee collections retrieved successfully',
        collections
      });
    } catch (error) {
      console.error('Fee collection retrieval error:', error);
      res.status(500).json({
        error: 'Fee collection retrieval failed',
        message: 'Internal server error while retrieving fee collections'
      });
    }
  }
);

// Get fee collection by ID
router.get('/collections/:collectionId', 
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { collectionId } = req.params;
      const collegeId = req.user.college_id;

      const collection = await db.get(`
        SELECT fc.*, u.first_name, u.last_name as student_name,
               fs.fee_type, fs.amount as total_amount,
               c.first_name, c.last_name as collected_by_name
        FROM fee_collections fc
        JOIN users u ON fc.student_id = u.id
        JOIN fee_structures fs ON fc.fee_structure_id = fs.id
        JOIN users c ON fc.collected_by = c.id
        WHERE fc.id = ? AND fc.college_id = ?
      `, [collectionId, collegeId]);

      if (!collection) {
        return res.status(404).json({
          error: 'Fee collection not found',
          message: 'The specified fee collection does not exist'
        });
      }

      res.json({
        message: 'Fee collection retrieved successfully',
        collection
      });
    } catch (error) {
      console.error('Fee collection retrieval error:', error);
      res.status(500).json({
        error: 'Fee collection retrieval failed',
        message: 'Internal server error while retrieving fee collection'
      });
    }
  }
);

// ==================== STUDENT FEE REPORTS ====================

// Get student fee summary
router.get('/students/:studentId/summary', 
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const collegeId = req.user.college_id;

      // Verify student belongs to this college
      const student = await db.get(
        'SELECT id, first_name, last_name FROM users WHERE id = ? AND college_id = ? AND role = "student"',
        [studentId, collegeId]
      );
      if (!student) {
        return res.status(404).json({
          error: 'Student not found',
          message: 'The specified student does not exist in this college'
        });
      }

      // Get fee summary
      const feeSummary = await db.get(`
        SELECT 
          COUNT(DISTINCT fs.id) as total_fees,
          SUM(fs.amount) as total_amount,
          COUNT(fc.id) as paid_fees,
          SUM(fc.amount_paid) as total_paid,
          (SUM(fs.amount) - SUM(COALESCE(fc.amount_paid, 0))) as outstanding_amount
        FROM fee_structures fs
        LEFT JOIN fee_collections fc ON fs.id = fc.fee_structure_id AND fc.student_id = ?
        WHERE fs.college_id = ?
      `, [studentId, collegeId]);

      // Get detailed fee breakdown
      const feeBreakdown = await db.all(`
        SELECT fs.*, 
               COALESCE(fc.amount_paid, 0) as amount_paid,
               COALESCE(fc.payment_date, NULL) as payment_date,
               COALESCE(fc.status, 'unpaid') as payment_status
        FROM fee_structures fs
        LEFT JOIN fee_collections fc ON fs.id = fc.fee_structure_id AND fc.student_id = ?
        WHERE fs.college_id = ?
        ORDER BY fs.due_date ASC
      `, [studentId, collegeId]);

      res.json({
        message: 'Student fee summary retrieved successfully',
        student: {
          id: student.id,
          name: `${student.first_name} ${student.last_name}`
        },
        summary: feeSummary,
        breakdown: feeBreakdown
      });
    } catch (error) {
      console.error('Student fee summary error:', error);
      res.status(500).json({
        error: 'Student fee summary failed',
        message: 'Internal server error while retrieving student fee summary'
      });
    }
  }
);

// ==================== FEE REPORTS ====================

// Get fee collection report
router.get('/reports/collections', 
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { 
        start_date, 
        end_date, 
        course_id, 
        payment_method,
        group_by = 'date'
      } = req.query;
      const collegeId = req.user.college_id;

      let query = '';
      let params = [];

      if (group_by === 'date') {
        query = `
          SELECT 
            DATE(fc.payment_date) as date,
            COUNT(fc.id) as total_payments,
            SUM(fc.amount_paid) as total_amount,
            COUNT(DISTINCT fc.student_id) as unique_students
          FROM fee_collections fc
          WHERE fc.college_id = ?
        `;
        params = [collegeId];
      } else if (group_by === 'course') {
        query = `
          SELECT 
            c.name as course_name,
            COUNT(fc.id) as total_payments,
            SUM(fc.amount_paid) as total_amount,
            COUNT(DISTINCT fc.student_id) as unique_students
          FROM fee_collections fc
          JOIN fee_structures fs ON fc.fee_structure_id = fs.id
          JOIN courses c ON fs.course_id = c.id
          WHERE fc.college_id = ?
        `;
        params = [collegeId];
      } else if (group_by === 'payment_method') {
        query = `
          SELECT 
            fc.payment_method,
            COUNT(fc.id) as total_payments,
            SUM(fc.amount_paid) as total_amount
          FROM fee_collections fc
          WHERE fc.college_id = ?
        `;
        params = [collegeId];
      }

      if (start_date) {
        query += ' AND fc.payment_date >= $' + (params.length + 1);
        params.push(start_date);
      }

      if (end_date) {
        query += ' AND fc.payment_date <= $' + (params.length + 1);
        params.push(end_date);
      }

      if (course_id) {
        query += ' AND fs.course_id = $' + (params.length + 1);
        params.push(course_id);
      }

      if (payment_method) {
        query += ' AND fc.payment_method = $' + (params.length + 1);
        params.push(payment_method);
      }

      if (group_by === 'date') {
        query += ' GROUP BY DATE(fc.payment_date) ORDER BY DATE(fc.payment_date) DESC';
      } else if (group_by === 'course') {
        query += ' GROUP BY c.id ORDER BY total_amount DESC';
      } else if (group_by === 'payment_method') {
        query += ' GROUP BY fc.payment_method ORDER BY total_amount DESC';
      }

      const report = await db.all(query, params);

      res.json({
        message: 'Fee collection report retrieved successfully',
        report,
        filters: {
          start_date,
          end_date,
          course_id,
          payment_method,
          group_by
        }
      });
    } catch (error) {
      console.error('Fee report error:', error);
      res.status(500).json({
        error: 'Fee report failed',
        message: 'Internal server error while generating fee report'
      });
    }
  }
);

// Get outstanding fees report
router.get('/reports/outstanding', 
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { course_id, academic_year_id, limit = 50 } = req.query;
      const collegeId = req.user.college_id;

      let query = `
        SELECT 
          u.id as student_id,
          u.first_name,
          u.last_name,
          c.name as course_name,
          fs.fee_type,
          fs.amount as total_amount,
          COALESCE(SUM(fc.amount_paid), 0) as amount_paid,
          (fs.amount - COALESCE(SUM(fc.amount_paid), 0)) as outstanding_amount,
          fs.due_date
        FROM fee_structures fs
        JOIN users u ON u.college_id = fs.college_id
        JOIN courses c ON fs.course_id = c.id
        LEFT JOIN fee_collections fc ON fs.id = fc.fee_structure_id AND fc.student_id = u.id
        WHERE fs.college_id = ? AND u.role = 'student'
      `;
      const params = [collegeId];

      if (course_id) {
        query += ' AND fs.course_id = ?';
        params.push(course_id);
      }

      if (academic_year_id) {
        query += ' AND fs.academic_year_id = ?';
        params.push(academic_year_id);
      }

      query += `
        GROUP BY u.id, fs.id
        HAVING outstanding_amount > 0
        ORDER BY outstanding_amount DESC
        LIMIT ?
      `;
      params.push(parseInt(limit));

      const outstandingFees = await db.all(query, params);

      res.json({
        message: 'Outstanding fees report retrieved successfully',
        outstanding_fees: outstandingFees
      });
    } catch (error) {
      console.error('Outstanding fees report error:', error);
      res.status(500).json({
        error: 'Outstanding fees report failed',
        message: 'Internal server error while generating outstanding fees report'
      });
    }
  }
);

module.exports = router;