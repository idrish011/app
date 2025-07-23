const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const Database = require('../models/database');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

// Create new college (Super Admin only)
router.post('/', 
  auth.authenticateToken, 
  auth.authorizeRoles('super_admin'),
  auth.validateCollegeCreation,
  auth.checkValidationResult,
  async (req, res) => {
    try {
      const {
        name,
        domain,
        logo_url,
        address,
        contact_email,
        contact_phone,
        subscription_plan
      } = req.body;

      // Check if domain already exists
      const existingCollege = await db.get('SELECT id FROM colleges WHERE domain = ?', [domain]);
      if (existingCollege) {
        return res.status(409).json({
          error: 'Domain already exists',
          message: 'A college with this domain already exists'
        });
      }

      const collegeId = uuidv4();

      // Create college
      await db.run(`
        INSERT INTO colleges (
          id, name, domain, logo_url, address, contact_email, 
          contact_phone, subscription_plan
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [collegeId, name, domain, logo_url, address, contact_email, contact_phone, subscription_plan]);

      const college = await db.get('SELECT * FROM colleges WHERE id = ?', [collegeId]);

      res.status(201).json({
        message: 'College created successfully',
        college
      });
    } catch (error) {
      console.error('College creation error:', error);
      res.status(500).json({
        error: 'College creation failed',
        message: 'Internal server error while creating college'
      });
    }
  }
);

// Get all colleges (Super Admin only)
router.get('/', 
  auth.authenticateToken, 
  auth.authorizeRoles('super_admin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 10, search = '' } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT c.*, 
               COUNT(u.id) as user_count
        FROM colleges c
        LEFT JOIN users u ON c.id = u.college_id
      `;

      const params = [];
      if (search) {
        query += ` WHERE c.name ILIKE $1 OR c.domain ILIKE $2`;
        params.push(`%${search}%`, `%${search}%`);
      }

      query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(parseInt(limit), offset);

      const colleges = await db.all(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM colleges';
      if (search) {
        countQuery += ' WHERE name ILIKE $1 OR domain ILIKE $2';
      }
      const countResult = await db.get(countQuery, search ? [`%${search}%`, `%${search}%`] : []);

      res.json({
        message: 'Colleges retrieved successfully',
        colleges,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    } catch (error) {
      console.error('College retrieval error:', error);
      res.status(500).json({
        error: 'College retrieval failed',
        message: 'Internal server error while retrieving colleges'
      });
    }
  }
);

// Get specific college
router.get('/:collegeId', 
  auth.authenticateToken,
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;

      const college = await db.get(`
        SELECT c.*, 
               COUNT(DISTINCT u.id) as user_count,
               COUNT(DISTINCT co.id) as course_count
        FROM colleges c
        LEFT JOIN users u ON c.id = u.college_id
        LEFT JOIN courses co ON c.id = co.college_id
        WHERE c.id = ?
        GROUP BY c.id
      `, [collegeId]);

      if (!college) {
        return res.status(404).json({
          error: 'College not found',
          message: 'The specified college does not exist'
        });
      }

      res.json({
        message: 'College retrieved successfully',
        college
      });
    } catch (error) {
      console.error('College retrieval error:', error);
      res.status(500).json({
        error: 'College retrieval failed',
        message: 'Internal server error while retrieving college'
      });
    }
  }
);

// Update college
router.put('/:collegeId', 
  auth.authenticateToken,
  auth.authorizeRoles('super_admin', 'college_admin'),
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;
      const {
        name,
        logo_url,
        address,
        contact_email,
        contact_phone,
        subscription_plan
      } = req.body;

      // Check if college exists
      const existingCollege = await db.get('SELECT id FROM colleges WHERE id = ?', [collegeId]);
      if (!existingCollege) {
        return res.status(404).json({
          error: 'College not found',
          message: 'The specified college does not exist'
        });
      }

      // Update college
      await db.run(`
        UPDATE colleges 
        SET name = ?, logo_url = ?, address = ?, contact_email = ?, 
            contact_phone = ?, subscription_plan = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [name, logo_url, address, contact_email, contact_phone, subscription_plan, collegeId]);

      const updatedCollege = await db.get('SELECT * FROM colleges WHERE id = ?', [collegeId]);

      res.json({
        message: 'College updated successfully',
        college: updatedCollege
      });
    } catch (error) {
      console.error('College update error:', error);
      res.status(500).json({
        error: 'College update failed',
        message: 'Internal server error while updating college'
      });
    }
  }
);

// Delete college (Super Admin only)
router.delete('/:collegeId', 
  auth.authenticateToken,
  auth.authorizeRoles('super_admin'),
  async (req, res) => {
    try {
      const { collegeId } = req.params;

      // Check if college exists
      const college = await db.get('SELECT id FROM colleges WHERE id = ?', [collegeId]);
      if (!college) {
        return res.status(404).json({
          error: 'College not found',
          message: 'The specified college does not exist'
        });
      }

      // Check if college has users
      const userCount = await db.get('SELECT COUNT(*) as count FROM users WHERE college_id = ?', [collegeId]);
      if (userCount.count > 0) {
        return res.status(400).json({
          error: 'Cannot delete college',
          message: 'Cannot delete college with existing users. Please remove all users first.'
        });
      }

      // Delete college
      await db.run('DELETE FROM colleges WHERE id = ?', [collegeId]);

      res.json({
        message: 'College deleted successfully'
      });
    } catch (error) {
      console.error('College deletion error:', error);
      res.status(500).json({
        error: 'College deletion failed',
        message: 'Internal server error while deleting college'
      });
    }
  }
);

// Create department
router.post('/:collegeId/departments', 
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;
      const { name, code, description, head_teacher_id } = req.body;

      // Validate required fields
      if (!name || !code) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Department name and code are required'
        });
      }

      // Check if department code already exists in this college
      const existingDept = await db.get(
        'SELECT id FROM departments WHERE code = ? AND college_id = ?',
        [code, collegeId]
      );
      if (existingDept) {
        return res.status(409).json({
          error: 'Department code already exists',
          message: 'A department with this code already exists in this college'
        });
      }

      const departmentId = uuidv4();

      // Create department
      await db.run(`
        INSERT INTO departments (id, college_id, name, code, description, head_teacher_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [departmentId, collegeId, name, code, description, head_teacher_id]);

      const department = await db.get('SELECT * FROM departments WHERE id = ?', [departmentId]);

      res.status(201).json({
        message: 'Department created successfully',
        department
      });
    } catch (error) {
      console.error('Department creation error:', error);
      res.status(500).json({
        error: 'Department creation failed',
        message: 'Internal server error while creating department'
      });
    }
  }
);

// Get departments for a college
router.get('/:collegeId/departments', 
  auth.authenticateToken,
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;

      const departments = await db.all(`
        SELECT d.*, u.first_name, u.last_name as head_teacher_name,
               COUNT(c.id) as course_count
        FROM departments d
        LEFT JOIN users u ON d.head_teacher_id = u.id
        LEFT JOIN courses c ON d.id = c.department_id
        WHERE d.college_id = ?
        GROUP BY d.id
        ORDER BY d.name
      `, [collegeId]);

      res.json({
        message: 'Departments retrieved successfully',
        departments
      });
    } catch (error) {
      console.error('Department retrieval error:', error);
      res.status(500).json({
        error: 'Department retrieval failed',
        message: 'Internal server error while retrieving departments'
      });
    }
  }
);

// Create academic year
router.post('/:collegeId/academic-years', 
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;
      const { name, start_date, end_date } = req.body;

      // Validate required fields
      if (!name || !start_date || !end_date) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Academic year name, start date, and end date are required'
        });
      }

      // Check if dates are valid
      if (new Date(start_date) >= new Date(end_date)) {
        return res.status(400).json({
          error: 'Invalid date range',
          message: 'End date must be after start date'
        });
      }

      const academicYearId = uuidv4();

      // Create academic year
      await db.run(`
        INSERT INTO academic_years (id, college_id, name, start_date, end_date)
        VALUES (?, ?, ?, ?, ?)
      `, [academicYearId, collegeId, name, start_date, end_date]);

      const academicYear = await db.get('SELECT * FROM academic_years WHERE id = ?', [academicYearId]);

      res.status(201).json({
        message: 'Academic year created successfully',
        academic_year: academicYear
      });
    } catch (error) {
      console.error('Academic year creation error:', error);
      res.status(500).json({
        error: 'Academic year creation failed',
        message: 'Internal server error while creating academic year'
      });
    }
  }
);

// Get academic years for a college
router.get('/:collegeId/academic-years', 
  auth.authenticateToken,
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;

      const academicYears = await db.all(`
        SELECT ay.*, COUNT(s.id) as semester_count
        FROM academic_years ay
        LEFT JOIN semesters s ON ay.id = s.academic_year_id
        WHERE ay.college_id = ?
        GROUP BY ay.id
        ORDER BY ay.start_date DESC
      `, [collegeId]);

      res.json({
        message: 'Academic years retrieved successfully',
        academic_years: academicYears
      });
    } catch (error) {
      console.error('Academic year retrieval error:', error);
      res.status(500).json({
        error: 'Academic year retrieval failed',
        message: 'Internal server error while retrieving academic years'
      });
    }
  }
);

// Get college statistics
router.get('/:collegeId/stats', 
  auth.authenticateToken,
  auth.authorizeCollegeAccess,
  async (req, res) => {
    try {
      const { collegeId } = req.params;

      // Get various statistics
      const stats = await db.get(`
        SELECT 
          (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'student') as student_count,
          (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'teacher') as teacher_count,
          (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'parent') as parent_count,
          (SELECT COUNT(*) FROM courses WHERE college_id = ?) as course_count,
          (SELECT COUNT(*) FROM classes WHERE college_id = ?) as class_count,
          (SELECT COUNT(*) FROM academic_years WHERE college_id = ? AND status = 'active') as active_academic_years
      `, [collegeId, collegeId, collegeId, collegeId, collegeId, collegeId, collegeId]);

      res.json({
        message: 'College statistics retrieved successfully',
        stats
      });
    } catch (error) {
      console.error('Statistics retrieval error:', error);
      res.status(500).json({
        error: 'Statistics retrieval failed',
        message: 'Internal server error while retrieving statistics'
      });
    }
  }
);

// Super Admin: Update landing display and order for a college
router.patch('/:collegeId/landing', 
  auth.authenticateToken,
  auth.authorizeRoles('super_admin'),
  async (req, res) => {
    try {
      console.log('Landing update request:', req.params, req.body);
      console.log('User making request:', req.user);
      const { collegeId } = req.params;
      const { show_on_landing, landing_order } = req.body;
      
      // Check if college exists
      const college = await db.get('SELECT * FROM colleges WHERE id = ?', [collegeId]);
      if (!college) {
        console.log('College not found:', collegeId);
        return res.status(404).json({ error: 'College not found' });
      }
      
      console.log('Updating college landing settings:', { collegeId, show_on_landing, landing_order });
      await db.run(`
        UPDATE colleges SET show_on_landing = ?, landing_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `, [show_on_landing ? 1 : 0, landing_order || 0, collegeId]);
      
      const updated = await db.get('SELECT * FROM colleges WHERE id = ?', [collegeId]);
      console.log('College updated successfully:', updated);
      res.json({ message: 'Landing display updated', college: updated });
    } catch (error) {
      console.error('Landing update error:', error);
      res.status(500).json({ error: 'Failed to update landing display', message: error.message });
    }
  }
);

module.exports = router;