const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const SecurityMiddleware = require('../middleware/security');
const Database = require('../models/database');

const router = express.Router();
const auth = new AuthMiddleware();
const security = new SecurityMiddleware();
const db = new Database();

// List all student fees and statuses for a college
router.get('/student-fees', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const { student_id, status, fee_structure_id } = req.query;
    let query = `
      SELECT sfs.*, u.first_name, u.last_name, u.email, fs.fee_type, fs.amount as structure_amount, fs.due_date as structure_due_date
      FROM student_fee_status sfs
      JOIN users u ON sfs.student_id = u.id
      JOIN fee_structures fs ON sfs.fee_structure_id = fs.id
      WHERE sfs.college_id = ?
    `;
    const params = [collegeId];
    if (student_id) {
      query += ' AND sfs.student_id = ?';
      params.push(student_id);
    }
    if (status) {
      query += ' AND sfs.status = ?';
      params.push(status);
    }
    if (fee_structure_id) {
      query += ' AND sfs.fee_structure_id = ?';
      params.push(fee_structure_id);
    }
    query += ' ORDER BY sfs.due_date DESC';
    const results = await db.all(query, params);
    res.json({ student_fees: results });
  } catch (error) {
    console.error('Error listing student fees:', error);
    res.status(500).json({ error: 'Failed to list student fees' });
  }
});

// Assign a fee to a student (create student_fee_status record)
router.post('/student-fees', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const { student_id, fee_structure_id, due_date, total_amount, remarks } = req.body;
    if (!student_id || !fee_structure_id || !due_date || !total_amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Check for existing assignment
    const exists = await db.get(
      'SELECT id FROM student_fee_status WHERE student_id = ? AND fee_structure_id = ?',
      [student_id, fee_structure_id]
    );
    if (exists) {
      return res.status(409).json({ error: 'Fee already assigned to this student' });
    }
    const id = uuidv4();
    await db.run(
      `INSERT INTO student_fee_status (id, college_id, student_id, fee_structure_id, due_date, total_amount, amount_paid, status, remarks) VALUES (?, ?, ?, ?, ?, ?, 0, 'due', ?)`,
      [id, collegeId, student_id, fee_structure_id, due_date, total_amount, remarks || null]
    );
    const record = await db.get('SELECT * FROM student_fee_status WHERE id = ?', [id]);
    res.status(201).json({ message: 'Fee assigned to student', student_fee: record });
  } catch (error) {
    console.error('Error assigning fee to student:', error);
    res.status(500).json({ error: 'Failed to assign fee to student' });
  }
});

// Edit a student fee assignment/status
router.put('/student-fees/:id', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { due_date, total_amount, status, remarks } = req.body;
    
    // Build update fields object
    const updateFields = {};
    if (due_date) updateFields.due_date = due_date;
    if (total_amount) updateFields.total_amount = total_amount;
    if (status) updateFields.status = status;
    if (remarks !== undefined) updateFields.remarks = remarks;
    
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Use secure update helper to prevent SQL injection
    const { query, params } = security.secureUpdate('student_fee_status', updateFields, 'id = ?', [id]);
    
    await db.run(query, params);
    const updated = await db.get('SELECT * FROM student_fee_status WHERE id = ?', [id]);
    res.json({ message: 'Student fee assignment updated', student_fee: updated });
  } catch (error) {
    console.error('Error updating student fee assignment:', error);
    res.status(500).json({ error: 'Failed to update student fee assignment' });
  }
});

// Record a payment for a student fee (update amount_paid/status)
router.post('/student-fees/:id/pay', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_paid, payment_date, payment_method, transaction_id, remarks } = req.body;
    if (!amount_paid || !payment_date) {
      return res.status(400).json({ error: 'Missing required payment fields' });
    }
    // Get current fee status
    const fee = await db.get('SELECT * FROM student_fee_status WHERE id = ?', [id]);
    if (!fee) {
      return res.status(404).json({ error: 'Student fee assignment not found' });
    }
    const newAmountPaid = parseFloat(fee.amount_paid) + parseFloat(amount_paid);
    let newStatus = 'partial';
    if (newAmountPaid >= parseFloat(fee.total_amount)) {
      newStatus = 'paid';
    } else if (newAmountPaid === 0) {
      newStatus = 'due';
    }
    // Update student_fee_status
    await db.run(
      'UPDATE student_fee_status SET amount_paid = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newAmountPaid, newStatus, id]
    );
    // Optionally, record in fee_collections
    const collectionId = uuidv4();
    await db.run(
      `INSERT INTO fee_collections (id, college_id, student_id, fee_structure_id, amount_paid, payment_date, payment_method, transaction_id, status, remarks, collected_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [collectionId, fee.college_id, fee.student_id, fee.fee_structure_id, amount_paid, payment_date, payment_method || null, transaction_id || null, 'paid', remarks || null, req.user.id]
    );
    const updated = await db.get('SELECT * FROM student_fee_status WHERE id = ?', [id]);
    res.json({ message: 'Payment recorded', student_fee: updated });
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// Fetch summary stats for student fees (total due, collected, overdue, etc.)
router.get('/student-fees/summary', auth.authenticateToken, auth.authorizeRoles('college_admin', 'super_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    // Total assigned
    const totalAssigned = await db.get('SELECT COUNT(*) as count, SUM(total_amount) as total FROM student_fee_status WHERE college_id = ?', [collegeId]);
    // Total collected
    const totalCollected = await db.get('SELECT SUM(amount_paid) as collected FROM student_fee_status WHERE college_id = ?', [collegeId]);
    // Overdue count/amount
    const overdue = await db.get("SELECT COUNT(*) as count, SUM(total_amount - amount_paid) as overdue FROM student_fee_status WHERE college_id = ? AND status = 'overdue'", [collegeId]);
    // Due count/amount
    const due = await db.get("SELECT COUNT(*) as count, SUM(total_amount - amount_paid) as due FROM student_fee_status WHERE college_id = ? AND status = 'due'", [collegeId]);
    // Paid count/amount
    const paid = await db.get("SELECT COUNT(*) as count, SUM(total_amount) as paid FROM student_fee_status WHERE college_id = ? AND status = 'paid'", [collegeId]);
    res.json({
      total_assigned: totalAssigned,
      total_collected: totalCollected,
      overdue,
      due,
      paid
    });
  } catch (error) {
    console.error('Error fetching student fee summary:', error);
    res.status(500).json({ error: 'Failed to fetch student fee summary' });
  }
});

module.exports = router; 