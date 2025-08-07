const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const Database = require('../models/database');
const multer = require('multer');
const path = require('path');
const pushNotificationService = require('../utils/pushNotifications');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

// ==================== COURSES ====================

// Create course
router.post('/courses',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  auth.validateCourseCreation,
  auth.checkValidationResult,
  async (req, res) => {
    try {
      const {
        name,
        code,
        description,
        credits,
        duration_months,
        fee_amount
      } = req.body;

      const collegeId = req.user.college_id;

      // Check if course code already exists in this college
      const existingCourse = await db.get(
        'SELECT id FROM courses WHERE code = $1 AND college_id = $2',
        [code, collegeId]
      );
      if (existingCourse) {
        return res.status(409).json({
          error: 'Course code already exists',
          message: 'A course with this code already exists in this college'
        });
      }

      const courseId = uuidv4();

      // Create course
      await db.run(`
        INSERT INTO courses (id, college_id, name, code, description, credits, duration_months, fee_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [courseId, collegeId, name, code, description, credits, duration_months, fee_amount]);

      const course = await db.get('SELECT * FROM courses WHERE id = $1', [courseId]);

      res.status(201).json({
        message: 'Course created successfully',
        course
      });
    } catch (error) {
      console.error('Course creation error:', error);
      res.status(500).json({
        error: 'Course creation failed',
        message: 'Internal server error while creating course'
      });
    }
  }
);

// Get courses for college
router.get('/courses',
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { page = 1, limit = 10, search = '' } = req.query;
      const offset = (page - 1) * limit;
      const collegeId = req.user.college_id;

      let query = `
        SELECT c.id, c.name, c.code, c.description, c.credits, c.duration_months, c.fee_amount, c.status, c.college_id, c.created_at, COUNT(cl.id) as class_count
        FROM courses c
        LEFT JOIN classes cl ON c.id = cl.course_id
        WHERE c.college_id = $1
      `;
      const params = [collegeId];
      let paramIndex = 2;

      if (search) {
        query += ` AND (c.name LIKE $${paramIndex} OR c.code LIKE $${paramIndex + 1})`;
        params.push(`%${search}%`, `%${search}%`);
        paramIndex += 2;
      }

      query += ` GROUP BY c.id, c.name, c.code, c.description, c.credits, c.duration_months, c.fee_amount, c.status, c.college_id, c.created_at ORDER BY c.name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(parseInt(limit), offset);

      const courses = await db.all(query, params);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM courses c 
        WHERE c.college_id = $1
      `;
      const countParams = [collegeId];
      let countParamIndex = 2;

      if (search) {
        countQuery += ` AND (c.name LIKE $${countParamIndex} OR c.code LIKE $${countParamIndex + 1})`;
        countParams.push(`%${search}%`, `%${search}%`);
        countParamIndex += 2;
      }

      const countResult = await db.get(countQuery, countParams);

      res.json({
        message: 'Courses retrieved successfully',
        courses,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    } catch (error) {
      console.error('Get courses error:', error);
      res.status(500).json({
        error: 'Get courses failed',
        message: 'Internal server error while retrieving courses'
      });
    }
  }
);

// ==================== CLASSES ====================

// Create class
router.post('/classes',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'teacher'),
  async (req, res) => {
    try {
      const {
        course_id,
        semester_id,
        teacher_id,
        name,
        schedule,
        room_number,
        max_students
      } = req.body;

      const collegeId = req.user.college_id;

      // Validate required fields
      if (!course_id || !semester_id || !teacher_id || !name) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Course ID, semester ID, teacher ID, and class name are required'
        });
      }

      // Verify course belongs to this college
      const course = await db.get(
        'SELECT id FROM courses WHERE id = $1 AND college_id = $2',
        [course_id, collegeId]
      );
      if (!course) {
        return res.status(404).json({
          error: 'Course not found',
          message: 'The specified course does not exist in this college'
        });
      }

      // Verify teacher belongs to this college
      const teacher = await db.get(
        `SELECT id FROM users WHERE id = $1 AND college_id = $2 AND role = 'teacher'`,
        [teacher_id, collegeId]
      );
      if (!teacher) {
        return res.status(404).json({
          error: 'Teacher not found',
          message: 'The specified teacher does not exist in this college'
        });
      }

      const classId = uuidv4();

      // Create class
      await db.run(`
        INSERT INTO classes (id, college_id, course_id, semester_id, teacher_id, name, schedule, room_number, max_students)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [classId, collegeId, course_id, semester_id, teacher_id, name, schedule, room_number, max_students]);

      const newClass = await db.get(`
        SELECT cl.*, c.name as course_name, u.first_name, u.last_name as teacher_name
        FROM classes cl
        JOIN courses c ON cl.course_id = c.id
        JOIN users u ON cl.teacher_id = u.id
        WHERE cl.id = $1
      `, [classId]);

      res.status(201).json({
        message: 'Class created successfully',
        class: newClass
      });
    } catch (error) {
      console.error('Class creation error:', error);
      res.status(500).json({
        error: 'Class creation failed',
        message: 'Internal server error while creating class'
      });
    }
  }
);

// Get classes for college
router.get('/classes',
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { page = 1, limit = 10, course_id, teacher_id, search = '' } = req.query;
      const offset = (page - 1) * limit;
      const collegeId = req.user.college_id;

      let query = `
        SELECT cl.id, cl.name, cl.course_id, cl.semester_id, cl.teacher_id, cl.schedule, cl.room_number, cl.max_students, cl.status, cl.college_id, cl.created_at, 
               c.name as course_name, u.first_name, u.last_name as teacher_name,
               COUNT(ce.student_id) as enrolled_students
        FROM classes cl
        JOIN courses c ON cl.course_id = c.id
        JOIN users u ON cl.teacher_id = u.id
        LEFT JOIN class_enrollments ce ON cl.id = ce.class_id
        WHERE cl.college_id = $1
      `;
      const params = [collegeId];
      let paramIndex = 2;

      if (course_id) {
        query += ` AND cl.course_id = $${paramIndex}`;
        params.push(course_id);
        paramIndex++;
      }

      if (teacher_id) {
        query += ` AND cl.teacher_id = $${paramIndex}`;
        params.push(teacher_id);
        paramIndex++;
      }

      if (search) {
        query += ` AND (cl.name LIKE $${paramIndex} OR c.name LIKE $${paramIndex + 1})`;
        params.push(`%${search}%`, `%${search}%`);
        paramIndex += 2;
      }

      query += `GROUP BY cl.id, cl.name, cl.course_id, cl.semester_id, cl.teacher_id, cl.schedule, cl.room_number, 
      cl.max_students, cl.status, cl.college_id, cl.created_at, c.name, u.first_name, u.last_name ORDER BY 
      cl.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(parseInt(limit), offset);
      //console.error('Class retrieval query:', query);
      //console.error('Class retrieval params:', params);
      const classes = await db.all(query, params);

      res.json({
        message: 'Classes retrieved successfully',
        classes
      });
    } catch (error) {
      console.error('Class retrieval error:', error);
      res.status(500).json({
        error: 'Class retrieval failed',
        message: 'Internal server error while retrieving classes'
      });
    }
  }
);

// ==================== ASSIGNMENTS ====================

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/assignments/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow more file types for mobile submissions
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip|rar|mp4|mov|avi|ppt|pptx|xls|xlsx|csv|rtf|odt|ods|odp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    // Be more lenient with MIME types for mobile apps
    const mimetype = file.mimetype && (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('application/') ||
      file.mimetype.startsWith('text/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype === 'application/octet-stream' // Common fallback for mobile apps
    );

    if (extname || mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed. Please upload a valid document, image, or video file.'));
    }
  }
});

// Create assignment
router.post('/assignments', auth.authenticateToken, auth.authorizeRoles('teacher'), upload.single('document'), async (req, res) => {
  try {
    console.log('Assignment creation request:', {
      body: req.body,
      file: req.file,
      user: req.user.id
    });

    const {
      title,
      description,
      class_id,
      due_date,
      total_marks,
      weightage,
      assignment_type
    } = req.body;

    // Validate required fields
    if (!title || !class_id || !due_date || !total_marks) {
      console.log('Validation failed:', { title, class_id, due_date, total_marks });
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Title, class, due date, and total marks are required'
      });
    }

    // Verify teacher owns this class
    const classExists = await db.get(`
      SELECT c.* FROM classes c 
      WHERE c.id = $1 AND c.teacher_id =$2
    `, [class_id, req.user.id]);

    console.log('Class verification:', { classExists, class_id, teacher_id: req.user.id });

    if (!classExists) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only create assignments for your own classes'
      });
    }

    const assignmentId = uuidv4();
    const documentPath = req.file ? req.file.path : null;

    console.log('Creating assignment with data:', {
      assignmentId,
      class_id,
      title,
      due_date,
      total_marks,
      weightage: weightage || 0,
      assignment_type: assignment_type || 'assignment',
      documentPath,
      created_by: req.user.id
    });

    await db.run(`
      INSERT INTO assignments (
        id, class_id, title, description, due_date, total_marks, 
        weightage, assignment_type, document_path, created_by, 
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    `, [assignmentId, class_id, title, description, due_date, total_marks,
      weightage || 0, assignment_type || 'assignment', documentPath, req.user.id]);

    console.log('Assignment created successfully:', assignmentId);

    // Send push notifications to students in the class
    await pushNotificationService.sendAssignmentNotification(class_id, {
      id: assignmentId,
      title: title,
      due_date: due_date
    });

    res.status(201).json({
      message: 'Assignment created successfully',
      assignment_id: assignmentId
    });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({
      error: 'Failed to create assignment',
      message: 'Internal server error',
      details: error.message
    });
  }
});

// Submit assignment (student endpoint)
router.post('/assignments/:assignmentId/submit',
  auth.authenticateToken,
  auth.authorizeRoles('student'),
  upload.single('file'),
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const { remarks } = req.body;
      const studentId = req.user.id;

      console.log('Submit assignment request:', {
        assignmentId,
        studentId,
        hasFile: !!req.file,
        fileInfo: req.file ? {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size
        } : null,
        remarks
      });

      // Verify assignment exists and student is enrolled in the class
      const assignment = await db.get(`
        SELECT a.*, c.name as class_name
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN class_enrollments ce ON c.id = ce.class_id
        WHERE a.id = $1 AND ce.student_id = $2 AND a.status = 'active'
      `, [assignmentId, studentId]);

      if (!assignment) {
        return res.status(404).json({
          error: 'Assignment not found',
          message: 'Assignment not found or you are not enrolled in this class'
        });
      }

      // Check if assignment is still active (not past due date)
      const dueDate = new Date(assignment.due_date);
      const now = new Date();
      const isLate = now > dueDate;

      // Check if student has already submitted this assignment
      const existingSubmission = await db.get(`
        SELECT id FROM assignment_submissions 
        WHERE assignment_id = $1 AND student_id = $2
      `, [assignmentId, studentId]);

      if (existingSubmission) {
        return res.status(409).json({
          error: 'Already submitted',
          message: 'You have already submitted this assignment'
        });
      }

      // Save file if uploaded
      let documentPath = null;
      if (req.file) {
        documentPath = req.file.path;
      }

      const submissionId = uuidv4();
      const status = isLate ? 'late' : 'submitted';

      // Create submission record
      await db.run(`
        INSERT INTO assignment_submissions (
          id, assignment_id, student_id, submission_date, 
          document_path, remarks, status
        ) VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      `, [submissionId, assignmentId, studentId, documentPath, remarks, status]);

      // Get the created submission
      const submission = await db.get(`
        SELECT sa.*, a.title as assignment_title, a.total_marks
        FROM assignment_submissions sa
        JOIN assignments a ON sa.assignment_id = a.id
        WHERE sa.id = $1
      `, [submissionId]);

      console.log('Assignment submitted successfully:', {
        submissionId,
        assignmentId,
        studentId,
        status,
        isLate,
        hasFile: !!documentPath
      });

      res.status(201).json({
        message: 'Assignment submitted successfully',
        submission,
        isLate
      });
    } catch (error) {
      console.error('Submit assignment error:', error);

      // Handle multer errors specifically
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large',
          message: 'File size exceeds the 10MB limit'
        });
      }

      if (error.message && error.message.includes('File type not allowed')) {
        return res.status(400).json({
          error: 'Invalid file type',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Failed to submit assignment',
        message: 'Internal server error',
        details: error.message
      });
    }
  }
);

// Get assignments for teacher or student
router.get('/assignments', auth.authenticateToken, auth.authorizeRoles('teacher', 'student'), async (req, res) => {
  try {
    if (req.user.role === 'teacher') {
      const { class_id, status } = req.query;
      let whereClause = 'WHERE a.created_by = $1';
      let params = [req.user.id];
      let paramIndex = 2;

      if (class_id) {
        whereClause += ` AND a.class_id = $${paramIndex}`;
        params.push(class_id);
        paramIndex++;
      }

      if (status) {
        whereClause += ` AND a.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      const assignments = await db.all(`
        SELECT a.id, a.title, a.description, a.class_id, a.due_date, a.total_marks, a.weightage, a.assignment_type, a.document_path, a.status, a.created_by, a.created_at, a.updated_at, c.name as class_name,
               COUNT(sa.id) as submission_count
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        LEFT JOIN assignment_submissions sa ON a.id = sa.assignment_id
        ${whereClause}
        GROUP BY a.id, a.title, a.description, a.class_id, a.due_date, a.total_marks, a.weightage, a.assignment_type, a.document_path, a.status, a.created_by, a.created_at, a.updated_at, c.name
        ORDER BY a.created_at DESC
      `, params);

      return res.json({
        assignments,
        total: assignments.length
      });
    } else if (req.user.role === 'student') {
      // Fetch assignments for student's enrolled classes with submission status
      const assignments = await db.all(`
        SELECT 
          a.*, 
          c.name as class_name,
          sa.status as submission_status,
          sa.submission_date,
          sa.marks_obtained,
          sa.feedback
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN class_enrollments ce ON c.id = ce.class_id
        LEFT JOIN assignment_submissions sa ON a.id = sa.assignment_id AND sa.student_id = $1
        WHERE ce.student_id = $2 AND a.status = 'active'
        ORDER BY a.due_date ASC
      `, [req.user.id, req.user.id]);
      return res.json({ assignments, total: assignments.length });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({
      error: 'Failed to fetch assignments',
      message: 'Internal server error'
    });
  }
});

// Get specific assignment
router.get('/assignments/:assignmentId', auth.authenticateToken, auth.authorizeRoles('teacher', 'student'), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (req.user.role === 'teacher') {
      const assignment = await db.get(`
        SELECT a.*, c.name as class_name
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        WHERE a.id = $1 AND a.created_by = $2
      `, [assignmentId, req.user.id]);

      if (!assignment) {
        return res.status(404).json({
          error: 'Assignment not found',
          message: 'Assignment not found or access denied'
        });
      }

      // Get submissions for this assignment
      const submissions = await db.all(`
        SELECT sa.*, u.first_name, u.last_name, u.email
        FROM assignment_submissions sa
        JOIN users u ON sa.student_id = u.id
        WHERE sa.assignment_id = $1
        ORDER BY sa.submission_date DESC
      `, [assignmentId]);

      res.json({
        assignment,
        submissions
      });
    } else if (req.user.role === 'student') {
      // For students, get assignment details and their own submission
      const assignment = await db.get(`
        SELECT a.*, c.name as class_name
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN class_enrollments ce ON c.id = ce.class_id
        WHERE a.id = $1 AND ce.student_id = $2 AND a.status = 'active'
      `, [assignmentId, req.user.id]);

      if (!assignment) {
        return res.status(404).json({
          error: 'Assignment not found',
          message: 'Assignment not found or you are not enrolled in this class'
        });
      }

      // Get student's own submission for this assignment
      const submission = await db.get(`
        SELECT sa.*
        FROM assignment_submissions sa
        WHERE sa.assignment_id = $1 AND sa.student_id = $2
      `, [assignmentId, req.user.id]);

      res.json({
        assignment,
        submission
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).json({
      error: 'Failed to fetch assignment',
      message: 'Internal server error'
    });
  }
});

// Update assignment
router.put('/assignments/:assignmentId', auth.authenticateToken, auth.authorizeRoles('teacher'), upload.single('document'), async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const {
      title,
      description,
      due_date,
      total_marks,
      weightage,
      assignment_type,
      status
    } = req.body;

    // Verify teacher owns this assignment
    const assignment = await db.get(`
      SELECT * FROM assignments WHERE id = $1 AND created_by = $2
    `, [assignmentId, req.user.id]);

    if (!assignment) {
      return res.status(404).json({
        error: 'Assignment not found',
        message: 'Assignment not found or access denied'
      });
    }

    const documentPath = req.file ? req.file.path : assignment.document_path;

    await db.run(`
      UPDATE assignments SET
        title = $1, description = $2, due_date = $3, total_marks = $4,
        weightage = $5, assignment_type = $6, document_path = $7, status = $8,
        updated_at = NOW()
      WHERE id = $9
    `, [title, description, due_date, total_marks, weightage,
      assignment_type, documentPath, status, assignmentId]);

    res.json({
      message: 'Assignment updated successfully'
    });
  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({
      error: 'Failed to update assignment',
      message: 'Internal server error'
    });
  }
});

// Delete assignment
router.delete('/assignments/:assignmentId', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    // Verify teacher owns this assignment
    const assignment = await db.get(`
      SELECT * FROM assignments WHERE id = $1 AND created_by = $2
    `, [assignmentId, req.user.id]);

    if (!assignment) {
      return res.status(404).json({
        error: 'Assignment not found',
        message: 'Assignment not found or access denied'
      });
    }

    await db.run('DELETE FROM assignments WHERE id = $1', [assignmentId]);

    res.json({
      message: 'Assignment deleted successfully'
    });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({
      error: 'Failed to delete assignment',
      message: 'Internal server error'
    });
  }
});

// Grade student assignment
router.put('/assignments/:assignmentId/grade/:studentId', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { marks_obtained, feedback, grade } = req.body;

    // Verify teacher owns this assignment
    const assignment = await db.get(`
      SELECT * FROM assignments WHERE id = $1 AND created_by = $2
    `, [assignmentId, req.user.id]);

    if (!assignment) {
      return res.status(404).json({
        error: 'Assignment not found',
        message: 'Assignment not found or access denied'
      });
    }

    await db.run(`
      UPDATE assignment_submissions SET
        marks_obtained = $1, feedback = $2, grade = $3, graded_at = NOW()
      WHERE assignment_id = $4 AND student_id = $5
    `, [marks_obtained, feedback, grade, assignmentId, studentId]);

    // Send push notification to student about grade
    await pushNotificationService.sendGradeNotification(studentId, {
      assignment_id: assignmentId,
      assignment_title: assignment.title,
      grade: grade,
      total_marks: assignment.total_marks,
      percentage: ((marks_obtained / assignment.total_marks) * 100).toFixed(1)
    });

    res.json({
      message: 'Assignment graded successfully'
    });
  } catch (error) {
    console.error('Grade assignment error:', error);
    res.status(500).json({
      error: 'Failed to grade assignment',
      message: 'Internal server error'
    });
  }
});

// Download assignment document
router.get('/assignments/:assignmentId/document', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await db.get(`
      SELECT document_path FROM assignments WHERE id = $1 AND created_by = $2
    `, [assignmentId, req.user.id]);

    if (!assignment || !assignment.document_path) {
      return res.status(404).json({
        error: 'Document not found',
        message: 'Assignment document not found'
      });
    }

    res.download(assignment.document_path);
  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({
      error: 'Failed to download document',
      message: 'Internal server error'
    });
  }
});

// ==================== ATTENDANCE ====================

// Mark attendance
router.post('/attendance',
  auth.authenticateToken,
  auth.authorizeRoles('teacher', 'college_admin'),
  auth.validateAttendance,
  auth.checkValidationResult,
  async (req, res) => {
    try {
      const {
        class_id,
        student_id,
        date,
        status,
        remarks
      } = req.body;

      const collegeId = req.user.college_id;

      // Verify class belongs to this college
      const classInfo = await db.get(`
        SELECT cl.id FROM classes cl 
        WHERE cl.id = $1 AND cl.college_id = $2
      `, [class_id, collegeId]);

      if (!classInfo) {
        return res.status(404).json({
          error: 'Class not found',
          message: 'The specified class does not exist'
        });
      }

      // Import attendance validation
      const { isAttendanceAllowed } = require('../utils/attendanceValidation');

      // Check if attendance is allowed on this date
      const attendanceCheck = await isAttendanceAllowed(date, collegeId);
      if (!attendanceCheck.allowed) {
        return res.status(400).json({
          error: 'Attendance not allowed',
          message: attendanceCheck.reason
        });
      }

      // Check if attendance already marked for this student on this date
      const existingAttendance = await db.get(
        'SELECT id FROM attendance WHERE class_id = $1 AND student_id = $2 AND date = $3',
        [class_id, student_id, date]
      );

      if (existingAttendance) {
        return res.status(409).json({
          error: 'Attendance already marked',
          message: 'Attendance for this student on this date has already been marked'
        });
      }

      const attendanceId = uuidv4();

      // Mark attendance
      await db.run(`
        INSERT INTO attendance (id, class_id, student_id, date, status, marked_by, remarks)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [attendanceId, class_id, student_id, date, status, req.user.id, remarks]);

      const attendance = await db.get(`
        SELECT a.*, u.first_name, u.last_name as student_name
        FROM attendance a
        JOIN users u ON a.student_id = u.id
        WHERE a.id = $1
      `, [attendanceId]);

      res.status(201).json({
        message: 'Attendance marked successfully',
        attendance
      });
    } catch (error) {
      console.error('Attendance marking error:', error);
      res.status(500).json({
        error: 'Attendance marking failed',
        message: 'Internal server error while marking attendance'
      });
    }
  }
);

// Note: Attendance routes moved to teacher-specific section below

// ==================== RESULTS ====================

// Add result
router.post('/results',
  auth.authenticateToken,
  auth.authorizeRoles('teacher', 'college_admin'),
  auth.validateResult,
  auth.checkValidationResult,
  async (req, res) => {
    try {
      const {
        class_id,
        student_id,
        assignment_id,
        exam_type,
        marks_obtained,
        total_marks,
        grade,
        remarks
      } = req.body;

      const collegeId = req.user.college_id;

      // Verify class belongs to this college
      const classInfo = await db.get(`
        SELECT cl.id FROM classes cl 
        WHERE cl.id = $1 AND cl.college_id = $2
      `, [class_id, collegeId]);

      if (!classInfo) {
        return res.status(404).json({
          error: 'Class not found',
          message: 'The specified class does not exist'
        });
      }

      // Calculate percentage
      const percentage = (marks_obtained / total_marks) * 100;

      const resultId = uuidv4();

      // Add result
      await db.run(`
        INSERT INTO results (id, class_id, student_id, assignment_id, exam_type, 
                           marks_obtained, total_marks, percentage, grade, remarks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [resultId, class_id, student_id, assignment_id, exam_type,
        marks_obtained, total_marks, percentage, grade, remarks]);

      const result = await db.get(`
        SELECT r.*, u.first_name, u.last_name as student_name
        FROM results r
        JOIN users u ON r.student_id = u.id
        WHERE r.id = $1
      `, [resultId]);

      res.status(201).json({
        message: 'Result added successfully',
        result
      });
    } catch (error) {
      console.error('Result creation error:', error);
      res.status(500).json({
        error: 'Result creation failed',
        message: 'Internal server error while adding result'
      });
    }
  }
);

// Get results for class
router.get('/classes/:classId/results',
  auth.authenticateToken,
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { student_id, exam_type } = req.query;
      const collegeId = req.user.college_id;

      // Verify class belongs to this college
      const classInfo = await db.get(`
        SELECT cl.id FROM classes cl 
        WHERE cl.id = $1 AND cl.college_id = $2
      `, [classId, collegeId]);

      if (!classInfo) {
        return res.status(404).json({
          error: 'Class not found',
          message: 'The specified class does not exist'
        });
      }

      let query = `
        SELECT r.*, u.first_name, u.last_name as student_name,
               a.title as assignment_title
        FROM results r
        JOIN users u ON r.student_id = u.id
        LEFT JOIN assignments a ON r.assignment_id = a.id
        WHERE r.class_id = $1
      `;
      const params = [classId];
      let paramIndex = 2;

      if (student_id) {
        query += ` AND r.student_id = ${paramIndex}`;
        params.push(student_id);
        paramIndex++;
      }

      if (exam_type) {
        query += ` AND r.exam_type = ${paramIndex}`;
        params.push(exam_type);
        paramIndex++;
      }

      query += ' ORDER BY r.created_at DESC';

      const results = await db.all(query, params);

      res.json({
        message: 'Results retrieved successfully',
        results
      });
    } catch (error) {
      console.error('Result retrieval error:', error);
      res.status(500).json({
        error: 'Result retrieval failed',
        message: 'Internal server error while retrieving results'
      });
    }
  }
);

// Update result
router.put('/classes/:classId/results/:resultId',
  auth.authenticateToken,
  auth.authorizeRoles('teacher', 'college_admin'),
  async (req, res) => {
    try {
      const { classId, resultId } = req.params;
      const {
        student_id,
        assignment_id,
        exam_type,
        marks_obtained,
        total_marks,
        grade,
        remarks
      } = req.body;
      const collegeId = req.user.college_id;

      // Verify class belongs to this college
      const classInfo = await db.get(`
        SELECT cl.id FROM classes cl 
        WHERE cl.id = $1 AND cl.college_id = $2
      `, [classId, collegeId]);

      if (!classInfo) {
        return res.status(404).json({
          error: 'Class not found',
          message: 'The specified class does not exist'
        });
      }

      // Verify result exists and belongs to this class
      const existingResult = await db.get(`
        SELECT id FROM results WHERE id = $1 AND class_id = $2
      `, [resultId, classId]);

      if (!existingResult) {
        return res.status(404).json({
          error: 'Result not found',
          message: 'The specified result does not exist'
        });
      }

      // Calculate percentage
      const percentage = (marks_obtained / total_marks) * 100;

      // Update result
      await db.run(`
        UPDATE results SET
          student_id = $1, assignment_id = $2, exam_type = $3, 
          marks_obtained = $4, total_marks = $5, percentage = $6, 
          grade = $7, remarks = $8
        WHERE id = $9
      `, [student_id, assignment_id, exam_type, marks_obtained,
        total_marks, percentage, grade, remarks, resultId]);

      const result = await db.get(`
        SELECT r.*, u.first_name, u.last_name as student_name,
               a.title as assignment_title
        FROM results r
        JOIN users u ON r.student_id = u.id
        LEFT JOIN assignments a ON r.assignment_id = a.id
        WHERE r.id = $1
      `, [resultId]);

      res.json({
        message: 'Result updated successfully',
        result
      });
    } catch (error) {
      console.error('Result update error:', error);
      res.status(500).json({
        error: 'Result update failed',
        message: 'Internal server error while updating result'
      });
    }
  }
);

// Delete result
router.delete('/classes/:classId/results/:resultId',
  auth.authenticateToken,
  auth.authorizeRoles('teacher', 'college_admin'),
  async (req, res) => {
    try {
      const { classId, resultId } = req.params;
      const collegeId = req.user.college_id;

      // Verify class belongs to this college
      const classInfo = await db.get(`
        SELECT cl.id FROM classes cl 
        WHERE cl.id = $1 AND cl.college_id = $2
      `, [classId, collegeId]);

      if (!classInfo) {
        return res.status(404).json({
          error: 'Class not found',
          message: 'The specified class does not exist'
        });
      }

      // Verify result exists and belongs to this class
      const existingResult = await db.get(`
        SELECT id FROM results WHERE id = $1 AND class_id = $2
      `, [resultId, classId]);

      if (!existingResult) {
        return res.status(404).json({
          error: 'Result not found',
          message: 'The specified result does not exist'
        });
      }

      // Delete result
      await db.run('DELETE FROM results WHERE id = $1', [resultId]);

      res.json({
        message: 'Result deleted successfully'
      });
    } catch (error) {
      console.error('Result deletion error:', error);
      res.status(500).json({
        error: 'Result deletion failed',
        message: 'Internal server error while deleting result'
      });
    }
  }
);

// ==================== ADMISSIONS ====================

// Get admissions for college
router.get('/admissions',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 10, search = '', status = '' } = req.query;
      const offset = (page - 1) * limit;
      const collegeId = req.user.college_id;

      let query = `
        SELECT a.*, 
               u.first_name, u.last_name, u.email, u.phone,
               c.name as course_name, c.code as course_code,
               ay.name as academic_year_name
        FROM admissions a
        JOIN users u ON a.student_id = u.id
        JOIN courses c ON a.course_id = c.id
        JOIN academic_years ay ON a.academic_year_id = ay.id
        WHERE a.college_id = $1
      `;
      const params = [collegeId];

      if (search) {
        query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR a.application_number LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }

      if (status) {
        query += ' AND a.status = ?';
        params.push(status);
      }

      query += ' ORDER BY a.created_at DESC LIMIT $1 OFFSET $2';
      params.push(parseInt(limit), offset);

      const admissions = await db.all(query, params);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM admissions a
        JOIN users u ON a.student_id = u.id
        WHERE a.college_id = $1
      `;
      const countParams = [collegeId];

      if (search) {
        countQuery += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR a.application_number LIKE ?)';
        const searchTerm = `%${search}%`;
        countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }

      if (status) {
        countQuery += ' AND a.status = ?';
        countParams.push(status);
      }

      const countResult = await db.get(countQuery, countParams);

      res.json({
        message: 'Admissions retrieved successfully',
        admissions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    } catch (error) {
      console.error('Get admissions error:', error);
      res.status(500).json({
        error: 'Get admissions failed',
        message: 'Internal server error while retrieving admissions'
      });
    }
  }
);

// Create admission inquiry
router.post('/admissions',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const {
        course_id,
        student_id,
        academic_year_id,
        application_number,
        admission_date,
        documents_submitted,
        remarks
      } = req.body;

      const collegeId = req.user.college_id;

      // Validate required fields
      if (!course_id || !student_id || !academic_year_id || !application_number || !admission_date) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Course ID, student ID, academic year ID, application number, and admission date are required'
        });
      }

      // Verify course belongs to this college
      const course = await db.get(
        'SELECT id FROM courses WHERE id = $1 AND college_id = $2',
        [course_id, collegeId]
      );
      if (!course) {
        return res.status(404).json({
          error: 'Course not found',
          message: 'The specified course does not exist in this college'
        });
      }

      // Verify student belongs to this college
      const student = await db.get(
        `SELECT id FROM users WHERE id = $1 AND college_id = $2 AND role = 'student'`,
        [student_id, collegeId]
      );
      if (!student) {
        return res.status(404).json({
          error: 'Student not found',
          message: 'The specified student does not exist in this college'
        });
      }

      // Check if application number already exists
      const existingAdmission = await db.get(
        'SELECT id FROM admissions WHERE application_number = $1 AND college_id = $2',
        [application_number, collegeId]
      );
      if (existingAdmission) {
        return res.status(409).json({
          error: 'Application number already exists',
          message: 'An admission with this application number already exists'
        });
      }

      const admissionId = uuidv4();

      // Create admission
      await db.run(`
        INSERT INTO admissions (id, college_id, course_id, student_id, academic_year_id, 
                              application_number, admission_date, documents_submitted, remarks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [admissionId, collegeId, course_id, student_id, academic_year_id,
        application_number, admission_date, documents_submitted, remarks]);

      const admission = await db.get(`
        SELECT a.*, 
               u.first_name, u.last_name, u.email,
               c.name as course_name, c.code as course_code,
               ay.name as academic_year_name
        FROM admissions a
        JOIN users u ON a.student_id = u.id
        JOIN courses c ON a.course_id = c.id
        JOIN academic_years ay ON a.academic_year_id = ay.id
        WHERE a.id = $1
      `, [admissionId]);

      res.status(201).json({
        message: 'Admission created successfully',
        admission
      });
    } catch (error) {
      console.error('Admission creation error:', error);
      res.status(500).json({
        error: 'Admission creation failed',
        message: 'Internal server error while creating admission'
      });
    }
  }
);

// Update admission status
router.put('/admissions/:admissionId/status',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { admissionId } = req.params;
      const { status, remarks } = req.body;
      const collegeId = req.user.college_id;

      // Validate status
      const validStatuses = ['pending', 'approved', 'rejected', 'withdrawn'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Invalid status',
          message: 'Status must be one of: pending, approved, rejected, withdrawn'
        });
      }

      // Verify admission belongs to this college
      const admission = await db.get(
        'SELECT id FROM admissions WHERE id = $1 AND college_id = $2',
        [admissionId, collegeId]
      );
      if (!admission) {
        return res.status(404).json({
          error: 'Admission not found',
          message: 'The specified admission does not exist'
        });
      }

      // Update admission status
      await db.run(`
        UPDATE admissions 
        SET status = $1, remarks = $2
        WHERE id = $3
      `, [status, remarks, admissionId]);

      const updatedAdmission = await db.get(`
        SELECT a.*, 
               u.first_name, u.last_name, u.email,
               c.name as course_name, c.code as course_code,
               ay.name as academic_year_name
        FROM admissions a
        JOIN users u ON a.student_id = u.id
        JOIN courses c ON a.course_id = c.id
        JOIN academic_years ay ON a.academic_year_id = ay.id
        WHERE a.id = $1
      `, [admissionId]);

      res.json({
        message: 'Admission status updated successfully',
        admission: updatedAdmission
      });
    } catch (error) {
      console.error('Admission status update error:', error);
      res.status(500).json({
        error: 'Admission status update failed',
        message: 'Internal server error while updating admission status'
      });
    }
  }
);

// Get specific admission
router.get('/admissions/:admissionId',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { admissionId } = req.params;
      const collegeId = req.user.college_id;

      const admission = await db.get(`
        SELECT a.*, 
               u.first_name, u.last_name, u.email, u.phone,
               c.name as course_name, c.code as course_code,
               ay.name as academic_year_name
        FROM admissions a
        JOIN users u ON a.student_id = u.id
        JOIN courses c ON a.course_id = c.id
        JOIN academic_years ay ON a.academic_year_id = ay.id
        WHERE a.id = $1 AND a.college_id = $2
      `, [admissionId, collegeId]);

      if (!admission) {
        return res.status(404).json({
          error: 'Admission not found',
          message: 'The specified admission does not exist'
        });
      }

      res.json({
        message: 'Admission retrieved successfully',
        admission
      });
    } catch (error) {
      console.error('Get admission error:', error);
      res.status(500).json({
        error: 'Get admission failed',
        message: 'Internal server error while retrieving admission'
      });
    }
  }
);

// ==================== REPORTS & ANALYTICS ====================

// Get attendance report
router.get('/reports/attendance',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'teacher', 'super_admin'),
  async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const collegeId = req.user.college_id;

      // Get overall attendance rate
      const overallStats = await db.get(`
        SELECT 
          COUNT(DISTINCT a.student_id) as total_students,
          COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
          ROUND(
            (COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(*)), 2
          ) as attendance_rate
        FROM attendance a
        JOIN classes c ON a.class_id = c.id
        WHERE c.college_id = $1
      `, [collegeId]);

      // Get top performing courses
      const topCourses = await db.all(`
        SELECT 
          c.name,
          c.code,
          ROUND(
            (COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(*)), 2
          ) as attendance_rate
        FROM attendance a
        JOIN classes cl ON a.class_id = cl.id
        JOIN courses c ON cl.course_id = c.id
        WHERE c.college_id = $1
        GROUP BY c.id, c.name, c.code
        ORDER BY attendance_rate DESC
        LIMIT 5
      `, [collegeId]);

      // Get attendance by course
      const courseStats = await db.all(`
        SELECT 
          c.name,
          c.code,
          COUNT(DISTINCT a.student_id) as total_students,
          ROUND(
            (COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(*)), 2
          ) as attendance_rate
        FROM attendance a
        JOIN classes cl ON a.class_id = cl.id
        JOIN courses c ON cl.course_id = c.id
        WHERE c.college_id = $1
        GROUP BY c.id, c.name, c.code
        ORDER BY attendance_rate DESC
      `, [collegeId]);

      res.json({
        message: 'Attendance report retrieved successfully',
        overallRate: overallStats$1.attendance_rate || 0,
        totalStudents: overallStats?.total_students || 0,
        topCourses,
        courseStats
      });
    } catch (error) {
      console.error('Attendance report error:', error);
      res.status(500).json({
        error: 'Attendance report failed',
        message: 'Internal server error while generating attendance report'
      });
    }
  }
);

// Get performance report
router.get('/reports/performance',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'teacher', 'super_admin'),
  async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const collegeId = req.user.college_id;

      // Get average GPA
      const gpaStats = await db.get(`
        SELECT 
          ROUND(AVG(g.grade_point), 2) as average_gpa,
          COUNT(DISTINCT g.student_id) as total_students
        FROM grades g
        JOIN classes c ON g.class_id = c.id
        WHERE c.college_id = $1
      `, [collegeId]);

      // Get grade distribution
      const gradeDistribution = await db.all(`
        SELECT 
          CASE 
            WHEN g.grade_point >= 3.7 THEN 'A'
            WHEN g.grade_point >= 3.0 THEN 'B'
            WHEN g.grade_point >= 2.0 THEN 'C'
            ELSE 'D'
          END as grade,
          COUNT(*) as count
        FROM grades g
        JOIN classes c ON g.class_id = c.id
        WHERE c.college_id = $1
        GROUP BY grade
        ORDER BY grade
      `, [collegeId]);

      // Get top performing students
      const topStudents = await db.all(`
        SELECT 
          u.first_name,
          u.last_name,
          c.name as course_name,
          ROUND(AVG(g.grade_point), 2) as gpa
        FROM grades g
        JOIN classes cl ON g.class_id = cl.id
        JOIN courses c ON cl.course_id = c.id
        JOIN users u ON g.student_id = u.id
        WHERE cl.college_id = $1
        GROUP BY g.student_id, u.first_name, u.last_name, c.name
        ORDER BY gpa DESC
        LIMIT 10
      `, [collegeId]);

      res.json({
        message: 'Performance report retrieved successfully',
        averageGPA: gpaStats?.average_gpa || 0,
        totalStudents: gpaStats?.total_students || 0,
        gradeDistribution: gradeDistribution.reduce((acc, item) => {
          acc[item.grade] = item.count;
          return acc;
        }, {}),
        topStudents
      });
    } catch (error) {
      console.error('Performance report error:', error);
      res.status(500).json({
        error: 'Performance report failed',
        message: 'Internal server error while generating performance report'
      });
    }
  }
);

// Get enrollment report
router.get('/reports/enrollment',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const collegeId = req.user.college_id;

      // Get total enrollment
      const enrollmentStats = await db.get(`
        SELECT COUNT(*) as total_enrollment
        FROM users 
        WHERE college_id = $1 AND role = 'student'
      `, [collegeId]);

      // Get new admissions this period
      const newAdmissions = await db.get(`
        SELECT COUNT(*) as new_admissions
        FROM admissions 
        WHERE college_id = $1 AND status = 'approved'
        AND admission_date >= NOW() - INTERVAL '1 month'
      `, [collegeId]);

      // Get enrollment by course
      const courseEnrollment = await db.all(`
        SELECT 
          c.name,
          c.code,
          COUNT(DISTINCT u.id) as enrolled_students,
          c.max_students as capacity
        FROM users u
        JOIN student_courses sc ON u.id = sc.student_id
        JOIN courses c ON sc.course_id = c.id
        WHERE u.college_id = $1 AND u.role = 'student'
        GROUP BY c.id, c.name, c.code, c.max_students
        ORDER BY enrolled_students DESC
      `, [collegeId]);

      res.json({
        message: 'Enrollment report retrieved successfully',
        totalEnrollment: enrollmentStats?.total_enrollment || 0,
        newAdmissions: newAdmissions?.new_admissions || 0,
        courseEnrollment
      });
    } catch (error) {
      console.error('Enrollment report error:', error);
      res.status(500).json({
        error: 'Enrollment report failed',
        message: 'Internal server error while generating enrollment report'
      });
    }
  }
);

// Get financial report
router.get('/reports/financial',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const collegeId = req.user.college_id;

      // Get total revenue
      const revenueStats = await db.get(`
        SELECT 
          SUM(amount_paid) as total_revenue,
          COUNT(*) as total_transactions
        FROM fee_collections 
        WHERE college_id = $1 AND status = 'paid'
        AND payment_date >= NOW() - INTERVAL '1 month'
      `, [collegeId]);

      // Get outstanding fees
      const outstandingFees = await db.get(`
        SELECT 
          SUM(amount_paid) as outstanding_amount,
          COUNT(*) as outstanding_count
        FROM fee_collections 
        WHERE college_id = $1 AND status = 'pending'
      `, [collegeId]);

      // Get fee collection summary
      const feeSummary = await db.all(`
        SELECT 
          fs.fee_type as fee_type,
          SUM(fc.amount_paid) as total_amount,
          SUM(CASE WHEN fc.status = 'paid' THEN fc.amount_paid ELSE 0 END) as collected_amount,
          SUM(CASE WHEN fc.status = 'pending' THEN fc.amount_paid ELSE 0 END) as pending_amount
        FROM fee_collections fc
        JOIN fee_structures fs ON fc.fee_structure_id = fs.id
        WHERE fc.college_id = $1
        GROUP BY fs.fee_type
        ORDER BY total_amount DESC
      `, [collegeId]);

      res.json({
        message: 'Financial report retrieved successfully',
        totalRevenue: revenueStats?.total_revenue || 0,
        totalTransactions: revenueStats?.total_transactions || 0,
        outstandingFees: outstandingFees?.outstanding_amount || 0,
        outstandingCount: outstandingFees?.outstanding_count || 0,
        feeSummary
      });
    } catch (error) {
      console.error('Financial report error:', error);
      res.status(500).json({
        error: 'Financial report failed',
        message: 'Internal server error while generating financial report'
      });
    }
  }
);

// Get graduation report
router.get('/reports/graduation',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { period = 'year' } = req.query;
      const collegeId = req.user.college_id;

      // Get graduation rate
      const graduationStats = await db.get(`
        SELECT 
          COUNT(*) as total_graduates,
          ROUND(
            (COUNT(*) * 100.0 / (SELECT COUNT(*) FROM users WHERE college_id = $1 AND role = 'student')), 2
          ) as graduation_rate
        FROM users 
        WHERE college_id = $2 AND role = 'student' AND graduation_date IS NOT NULL
      `, [collegeId, collegeId]);

      // Get graduates this year
      const graduatesThisYear = await db.get(`
        SELECT COUNT(*) as graduates_this_year
        FROM users 
        WHERE college_id = $1 AND role = 'student' 
        AND graduation_date >= DATE_TRUNC('year', NOW())
      `, [collegeId]);

      // Get graduation by course
      const courseGraduation = await db.all(`
        SELECT 
          c.name as course_name,
          c.code as course_code,
          COUNT(u.id) as graduates,
          ROUND(
            (COUNT(u.id) * 100.0 / (SELECT COUNT(*) FROM users WHERE college_id = $1 AND role = 'student')), 2
          ) as graduation_rate
        FROM users u
        JOIN student_courses sc ON u.id = sc.student_id
        JOIN courses c ON sc.course_id = c.id
        WHERE u.college_id = $2 AND u.role = 'student' AND u.graduation_date IS NOT NULL
        GROUP BY c.id, c.name, c.code
        ORDER BY graduates DESC
      `, [collegeId, collegeId]);

      res.json({
        message: 'Graduation report retrieved successfully',
        graduationRate: graduationStats?.graduation_rate || 0,
        totalGraduates: graduationStats?.total_graduates || 0,
        graduatesThisYear: graduatesThisYear?.graduates_this_year || 0,
        courseGraduation
      });
    } catch (error) {
      console.error('Graduation report error:', error);
      res.status(500).json({
        error: 'Graduation report failed',
        message: 'Internal server error while generating graduation report'
      });
    }
  }
);

// Get analytics dashboard
router.get('/analytics',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const collegeId = req.user.college_id;

      // Get overall statistics
      const stats = await db.get(`
        SELECT 
          (SELECT COUNT(*) FROM users WHERE college_id = $1 AND role = 'student') as total_students,
          (SELECT COUNT(*) FROM users WHERE college_id = $2 AND role = 'teacher') as total_teachers,
          (SELECT COUNT(*) FROM courses WHERE college_id = $3) as total_courses,
          (SELECT COUNT(*) FROM classes WHERE college_id = $4) as total_classes
      `, [collegeId, collegeId, collegeId, collegeId]);

      res.json({
        message: 'Analytics retrieved successfully',
        stats
      });
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({
        error: 'Analytics failed',
        message: 'Internal server error while retrieving analytics'
      });
    }
  }
);

// ==================== ATTENDANCE MANAGEMENT ====================

// Get classes for teacher (for attendance)
router.get('/classes', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const classes = await db.all(`
      SELECT c.*, co.name as course_name
      FROM classes c
      JOIN courses co ON c.course_id = co.id
      WHERE c.teacher_id = $1
      ORDER BY c.name
    `, [req.user.id]);

    res.json({
      classes,
      total: classes.length
    });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({
      error: 'Failed to fetch classes',
      message: 'Internal server error'
    });
  }
});

// Get students for a specific class (teacher: all students, student: only self if enrolled)
router.get('/classes/:classId/students', auth.authenticateToken, auth.authorizeRoles('teacher', 'student'), async (req, res) => {
  try {
    const { classId } = req.params;
    if (req.user.role === 'teacher') {
      // Verify teacher owns this class
      const classExists = await db.get(`
        SELECT * FROM classes WHERE id = $1 AND teacher_id = $2
      `, [classId, req.user.id]);
      if (!classExists) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access students from your own classes'
        });
      }
      const students = await db.all(`
        SELECT u.id, u.first_name, u.last_name, u.email, u.profile_image,
               ce.enrollment_date, ce.status as enrollment_status
        FROM class_enrollments ce
        JOIN users u ON ce.student_id = u.id
        WHERE ce.class_id = $1 AND ce.status = 'enrolled'
        ORDER BY u.first_name, u.last_name
      `, [classId]);
      return res.json({ students, total: students.length });
    } else if (req.user.role === 'student') {
      // Only allow student to access their own record if enrolled
      const studentId = req.user.id;
      const record = await db.get(`
        SELECT u.id, u.first_name, u.last_name, u.email, u.profile_image,
               ce.enrollment_date, ce.status as enrollment_status
        FROM class_enrollments ce
        JOIN users u ON ce.student_id = u.id
        WHERE ce.class_id = $1 AND ce.student_id = $2 AND ce.status = 'enrolled'
      `, [classId, studentId]);
      if (!record) {
        return res.status(403).json({ error: 'Access denied', message: 'You are not enrolled in this class' });
      }
      return res.json({ students: [record], total: 1 });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      error: 'Failed to fetch students',
      message: 'Internal server error'
    });
  }
});

// Get attendance for a class on a specific date or for a student
router.get('/classes/:classId/attendance', auth.authenticateToken, auth.authorizeRoles('teacher', 'student'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { date, student_id } = req.query;

    if (req.user.role === 'teacher') {
      // Verify teacher owns this class
      const classExists = await db.get(`
        SELECT * FROM classes WHERE id = $1 AND teacher_id = $2
      `, [classId, req.user.id]);

      if (!classExists) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access attendance for your own classes'
        });
      }

      const attendanceDate = date || new Date().toISOString().split('T')[0];

      // Get all enrolled students
      const students = await db.all(`
        SELECT u.id, u.first_name, u.last_name, u.email, u.profile_image
        FROM class_enrollments ce
        JOIN users u ON ce.student_id = u.id
        WHERE ce.class_id = $1 AND ce.status = 'enrolled'
        ORDER BY u.first_name, u.last_name
      `, [classId]);

      // Get existing attendance for the date
      const existingAttendance = await db.all(`
        SELECT student_id, status, remarks
        FROM attendance
        WHERE class_id = $1 AND date = $2
      `, [classId, attendanceDate]);

      // Create attendance map
      const attendanceMap = {};
      existingAttendance.forEach(att => {
        attendanceMap[att.student_id] = {
          status: att.status,
          remarks: att.remarks
        };
      });

      // Combine students with their attendance status
      const attendanceData = students.map(student => ({
        ...student,
        attendance: attendanceMap[student.id] || {
          status: 'present',
          remarks: ''
        }
      }));

      return res.json({
        class_id: classId,
        date: attendanceDate,
        students: attendanceData,
        total: students.length
      });
    } else if (req.user.role === 'student') {
      // Only allow student to access their own attendance
      const studentId = req.user.id;
      // Verify student is enrolled in this class
      const enrolled = await db.get(`
        SELECT * FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'enrolled'
      `, [classId, studentId]);
      if (!enrolled) {
        return res.status(403).json({ error: 'Access denied', message: 'You are not enrolled in this class' });
      }
      // Get all attendance records for this student in this class
      const records = await db.all(`
        SELECT date, status, remarks
        FROM attendance
        WHERE class_id = $1 AND student_id = $2
        ORDER BY date DESC
      `, [classId, studentId]);
      // Calculate summary
      const summary = { present: 0, absent: 0, late: 0, excused: 0 };
      records.forEach(r => {
        if (summary[r.status] !== undefined) summary[r.status]++;
      });
      return res.json({
        class_id: classId,
        student_id: studentId,
        summary,
        records
      });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({
      error: 'Failed to fetch attendance',
      message: 'Internal server error'
    });
  }
});

// Mark attendance for a class
router.post('/classes/:classId/attendance', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { date, attendance_data } = req.body;

    // Verify teacher owns this class
    const classExists = await db.get(`
      SELECT cl.*, cl.college_id FROM classes cl WHERE cl.id = $1 AND cl.teacher_id = $2
    `, [classId, req.user.id]);

    if (!classExists) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only mark attendance for your own classes'
      });
    }

    // Validate required fields
    if (!date || !attendance_data || !Array.isArray(attendance_data)) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Date and attendance data are required'
      });
    }

    // Import attendance validation
    const { isAttendanceAllowed } = require('../utils/attendanceValidation');

    // Check if attendance is allowed on this date
    const attendanceCheck = await isAttendanceAllowed(date, classExists.college_id);
    if (!attendanceCheck.allowed) {
      return res.status(400).json({
        error: 'Attendance not allowed',
        message: attendanceCheck.reason
      });
    }

    // Begin transaction
    await db.run('BEGIN TRANSACTION');

    try {
      // Delete existing attendance for this date
      await db.run(`
        DELETE FROM attendance 
        WHERE class_id = $1 AND date = $2
      `, [classId, date]);

      // Insert new attendance records
      for (const record of attendance_data) {
        if (record.student_id && record.status) {
          await db.run(`
            INSERT INTO attendance (
              id, class_id, student_id, date, status, remarks, marked_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          `, [
            uuidv4(),
            classId,
            record.student_id,
            date,
            record.status,
            record.remarks || '',
            req.user.id
          ]);
        }
      }

      await db.run('COMMIT');

      res.json({
        message: 'Attendance marked successfully',
        date: date,
        records_updated: attendance_data.length
      });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      error: 'Failed to mark attendance',
      message: 'Internal server error'
    });
  }
});

// Get attendance report for a class
router.get('/classes/:classId/attendance/report', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { start_date, end_date } = req.query;

    // Verify teacher owns this class
    const classExists = await db.get(`
      SELECT * FROM classes WHERE id = $1 AND teacher_id = $2
    `, [classId, req.user.id]);

    if (!classExists) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only access attendance reports for your own classes'
      });
    }

    const startDate = start_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const endDate = end_date || new Date().toISOString().split('T')[0];

    // Get attendance summary
    const attendanceSummary = await db.all(`
      SELECT 
        u.id as student_id,
        u.first_name,
        u.last_name,
        u.email,
        COUNT(a.id) as total_days,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present_days,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as late_days,
        SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) as excused_days,
        ROUND(
          (SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) * 100.0) / 
          COUNT(a.id), 2
        ) as attendance_percentage
      FROM class_enrollments ce
      JOIN users u ON ce.student_id = u.id
      LEFT JOIN attendance a ON u.id = a.student_id 
        AND a.class_id = $1 
        AND a.date BETWEEN $2 AND $3
      WHERE ce.class_id = $4 AND ce.status = 'enrolled'
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY u.first_name, u.last_name
    `, [classId, startDate, endDate, classId]);

    // Get class details
    const classDetails = await db.get(`
      SELECT c.*, co.name as course_name
      FROM classes c
      JOIN courses co ON c.course_id = co.id
      WHERE c.id = $1
    `, [classId]);

    res.json({
      class: classDetails,
      report_period: {
        start_date: startDate,
        end_date: endDate
      },
      summary: attendanceSummary,
      total_students: attendanceSummary.length
    });
  } catch (error) {
    console.error('Get attendance report error:', error);
    res.status(500).json({
      error: 'Failed to fetch attendance report',
      message: 'Internal server error'
    });
  }
});

// Get attendance calendar for a class
router.get('/classes/:classId/attendance/calendar', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { month, year } = req.query;

    // Verify teacher owns this class
    const classExists = await db.get(`
      SELECT cl.*, cl.college_id FROM classes cl WHERE cl.id = $1 AND cl.teacher_id = $2
    `, [classId, req.user.id]);

    if (!classExists) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only access attendance calendar for your own classes'
      });
    }

    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    // Import attendance validation utilities
    const { getAttendanceCalendarWithHolidays } = require('../utils/attendanceValidation');

    // Get attendance calendar with holidays
    const calendarData = await getAttendanceCalendarWithHolidays(classId, currentMonth, currentYear);

    res.json(calendarData);
  } catch (error) {
    console.error('Get attendance calendar error:', error);
    res.status(500).json({
      error: 'Failed to fetch attendance calendar',
      message: 'Internal server error'
    });
  }
});

// Get holidays for a college
router.get('/holidays', auth.authenticateToken, auth.authorizeRoles('teacher', 'college_admin'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const collegeId = req.user.college_id;

    // Import attendance validation utilities
    const { getHolidays } = require('../utils/attendanceValidation');

    const holidays = await getHolidays(collegeId, start_date, end_date);

    res.json({
      holidays: holidays,
      total: holidays.length
    });
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({
      error: 'Failed to fetch holidays',
      message: 'Internal server error'
    });
  }
});

// ==================== ACADEMIC YEARS ====================

// Create academic year
router.post('/academic-years', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { name, start_date, end_date, status } = req.body;
    const collegeId = req.user.college_id;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required fields', message: 'Name, start_date, and end_date are required' });
    }
    const id = uuidv4();
    await db.run(`INSERT INTO academic_years (id, college_id, name, start_date, end_date, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`, [id, collegeId, name, start_date, end_date, status || 'active']);
    const year = await db.get('SELECT * FROM academic_years WHERE id = ?', [id]);
    res.status(201).json({ message: 'Academic year created', year });
  } catch (error) {
    console.error('Create academic year error:', error);
    res.status(500).json({ error: 'Failed to create academic year', message: 'Internal server error' });
  }
});

// Get academic years for college
router.get('/academic-years', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const years = await db.all('SELECT * FROM academic_years WHERE college_id = $1 ORDER BY start_date DESC', [collegeId]);
    res.json({ years });
  } catch (error) {
    console.error('Get academic years error:', error);
    res.status(500).json({ error: 'Failed to fetch academic years', message: 'Internal server error' });
  }
});

// Update academic year
router.put('/academic-years/:id', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, status } = req.body;
    const collegeId = req.user.college_id;
    await db.run('UPDATE academic_years SET name = $1, start_date = $2, end_date = $3, status = $4 WHERE id = $5 AND college_id = $6', [name, start_date, end_date, status, id, collegeId]);
    const year = await db.get('SELECT * FROM academic_years WHERE id = $1', [id]);
    res.json({ message: 'Academic year updated', year });
  } catch (error) {
    console.error('Update academic year error:', error);
    res.status(500).json({ error: 'Failed to update academic year', message: 'Internal server error' });
  }
});

// Delete academic year
router.delete('/academic-years/:id', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const collegeId = req.user.college_id;
    await db.run('DELETE FROM academic_years WHERE id = $1 AND college_id = $2', [id, collegeId]);
    res.json({ message: 'Academic year deleted' });
  } catch (error) {
    console.error('Delete academic year error:', error);
    res.status(500).json({ error: 'Failed to delete academic year', message: 'Internal server error' });
  }
});

// ==================== SEMESTERS ====================

// Create semester
router.post('/semesters', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { academic_year_id, name, start_date, end_date, status } = req.body;
    const collegeId = req.user.college_id;
    if (!academic_year_id || !name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required fields', message: 'Academic year, name, start_date, and end_date are required' });
    }
    // Verify academic year belongs to this college
    const year = await db.get('SELECT id FROM academic_years WHERE id = $1 AND college_id = $2', [academic_year_id, collegeId]);
    if (!year) {
      return res.status(404).json({ error: 'Academic year not found', message: 'Academic year does not exist in this college' });
    }
    const id = uuidv4();
    await db.run(`INSERT INTO semesters (id, academic_year_id, name, start_date, end_date, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`, [id, academic_year_id, name, start_date, end_date, status || 'active']);
    const semester = await db.get('SELECT * FROM semesters WHERE id = $1', [id]);
    res.status(201).json({ message: 'Semester created', semester });
  } catch (error) {
    console.error('Create semester error:', error);
    res.status(500).json({ error: 'Failed to create semester', message: 'Internal server error' });
  }
});

// Get semesters for college
router.get('/semesters', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const semesters = await db.all(`SELECT s.* FROM semesters s JOIN academic_years ay ON s.academic_year_id = ay.id WHERE ay.college_id = $1 ORDER BY s.start_date DESC`, [collegeId]);
    res.json({ semesters });
  } catch (error) {
    console.error('Get semesters error:', error);
    res.status(500).json({ error: 'Failed to fetch semesters', message: 'Internal server error' });
  }
});

// Update semester
router.put('/semesters/:id', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, status } = req.body;
    // Only allow update if semester belongs to college
    const semester = await db.get('SELECT s.* FROM semesters s JOIN academic_years ay ON s.academic_year_id = ay.id WHERE s.id = $1 AND ay.college_id = $2', [id, req.user.college_id]);
    if (!semester) return res.status(404).json({ error: 'Semester not found', message: 'Semester does not exist in this college' });
    await db.run('UPDATE semesters SET name = $1, start_date = $2, end_date = $3, status = $4 WHERE id = $5', [name, start_date, end_date, status, id]);
    const updated = await db.get('SELECT * FROM semesters WHERE id = $1', [id]);
    res.json({ message: 'Semester updated', semester: updated });
  } catch (error) {
    console.error('Update semester error:', error);
    res.status(500).json({ error: 'Failed to update semester', message: 'Internal server error' });
  }
});

// Delete semester
router.delete('/semesters/:id', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    // Only allow delete if semester belongs to college
    const semester = await db.get('SELECT s.* FROM semesters s JOIN academic_years ay ON s.academic_year_id = ay.id WHERE s.id = $1 AND ay.college_id = $2', [id, req.user.college_id]);
    if (!semester) return res.status(404).json({ error: 'Semester not found', message: 'Semester does not exist in this college' });
    await db.run('DELETE FROM semesters WHERE id = $1', [id]);
    res.json({ message: 'Semester deleted' });
  } catch (error) {
    console.error('Delete semester error:', error);
    res.status(500).json({ error: 'Failed to delete semester', message: 'Internal server error' });
  }
});

// ==================== CLASS ENROLLMENTS ====================

// Enroll students in class (bulk)
router.post('/classes/:classId/enroll-students', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { student_ids } = req.body; // array of student IDs
    const collegeId = req.user.college_id;
    // Verify class belongs to this college
    const classInfo = await db.get('SELECT * FROM classes WHERE id = $1 AND college_id = $2', [classId, collegeId]);
    if (!classInfo) return res.status(404).json({ error: 'Class not found', message: 'Class does not exist in this college' });
    if (!Array.isArray(student_ids) || student_ids.length === 0) return res.status(400).json({ error: 'No students provided', message: 'student_ids must be a non-empty array' });
    let enrolled = 0;
    for (const student_id of student_ids) {
      // Verify student belongs to this college
      const student = await db.get(`SELECT id FROM users WHERE id = $1 AND college_id = $2 AND role = 'student'`, [student_id, collegeId]);
      if (student) {
        await db.run(`INSERT INTO class_enrollments (id, class_id, student_id, enrollment_date, status, created_at) VALUES ($1, $2, $3, NOW(), 'enrolled', NOW()) ON CONFLICT (class_id, student_id) DO NOTHING`, [uuidv4(), classId, student_id]);
        enrolled++;
      }
    }
    res.json({ message: `Enrolled ${enrolled} students to class` });
  } catch (error) {
    console.error('Enroll students error:', error);
    res.status(500).json({ error: 'Failed to enroll students', message: 'Internal server error' });
  }
});

// Remove student from class
router.delete('/classes/:classId/students/:studentId', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    const collegeId = req.user.college_id;
    // Verify class belongs to this college
    const classInfo = await db.get('SELECT * FROM classes WHERE id = $1 AND college_id = $2', [classId, collegeId]);
    if (!classInfo) return res.status(404).json({ error: 'Class not found', message: 'Class does not exist in this college' });
    await db.run('DELETE FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
    res.json({ message: 'Student removed from class' });
  } catch (error) {
    console.error('Remove student error:', error);
    res.status(500).json({ error: 'Failed to remove student', message: 'Internal server error' });
  }
});

// List students in class
router.get('/classes/:classId/students', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const { classId } = req.params;
    const collegeId = req.user.college_id;
    // Verify class belongs to this college
    const classInfo = await db.get('SELECT * FROM classes WHERE id = $1 AND college_id = $2', [classId, collegeId]);
    if (!classInfo) return res.status(404).json({ error: 'Class not found', message: 'Class does not exist in this college' });
    const students = await db.all(`SELECT u.id, u.first_name, u.last_name, u.email, u.profile_image FROM class_enrollments ce JOIN users u ON ce.student_id = u.id WHERE ce.class_id = $1 AND ce.status = 'enrolled'`, [classId]);
    res.json({ students });
  } catch (error) {
    console.error('List students error:', error);
    res.status(500).json({ error: 'Failed to list students', message: 'Internal server error' });
  }
});

// ==================== TEACHERS & STUDENTS LIST ====================

// List teachers in college
router.get('/teachers', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const teachers = await db.all(`SELECT id, first_name, last_name, email, profile_image FROM users WHERE college_id = $1 AND role = 'teacher'`, [collegeId]);
    res.json({ teachers });
  } catch (error) {
    console.error('List teachers error:', error);
    res.status(500).json({ error: 'Failed to list teachers', message: 'Internal server error' });
  }
});

// List students in college
router.get('/students', auth.authenticateToken, auth.authorizeRoles('college_admin'), async (req, res) => {
  try {
    const collegeId = req.user.college_id;
    const students = await db.all(`SELECT id, first_name, last_name, email, profile_image FROM users WHERE college_id = $1 AND role = 'student'`, [collegeId]);
    res.json({ students });
  } catch (error) {
    console.error('List students error:', error);
    res.status(500).json({ error: 'Failed to list students', message: 'Internal server error' });
  }
});

// Get attendance overview for teacher
router.get('/attendance/overview', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;

    const attendanceData = await db.all(`
   SELECT 
        u.id,
                u.first_name || ' ' || u.last_name as student_name,
                cl.name as class_name,
                COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present_count,
                COUNT(a.id) as total_classes,
                CASE 
                  WHEN COUNT(a.id) > 0 THEN 
                    ROUND((COUNT(CASE WHEN a.status = 'present' THEN 1 END) * 100.0 / COUNT(a.id)), 2)
                      ELSE 0
                      END as attendance_percentage,
                       MAX(a.date) as last_attendance
                        FROM users u
                        JOIN class_enrollments ce ON u.id = ce.student_id
                        JOIN classes cl ON ce.class_id = cl.id
                        LEFT JOIN attendance a ON u.id = a.student_id AND a.class_id = cl.id
                        WHERE cl.teacher_id = $1 AND u.role = 'student' AND ce.status = 'enrolled'
                  GROUP BY u.id, u.first_name, u.last_name, cl.name
          ORDER BY attendance_percentage ASC
    `, [teacherId]);

    res.json({
      success: true,
      attendance: attendanceData || []
    });
  } catch (error) {
    console.error('Attendance overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load attendance overview'
    });
  }
});

// Get pending grading assignments for teacher
router.get('/assignments/pending-grading', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;
    console.error('Pending grading teacherId:', teacherId);
    // Get pending grading assignments
    const pendingAssignments = await db.all(`
      SELECT 
        s.id,
        u.first_name || ' ' || u.last_name as student_name,
        a.title as assignment_title,
        c.name as class_name,
        s.submission_date,
        s.status,
        s.marks_obtained,
        s.feedback
      FROM assignment_submissions s
      JOIN users u ON s.student_id = u.id
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes cl ON a.class_id = cl.id
      JOIN courses c ON cl.course_id = c.id
      WHERE cl.teacher_id = $1 AND s.status = 'submitted'
      ORDER BY s.submission_date DESC
    `, [teacherId]);
    console.error('Pending grading pendingAssignments:', pendingAssignments);
    res.json({
      success: true,
      assignments: pendingAssignments || []
    });
  } catch (error) {
    console.error('Pending grading error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load pending grading assignments'
    });
  }
});

// Grade assignment submission
router.post('/submissions/:id/grade', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const { grade_percentage, feedback, status } = req.body;
    const teacherId = req.user.id;

    // Verify teacher owns this assignment
    const submission = await db.get(`
      SELECT s.*, a.title, cl.teacher_id
      FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes cl ON a.class_id = cl.id
      WHERE s.id = $1 AND cl.teacher_id = $2
    `, [id, teacherId]);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found or access denied'
      });
    }

    // Update submission
    await db.run(`
      UPDATE assignment_submissions 
      SET grade_percentage = $1, feedback = $2, status = $3, graded_at = NOW()
      WHERE id = $4
    `, [grade_percentage, feedback, status, id]);

    // Create grade record
    await db.run(`
      INSERT INTO grades (assignment_id, student_id, grade_percentage, feedback, graded_by, status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [submission.assignment_id, submission.student_id, grade_percentage, feedback, teacherId, 'active']);

    res.json({
      success: true,
      message: 'Assignment graded successfully'
    });
  } catch (error) {
    console.error('Grade submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to grade assignment'
    });
  }
});

// ==================== PUBLIC ADMISSION INQUIRIES ====================

const createAdmissionInquiriesTable = async () => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS admission_inquiries (
      id TEXT PRIMARY KEY,
      college_id TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
};
createAdmissionInquiriesTable();

// Get admission inquiries for college admin
router.get('/admission-inquiries',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 10, search = '' } = req.query;
      const offset = (page - 1) * limit;
      const collegeId = req.user.college_id;

      let query = `
        SELECT * FROM admission_inquiries 
        WHERE college_id = $1
      `;
      const params = [collegeId];

      if (search) {
        query += ' AND (name LIKE $1 OR email LIKE $2 OR phone LIKE $3 OR message LIKE $4)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }

      query += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2';
      params.push(parseInt(limit), offset);

      const inquiries = await db.all(query, params);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM admission_inquiries 
        WHERE college_id = $1
      `;
      const countParams = [collegeId];

      if (search) {
        countQuery += ' AND (name LIKE $1 OR email LIKE $2 OR phone LIKE $3 OR message LIKE $4)';
        const searchTerm = `%${search}%`;
        countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }

      const countResult = await db.get(countQuery, countParams);
      const total = countResult.total;

      res.json({
        inquiries,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get admission inquiries error:', error);
      res.status(500).json({
        error: 'Failed to load admission inquiries',
        message: error.message
      });
    }
  }
);

// Get specific admission inquiry details
router.get('/admission-inquiries/:id',
  auth.authenticateToken,
  auth.authorizeRoles('college_admin', 'super_admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const collegeId = req.user.college_id;

      const inquiry = await db.get(`
        SELECT * FROM admission_inquiries 
        WHERE id = $1 AND college_id = $2
      `, [id, collegeId]);

      if (!inquiry) {
        return res.status(404).json({
          error: 'Inquiry not found',
          message: 'The specified inquiry does not exist'
        });
      }

      res.json({ inquiry });
    } catch (error) {
      console.error('Get admission inquiry details error:', error);
      res.status(500).json({
        error: 'Failed to load inquiry details',
        message: error.message
      });
    }
  }
);

// Public endpoint to submit an admission inquiry
router.post('/admission-inquiries', async (req, res) => {
  try {
    const { college_id, name, email, phone, message } = req.body;
    if (!college_id || !name || !email || !phone || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = uuidv4();
    await db.run(
      `INSERT INTO admission_inquiries (id, college_id, name, email, phone, message) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, college_id, name, email, phone, message]
    );
    res.status(201).json({ message: 'Inquiry submitted successfully' });
  } catch (error) {
    console.error('Admission inquiry error:', error);
    res.status(500).json({ error: 'Failed to submit inquiry' });
  }
});

module.exports = router;