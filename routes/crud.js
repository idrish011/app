const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const Database = require('../models/database');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

// Use the proper authentication middleware from AuthMiddleware class

// ==================== DEPARTMENTS CRUD ====================

// [REMOVED] All department CRUD endpoints and logic

// ==================== COURSES CRUD ====================

// Create course
router.post('/courses', auth.authenticateToken, async (req, res) => {
  try {
    const { name, code, description, credits, duration_months, fee_amount } = req.body;
    const { college_id } = req.user;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    // Check if course code already exists in this college
    const existingCourse = await db.get(
      'SELECT id FROM courses WHERE college_id = ? AND code = ?',
      [college_id, code]
    );

    if (existingCourse) {
      return res.status(409).json({ error: 'Course code already exists' });
    }

    const courseId = uuidv4();
    await db.run(
      `INSERT INTO courses (id, college_id, name, code, description, credits, duration_months, fee_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [courseId, college_id, name, code, description, credits, duration_months, fee_amount]
    );

    const course = await db.get('SELECT * FROM courses WHERE id = ?', [courseId]);
    res.status(201).json({ message: 'Course created successfully', course });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// Get all courses for college
router.get('/courses', auth.authenticateToken, async (req, res) => {
  try {
    const { college_id } = req.user;
    const courses = await db.all(`
      SELECT * FROM courses
      WHERE college_id = ?
      ORDER BY name
    `, [college_id]);

    res.json({ courses });
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Update course
router.put('/courses/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, credits, duration_months, fee_amount, status } = req.body;
    const { college_id } = req.user;

    // Check if course exists and belongs to college
    const existingCourse = await db.get(
      'SELECT id FROM courses WHERE id = ? AND college_id = ?',
      [id, college_id]
    );

    if (!existingCourse) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if code already exists (excluding current course)
    if (code) {
      const duplicateCode = await db.get(
        'SELECT id FROM courses WHERE college_id = ? AND code = ? AND id != ?',
        [college_id, code, id]
      );

      if (duplicateCode) {
        return res.status(409).json({ error: 'Course code already exists' });
      }
    }

    await db.run(
      `UPDATE courses 
       SET name = ?, code = ?, description = ?, credits = ?, 
           duration_months = ?, fee_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, code, description, credits, duration_months, fee_amount, status, id]
    );

    const course = await db.get('SELECT * FROM courses WHERE id = ?', [id]);
    res.json({ message: 'Course updated successfully', course });
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// Delete course
router.delete('/courses/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { college_id } = req.user;

    // Check if course exists and belongs to college
    const existingCourse = await db.get(
      'SELECT id FROM courses WHERE id = ? AND college_id = ?',
      [id, college_id]
    );

    if (!existingCourse) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if course has classes
    const hasClasses = await db.get(
      'SELECT id FROM classes WHERE course_id = ? LIMIT 1',
      [id]
    );

    if (hasClasses) {
      return res.status(400).json({ error: 'Cannot delete course with existing classes' });
    }

    await db.run('DELETE FROM courses WHERE id = ?', [id]);
    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// ==================== CLASSES CRUD ====================

// Create class
router.post('/classes', auth.authenticateToken, async (req, res) => {
  try {
    const { 
      course_id, semester_id, teacher_id, name, schedule, room_number, max_students 
    } = req.body;
    const { college_id } = req.user;

    if (!course_id || !semester_id || !teacher_id || !name) {
      return res.status(400).json({ error: 'Course, semester, teacher and name are required' });
    }

    // Verify course belongs to college
    const course = await db.get(
      'SELECT id FROM courses WHERE id = ? AND college_id = ?',
      [course_id, college_id]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Verify teacher belongs to college
    const teacher = await db.get(
      'SELECT id FROM users WHERE id = ? AND college_id = ? AND role = "teacher"',
      [teacher_id, college_id]
    );

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const classId = uuidv4();
    await db.run(
      `INSERT INTO classes (id, college_id, course_id, semester_id, teacher_id, name, schedule, room_number, max_students)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [classId, college_id, course_id, semester_id, teacher_id, name, schedule, room_number, max_students]
    );

    const classData = await db.get('SELECT * FROM classes WHERE id = ?', [classId]);
    res.status(201).json({ message: 'Class created successfully', class: classData });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// Get all classes for college
router.get('/classes', auth.authenticateToken, async (req, res) => {
  try {
    const { college_id } = req.user;
    const classes = await db.all(`
      SELECT cl.*, c.name as course_name, c.code as course_code, 
             s.name as semester_name, u.first_name, u.last_name as teacher_name
      FROM classes cl
      JOIN courses c ON cl.course_id = c.id
      JOIN semesters s ON cl.semester_id = s.id
      JOIN users u ON cl.teacher_id = u.id
      WHERE cl.college_id = ?
      ORDER BY cl.name
    `, [college_id]);

    res.json({ classes });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// Update class
router.put('/classes/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      course_id, semester_id, teacher_id, name, schedule, room_number, max_students, status 
    } = req.body;
    const { college_id } = req.user;

    // Check if class exists and belongs to college
    const existingClass = await db.get(
      'SELECT id FROM classes WHERE id = ? AND college_id = ?',
      [id, college_id]
    );

    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    await db.run(
      `UPDATE classes 
       SET course_id = ?, semester_id = ?, teacher_id = ?, name = ?, schedule = ?, 
           room_number = ?, max_students = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [course_id, semester_id, teacher_id, name, schedule, room_number, max_students, status, id]
    );

    const classData = await db.get('SELECT * FROM classes WHERE id = ?', [id]);
    res.json({ message: 'Class updated successfully', class: classData });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// Delete class
router.delete('/classes/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { college_id } = req.user;

    // Check if class exists and belongs to college
    const existingClass = await db.get(
      'SELECT id FROM classes WHERE id = ? AND college_id = ?',
      [id, college_id]
    );

    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Check if class has enrollments
    const hasEnrollments = await db.get(
      'SELECT id FROM class_enrollments WHERE class_id = ? LIMIT 1',
      [id]
    );

    if (hasEnrollments) {
      return res.status(400).json({ error: 'Cannot delete class with existing enrollments' });
    }

    await db.run('DELETE FROM classes WHERE id = ?', [id]);
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

// ==================== ASSIGNMENTS CRUD ====================

// Create assignment
router.post('/assignments', auth.authenticateToken, async (req, res) => {
  try {
    const { 
      class_id, title, description, due_date, max_score, assignment_type 
    } = req.body;
    const { id: teacher_id, college_id } = req.user;

    if (!class_id || !title || !due_date) {
      return res.status(400).json({ error: 'Class, title and due date are required' });
    }

    // Verify class belongs to teacher and college
    const classData = await db.get(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ? AND college_id = ?',
      [class_id, teacher_id, college_id]
    );

    if (!classData) {
      return res.status(404).json({ error: 'Class not found or access denied' });
    }

    const assignmentId = uuidv4();
    await db.run(
      `INSERT INTO assignments (id, class_id, title, description, due_date, max_score, assignment_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [assignmentId, class_id, title, description, due_date, max_score, assignment_type]
    );

    const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', [assignmentId]);
    res.status(201).json({ message: 'Assignment created successfully', assignment });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// Get assignments for teacher
router.get('/assignments', auth.authenticateToken, async (req, res) => {
  try {
    const { id: teacher_id, college_id } = req.user;
    const assignments = await db.all(`
      SELECT a.*, cl.name as class_name, c.name as course_name
      FROM assignments a
      JOIN classes cl ON a.class_id = cl.id
      JOIN courses c ON cl.course_id = c.id
      WHERE cl.teacher_id = ? AND cl.college_id = ? AND a.status != 'deleted'
      ORDER BY a.due_date ASC
    `, [teacher_id, college_id]);

    res.json({ assignments });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Update assignment
router.put('/assignments/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, description, due_date, max_score, assignment_type, status 
    } = req.body;
    const { id: teacher_id } = req.user;

    // Check if assignment exists and belongs to teacher
    const existingAssignment = await db.get(
      `SELECT a.id FROM assignments a
       JOIN classes cl ON a.class_id = cl.id
       WHERE a.id = ? AND cl.teacher_id = ?`,
      [id, teacher_id]
    );

    if (!existingAssignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    await db.run(
      `UPDATE assignments 
       SET title = ?, description = ?, due_date = ?, max_score = ?, 
           assignment_type = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [title, description, due_date, max_score, assignment_type, status, id]
    );

    const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', [id]);
    res.json({ message: 'Assignment updated successfully', assignment });
  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

// Delete assignment
router.delete('/assignments/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { id: teacher_id } = req.user;

    // Check if assignment exists and belongs to teacher
    const existingAssignment = await db.get(
      `SELECT a.id FROM assignments a
       JOIN classes cl ON a.class_id = cl.id
       WHERE a.id = ? AND cl.teacher_id = ?`,
      [id, teacher_id]
    );

    if (!existingAssignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Soft delete by setting status to deleted
    await db.run('UPDATE assignments SET status = "deleted" WHERE id = ?', [id]);
    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// ==================== ATTENDANCE CRUD ====================

// Mark attendance
router.post('/attendance', auth.authenticateToken, async (req, res) => {
  try {
    const { class_id, date, attendance_data } = req.body;
    const { id: teacher_id } = req.user;

    if (!class_id || !date || !attendance_data || !Array.isArray(attendance_data)) {
      return res.status(400).json({ error: 'Class, date and attendance data are required' });
    }

    // Verify class belongs to teacher and get college_id
    const classData = await db.get(
      'SELECT cl.id, cl.college_id FROM classes cl WHERE cl.id = ? AND cl.teacher_id = ?',
      [class_id, teacher_id]
    );

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Import attendance validation
    const { isAttendanceAllowed } = require('../utils/attendanceValidation');

    // Check if attendance is allowed on this date
    const attendanceCheck = await isAttendanceAllowed(date, classData.college_id);
    if (!attendanceCheck.allowed) {
      return res.status(400).json({ 
        error: 'Attendance not allowed',
        message: attendanceCheck.reason 
      });
    }

    // Check if attendance already exists for this date and class
    const existingAttendance = await db.get(
      'SELECT id FROM attendance WHERE class_id = ? AND date = ? LIMIT 1',
      [class_id, date]
    );

    if (existingAttendance) {
      return res.status(409).json({ error: 'Attendance already marked for this date' });
    }

    // Insert attendance records
    for (const record of attendance_data) {
      const { student_id, status, remarks } = record;
      const attendanceId = uuidv4();
      
      await db.run(
        `INSERT INTO attendance (id, class_id, student_id, date, status, remarks)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [attendanceId, class_id, student_id, date, status, remarks]
      );
    }

    res.status(201).json({ message: 'Attendance marked successfully' });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Get attendance for class
router.get('/attendance/:class_id', auth.authenticateToken, async (req, res) => {
  try {
    const { class_id } = req.params;
    const { id: teacher_id } = req.user;

    // Verify class belongs to teacher
    const classData = await db.get(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [class_id, teacher_id]
    );

    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const attendance = await db.all(`
      SELECT a.*, s.first_name, s.last_name, s.email
      FROM attendance a
      JOIN users s ON a.student_id = s.id
      WHERE a.class_id = ?
      ORDER BY a.date DESC, s.first_name, s.last_name
    `, [class_id]);

    res.json({ attendance });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Update attendance
router.put('/attendance/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    const { id: teacher_id } = req.user;

    // Check if attendance exists and belongs to teacher's class
    const existingAttendance = await db.get(
      `SELECT a.id FROM attendance a
       JOIN classes cl ON a.class_id = cl.id
       WHERE a.id = ? AND cl.teacher_id = ?`,
      [id, teacher_id]
    );

    if (!existingAttendance) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    await db.run(
      `UPDATE attendance 
       SET status = ?, remarks = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, remarks, id]
    );

    const attendance = await db.get('SELECT * FROM attendance WHERE id = ?', [id]);
    res.json({ message: 'Attendance updated successfully', attendance });
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

// ==================== GRADES CRUD ====================

// Submit grade
router.post('/grades', auth.authenticateToken, async (req, res) => {
  try {
    const { 
      assignment_id, student_id, grade_percentage, grade_letter, feedback 
    } = req.body;
    const { id: teacher_id } = req.user;

    if (!assignment_id || !student_id || !grade_percentage) {
      return res.status(400).json({ error: 'Assignment, student and grade are required' });
    }

    // Verify assignment belongs to teacher
    const assignment = await db.get(
      `SELECT a.id FROM assignments a
       JOIN classes cl ON a.class_id = cl.id
       WHERE a.id = ? AND cl.teacher_id = ?`,
      [assignment_id, teacher_id]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Check if grade already exists
    const existingGrade = await db.get(
      'SELECT id FROM grades WHERE assignment_id = ? AND student_id = ?',
      [assignment_id, student_id]
    );

    if (existingGrade) {
      return res.status(409).json({ error: 'Grade already exists for this student and assignment' });
    }

    const gradeId = uuidv4();
    await db.run(
      `INSERT INTO grades (id, assignment_id, student_id, grade_percentage, grade_letter, feedback, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [gradeId, assignment_id, student_id, grade_percentage, grade_letter, feedback]
    );

    const grade = await db.get('SELECT * FROM grades WHERE id = ?', [gradeId]);
    res.status(201).json({ message: 'Grade submitted successfully', grade });
  } catch (error) {
    console.error('Submit grade error:', error);
    res.status(500).json({ error: 'Failed to submit grade' });
  }
});

// Get grades for assignment
router.get('/grades/assignment/:assignment_id', auth.authenticateToken, async (req, res) => {
  try {
    const { assignment_id } = req.params;
    const { id: teacher_id } = req.user;

    // Verify assignment belongs to teacher
    const assignment = await db.get(
      `SELECT a.id FROM assignments a
       JOIN classes cl ON a.class_id = cl.id
       WHERE a.id = ? AND cl.teacher_id = ?`,
      [assignment_id, teacher_id]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const grades = await db.all(`
      SELECT g.*, s.first_name, s.last_name, s.email
      FROM grades g
      JOIN users s ON g.student_id = s.id
      WHERE g.assignment_id = ? AND g.status != 'deleted'
      ORDER BY s.first_name, s.last_name
    `, [assignment_id]);

    res.json({ grades });
  } catch (error) {
    console.error('Get grades error:', error);
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
});

// Update grade
router.put('/grades/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { grade_percentage, grade_letter, feedback } = req.body;
    const { id: teacher_id } = req.user;

    // Check if grade exists and belongs to teacher's assignment
    const existingGrade = await db.get(
      `SELECT g.id FROM grades g
       JOIN assignments a ON g.assignment_id = a.id
       JOIN classes cl ON a.class_id = cl.id
       WHERE g.id = ? AND cl.teacher_id = ?`,
      [id, teacher_id]
    );

    if (!existingGrade) {
      return res.status(404).json({ error: 'Grade not found' });
    }

    await db.run(
      `UPDATE grades 
       SET grade_percentage = ?, grade_letter = ?, feedback = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [grade_percentage, grade_letter, feedback, id]
    );

    const grade = await db.get('SELECT * FROM grades WHERE id = ?', [id]);
    res.json({ message: 'Grade updated successfully', grade });
  } catch (error) {
    console.error('Update grade error:', error);
    res.status(500).json({ error: 'Failed to update grade' });
  }
});

// ==================== FEE STRUCTURES CRUD ====================

// Create fee structure
router.post('/fee-structures', auth.authenticateToken, async (req, res) => {
  try {
    const { 
      course_id, academic_year_id, fee_type, amount, due_date, is_optional 
    } = req.body;
    const { college_id } = req.user;

    if (!course_id || !academic_year_id || !fee_type || !amount) {
      return res.status(400).json({ error: 'Course, academic year, fee type and amount are required' });
    }

    // Verify course belongs to college
    const course = await db.get(
      'SELECT id FROM courses WHERE id = ? AND college_id = ?',
      [course_id, college_id]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const feeStructureId = uuidv4();
    await db.run(
      `INSERT INTO fee_structures (id, college_id, course_id, academic_year_id, fee_type, amount, due_date, is_optional)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [feeStructureId, college_id, course_id, academic_year_id, fee_type, amount, due_date, is_optional]
    );

    const feeStructure = await db.get('SELECT * FROM fee_structures WHERE id = ?', [feeStructureId]);
    res.status(201).json({ message: 'Fee structure created successfully', feeStructure });
  } catch (error) {
    console.error('Create fee structure error:', error);
    res.status(500).json({ error: 'Failed to create fee structure' });
  }
});

// Get fee structures for college
router.get('/fee-structures', auth.authenticateToken, async (req, res) => {
  try {
    const { college_id } = req.user;
    const feeStructures = await db.all(`
      SELECT fs.*, c.name as course_name, c.code as course_code, ay.name as academic_year_name
      FROM fee_structures fs
      JOIN courses c ON fs.course_id = c.id
      JOIN academic_years ay ON fs.academic_year_id = ay.id
      WHERE fs.college_id = ?
      ORDER BY fs.fee_type, fs.due_date
    `, [college_id]);

    res.json({ feeStructures });
  } catch (error) {
    console.error('Get fee structures error:', error);
    res.status(500).json({ error: 'Failed to fetch fee structures' });
  }
});

// Update fee structure
router.put('/fee-structures/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      course_id, academic_year_id, fee_type, amount, due_date, is_optional 
    } = req.body;
    const { college_id } = req.user;

    // Check if fee structure exists and belongs to college
    const existingFeeStructure = await db.get(
      'SELECT id FROM fee_structures WHERE id = ? AND college_id = ?',
      [id, college_id]
    );

    if (!existingFeeStructure) {
      return res.status(404).json({ error: 'Fee structure not found' });
    }

    await db.run(
      `UPDATE fee_structures 
       SET course_id = ?, academic_year_id = ?, fee_type = ?, amount = ?, due_date = ?, is_optional = ?
       WHERE id = ?`,
      [course_id, academic_year_id, fee_type, amount, due_date, is_optional, id]
    );

    const feeStructure = await db.get('SELECT * FROM fee_structures WHERE id = ?', [id]);
    res.json({ message: 'Fee structure updated successfully', feeStructure });
  } catch (error) {
    console.error('Update fee structure error:', error);
    res.status(500).json({ error: 'Failed to update fee structure' });
  }
});

// Delete fee structure
router.delete('/fee-structures/:id', auth.authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { college_id } = req.user;

    // Check if fee structure exists and belongs to college
    const existingFeeStructure = await db.get(
      'SELECT id FROM fee_structures WHERE id = ? AND college_id = ?',
      [id, college_id]
    );

    if (!existingFeeStructure) {
      return res.status(404).json({ error: 'Fee structure not found' });
    }

    // Check if fee structure has collections
    const hasCollections = await db.get(
      'SELECT id FROM fee_collections WHERE fee_structure_id = ? LIMIT 1',
      [id]
    );

    if (hasCollections) {
      return res.status(400).json({ error: 'Cannot delete fee structure with existing collections' });
    }

    await db.run('DELETE FROM fee_structures WHERE id = ?', [id]);
    res.json({ message: 'Fee structure deleted successfully' });
  } catch (error) {
    console.error('Delete fee structure error:', error);
    res.status(500).json({ error: 'Failed to delete fee structure' });
  }
});

module.exports = router; 