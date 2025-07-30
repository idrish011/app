const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AuthMiddleware = require('../middleware/auth');
const Database = require('../models/database');

const router = express.Router();
const auth = new AuthMiddleware();
const db = new Database();

// Use the proper authentication middleware from AuthMiddleware class

// Get dashboard statistics based on user role
router.get('/stats', auth.authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    let stats = {};
    console.log('College admin user:', user);
    switch (user.role) {
      case 'super_admin':
        stats = await getSuperAdminStats();
        break;
      case 'college_admin':
        stats = await getCollegeAdminStats(user.college_id);
        break;
      case 'teacher':
        stats = await getTeacherStats(user.id, user.college_id);
        break;
      case 'student':
        stats = await getStudentStats(user.id, user.college_id);
        break;
      case 'parent':
        stats = await getParentStats(user.id, user.college_id);
        break;
      default:
        return res.status(400).json({ error: 'Invalid user role' });
    }

    res.json({ stats });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// Get courses for different roles
router.get('/courses', auth.authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    let courses = [];

    switch (user.role) {
      case 'super_admin':
        courses = await db.all(`
          SELECT c.*, co.name as college_name, u.first_name, u.last_name
          FROM courses c
          JOIN colleges co ON c.college_id = co.id
          LEFT JOIN users u ON c.college_id = u.college_id AND u.role = 'college_admin'
          WHERE c.status = 'active'
          ORDER BY c.created_at DESC
        `);
        break;
      case 'college_admin':
        courses = await db.all(`
          SELECT c.*, u.first_name, u.last_name
          FROM courses c
          LEFT JOIN users u ON c.college_id = u.college_id AND u.role = 'college_admin'
          WHERE c.college_id = $1 AND c.status = 'active'
          ORDER BY c.created_at DESC
        `, [user.college_id]);
        break;
      case 'teacher':
        courses = await db.all(`
          SELECT c.*
          FROM courses c
          JOIN classes cl ON c.id = cl.course_id
          WHERE cl.teacher_id = $1 AND c.status = 'active'
          GROUP BY c.id
          ORDER BY c.created_at DESC
        `, [user.id]);
        break;
      case 'student':
        courses = await db.all(`
          SELECT c.*, cl.name as class_name, u.first_name, u.last_name
          FROM courses c
          JOIN classes cl ON c.id = cl.course_id
          JOIN class_enrollments ce ON cl.id = ce.class_id
          JOIN users u ON cl.teacher_id = u.id
          WHERE ce.student_id = $1 AND c.status = 'active'
          ORDER BY c.created_at DESC
        `, [user.id]);
        break;
      default:
        courses = [];
    }

    res.json({ courses });
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get assignments for different roles
router.get('/assignments', auth.authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    let assignments = [];

    switch (user.role) {
      case 'teacher':
        assignments = await db.all(`
          SELECT a.*, c.name as course_name, cl.name as class_name
          FROM assignments a
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          WHERE cl.teacher_id = $1 AND a.status != 'deleted'
          ORDER BY a.due_date ASC
        `, [user.id]);
        break;
      case 'student':
        assignments = await db.all(`
          SELECT a.*, c.name as course_name, cl.name as class_name, u.first_name, u.last_name
          FROM assignments a
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          JOIN users u ON cl.teacher_id = u.id
          JOIN class_enrollments ce ON cl.id = ce.class_id
          WHERE ce.student_id = $1 AND a.status != 'deleted'
          ORDER BY a.due_date ASC
        `, [user.id]);
        break;
      case 'college_admin':
        assignments = await db.all(`
          SELECT a.*, c.name as course_name, cl.name as class_name, u.first_name, u.last_name
          FROM assignments a
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          JOIN users u ON cl.teacher_id = u.id
          WHERE c.college_id = $1 AND a.status != 'deleted'
          ORDER BY a.due_date ASC
        `, [user.college_id]);
        break;
      default:
        return res.status(400).json({ error: 'Invalid user role for assignments' });
    }

    res.json({ assignments });
  } catch (error) {
    console.error('Assignments fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Get attendance data
router.get('/attendance', auth.authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    let attendance = [];

    switch (user.role) {
      case 'teacher':
        attendance = await db.all(`
          SELECT a.*, s.first_name, s.last_name, s.email, cl.name as class_name, c.name as course_name
          FROM attendance a
          JOIN users s ON a.student_id = s.id
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          WHERE cl.teacher_id = $1 AND a.date >= NOW() - INTERVAL '30 days'
          ORDER BY a.date DESC, s.first_name, s.last_name
        `, [user.id]);
        break;
      case 'student':
        attendance = await db.all(`
          SELECT a.*, cl.name as class_name, c.name as course_name, u.first_name, u.last_name
          FROM attendance a
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          JOIN users u ON cl.teacher_id = u.id
          WHERE a.student_id = $1 AND a.date >= NOW() - INTERVAL '30 days'
          ORDER BY a.date DESC
        `, [user.id]);
        break;
      case 'college_admin':
        attendance = await db.all(`
          SELECT a.*, s.first_name, s.last_name, cl.name as class_name, c.name as course_name, u.first_name as teacher_first_name, u.last_name as teacher_last_name
          FROM attendance a
          JOIN users s ON a.student_id = s.id
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          JOIN users u ON cl.teacher_id = u.id
          WHERE c.college_id = $1 AND a.date >= NOW() - INTERVAL '30 days'
          ORDER BY a.date DESC
        `, [user.college_id]);
        break;
      default:
        return res.status(400).json({ error: 'Invalid user role for attendance' });
    }

    res.json({ attendance });
  } catch (error) {
    console.error('Attendance fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance data' });
  }
});

// Get grades for different roles
router.get('/grades', auth.authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    let grades = [];

    switch (user.role) {
      case 'teacher':
        grades = await db.all(`
          SELECT g.*, s.first_name, s.last_name, s.email, a.title as assignment_title, cl.name as class_name, c.name as course_name
          FROM grades g
          JOIN users s ON g.student_id = s.id
          JOIN assignments a ON g.assignment_id = a.id
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          WHERE cl.teacher_id = $1 AND g.status != 'deleted'
          ORDER BY g.created_at DESC
        `, [user.id]);
        break;
      case 'student':
        grades = await db.all(`
          SELECT g.*, a.title as assignment_title, cl.name as class_name, c.name as course_name, u.first_name, u.last_name
          FROM grades g
          JOIN assignments a ON g.assignment_id = a.id
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          JOIN users u ON cl.teacher_id = u.id
          WHERE g.student_id = $1 AND g.status != 'deleted'
          ORDER BY g.created_at DESC
        `, [user.id]);
        break;
      case 'college_admin':
        grades = await db.all(`
          SELECT g.*, s.first_name, s.last_name, a.title as assignment_title, cl.name as class_name, c.name as course_name, u.first_name as teacher_first_name, u.last_name as teacher_last_name
          FROM grades g
          JOIN users s ON g.student_id = s.id
          JOIN assignments a ON g.assignment_id = a.id
          JOIN classes cl ON a.class_id = cl.id
          JOIN courses c ON cl.course_id = c.id
          JOIN users u ON cl.teacher_id = u.id
          WHERE c.college_id = $1 AND g.status != 'deleted'
          ORDER BY g.created_at DESC
        `, [user.college_id]);
        break;
      default:
        return res.status(400).json({ error: 'Invalid user role for grades' });
    }

    res.json({ grades });
  } catch (error) {
    console.error('Grades fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
});

// Get fee data for different roles
router.get('/fees', auth.authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    let fees = [];

    switch (user.role) {
      case 'student':
        fees = await db.all(`
          SELECT fc.*, fs.fee_type, c.name as course_name
          FROM fee_collections fc
          JOIN fee_structures fs ON fc.fee_structure_id = fs.id
          JOIN courses c ON fs.course_id = c.id
          WHERE fc.student_id = $1 AND fc.status != 'deleted'
          ORDER BY fc.payment_date DESC
        `, [user.id]);
        break;
      case 'college_admin':
        fees = await db.all(`
          SELECT fc.*, s.first_name, s.last_name, s.email, fs.fee_type, c.name as course_name, u.first_name as collector_first_name, u.last_name as collector_last_name
          FROM fee_collections fc
          JOIN users s ON fc.student_id = s.id
          JOIN fee_structures fs ON fc.fee_structure_id = fs.id
          JOIN courses c ON fs.course_id = c.id
          JOIN users u ON fc.collected_by = u.id
          WHERE c.college_id = $1 AND fc.status != 'deleted'
          ORDER BY fc.payment_date DESC
        `, [user.college_id]);
        break;
      default:
        return res.status(400).json({ error: 'Invalid user role for fees' });
    }

    res.json({ fees });
  } catch (error) {
    console.error('Fees fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch fee data' });
  }
});

// Helper function to get super admin stats
async function getSuperAdminStats() {
  try {
    // Get total colleges
    const totalColleges = await db.get('SELECT COUNT(*) as count FROM colleges');
    
    // Get total users
    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    
    // Get active subscriptions
    const activeSubscriptions = await db.get('SELECT COUNT(*) as count FROM colleges WHERE subscription_status = \'active\'');
    
    // Get recent activity (last 30 days)
    const recentActivity = await db.get(`
      SELECT COUNT(*) as count FROM activity_logs 
              WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    return {
      total_colleges: totalColleges.count,
      total_users: totalUsers.count,
      active_subscriptions: activeSubscriptions.count,
      recent_activity: recentActivity.count
    };
  } catch (error) {
    console.error('Super admin stats error:', error);
    throw error;
  }
}

// Helper function to get college admin stats
async function getCollegeAdminStats(collegeId) {
  try {
    // Get total students
    const totalStudents = await db.get(
      'SELECT COUNT(*) as count FROM users WHERE college_id = $1 AND role = \'student\'',
      [collegeId]
    );
    
    // Get total teachers
    const totalTeachers = await db.get(
      'SELECT COUNT(*) as count FROM users WHERE college_id = $1 AND role = \'teacher\'',
      [collegeId]
    );
    
    // Get total courses
    const totalCourses = await db.get(
      'SELECT COUNT(*) as count FROM courses WHERE college_id = $1',
      [collegeId]
    );
    
    // Get total fees collected
    const totalFees = await db.get(
      'SELECT SUM(amount_paid) as total FROM fee_collections WHERE college_id = $1 AND status = \'paid\'',
      [collegeId]
    );

    return {
      total_students: totalStudents.count,
      total_teachers: totalTeachers.count,
      total_courses: totalCourses.count,
      total_fees_collected: totalFees.total || 0
    };
  } catch (error) {
    console.error('College admin stats error:', error);
    throw error;
  }
}

// Helper function to get teacher stats
async function getTeacherStats(teacherId, collegeId) {
  try {
    // Get teacher's classes
    const teacherClasses = await db.all(
      'SELECT id FROM classes WHERE teacher_id = $1 AND college_id = $2',
      [teacherId, collegeId]
    );
    
    const classIds = teacherClasses.map(cls => cls.id);
    
    if (classIds.length === 0) {
      return {
        total_classes: 0,
        total_students: 0,
        total_assignments: 0,
        average_attendance: 0
      };
    }

    // Create placeholders for parameterized query
    const placeholders = classIds.map(() => '?').join(',');
    
    // Get total students in teacher's classes using parameterized query
    const totalStudents = await db.get(
      `SELECT COUNT(DISTINCT student_id) as count FROM class_enrollments WHERE class_id IN (${placeholders})`,
      classIds
    );
    
    // Get total assignments
    const totalAssignments = await db.get(
      `SELECT COUNT(*) as count FROM assignments WHERE class_id IN (${placeholders})`,
      classIds
    );
    
    // Get average attendance
    const averageAttendance = await db.get(
      `SELECT AVG(CASE WHEN status = 'present' THEN 100 ELSE 0 END) as average FROM attendance WHERE class_id IN (${placeholders})`,
      classIds
    );

    return {
      total_classes: classIds.length,
      total_students: totalStudents.count,
      total_assignments: totalAssignments.count,
      average_attendance: averageAttendance.average || 0
    };
  } catch (error) {
    console.error('Teacher stats error:', error);
    throw error;
  }
}

// Helper function to get student stats
async function getStudentStats(studentId, collegeId) {
  try {
    // Get student's enrollments
    const studentEnrollments = await db.all(
      'SELECT class_id FROM class_enrollments WHERE student_id = $1',
      [studentId]
    );
    
    const classIds = studentEnrollments.map(enrollment => enrollment.class_id);
    
    if (classIds.length === 0) {
      return {
        total_courses: 0,
        average_grade: 0,
        attendance_rate: 0,
        total_fees_paid: 0
      };
    }

    // Create placeholders for parameterized query
    const placeholders = classIds.map(() => '$1').join(',');
    
    // Get total courses using parameterized query
    const totalCourses = await db.get(
      `SELECT COUNT(*) as count FROM class_enrollments WHERE student_id = $1 AND class_id IN (${placeholders})`,
      [studentId, ...classIds]
    );
    
    // Get average grade using parameterized query
    const averageGrade = await db.get(
      `SELECT AVG(grade_percentage) as average FROM grades WHERE student_id = $1 AND status != 'deleted'`,
      [studentId]
    );
    
    // Get attendance rate using parameterized query
    const attendanceRate = await db.get(
      `SELECT AVG(CASE WHEN status = 'present' THEN 100 ELSE 0 END) as rate FROM attendance WHERE student_id = $1`,
      [studentId]
    );
    
    // Get total fees paid
    const totalFeesPaid = await db.get(
      'SELECT SUM(amount_paid) as total FROM fee_collections WHERE student_id = $1 AND status = \'paid\'',
      [studentId]
    );

    return {
      total_courses: totalCourses.count,
      average_grade: averageGrade.average || 0,
      attendance_rate: attendanceRate.rate || 0,
      total_fees_paid: totalFeesPaid.total || 0
    };
  } catch (error) {
    console.error('Student stats error:', error);
    throw error;
  }
}

// Helper function to get parent stats
async function getParentStats(parentId, collegeId) {
  try {
    // Get parent's children (students)
    const children = await db.all(
      'SELECT id FROM users WHERE college_id = $1 AND role = \'student\' AND parent_id = ?',
      [collegeId, parentId]
    );
    
    if (children.length === 0) {
      return {
        total_children: 0,
        children_grades: [],
        children_attendance: []
      };
    }

    const childIds = children.map(child => child.id);
    const placeholders = childIds.map(() => '$1').join(',');
    
    // Get children's grades
    const childrenGrades = await db.all(
      `SELECT student_id, AVG(grade_percentage) as average_grade FROM grades 
       WHERE student_id IN (${placeholders}) AND status != 'deleted' 
       GROUP BY student_id`,
      childIds
    );
    
    // Get children's attendance
    const childrenAttendance = await db.all(
      `SELECT student_id, AVG(CASE WHEN status = 'present' THEN 100 ELSE 0 END) as attendance_rate 
       FROM attendance WHERE student_id IN (${placeholders}) 
       GROUP BY student_id`,
      childIds
    );

    return {
      total_children: children.length,
      children_grades: childrenGrades,
      children_attendance: childrenAttendance
    };
  } catch (error) {
    console.error('Parent stats error:', error);
    throw error;
  }
}

// Teacher dashboard stats
router.get('/teacher/stats', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;
    const collegeId = req.user.college_id;
    
    const stats = await getTeacherStats(teacherId, collegeId);
    
    res.json({
      success: true,
      stats: {
        totalStudents: stats.total_students || 0,
        totalClasses: stats.total_classes || 0,
        totalAssignments: stats.total_assignments || 0,
        averageGrade: stats.average_grade || 0,
        attendanceRate: stats.attendance_rate || 0,
        pendingGrading: stats.pending_grading || 0,
        upcomingDeadlines: stats.upcoming_deadlines || 0,
        overdueAssignments: stats.overdue_assignments || 0,
        pendingSubmissions: stats.pending_submissions || 0,
        recentAverageGrade: stats.recent_average_grade || 0,
        unreadNotifications: stats.unread_notifications || 0
      }
    });
  } catch (error) {
    console.error('Teacher stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load teacher statistics'
    });
  }
});

// Get teacher grade distribution
router.get('/teacher/grade-distribution', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;
    
    const gradeDistribution = await db.all(`
      SELECT 
        CASE 
          WHEN grade_percentage >= 90 THEN 'A'
          WHEN grade_percentage >= 80 THEN 'B'
          WHEN grade_percentage >= 70 THEN 'C'
          WHEN grade_percentage >= 60 THEN 'D'
          ELSE 'F'
        END as grade,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM grades g
          JOIN assignments a ON g.assignment_id = a.id
          JOIN classes cl ON a.class_id = cl.id
          WHERE cl.teacher_id = $1 AND g.status != 'deleted'), 1) as percentage
      FROM grades g
      JOIN assignments a ON g.assignment_id = a.id
      JOIN classes cl ON a.class_id = cl.id
      WHERE cl.teacher_id = $2 AND g.status != 'deleted'
      GROUP BY 
        CASE 
          WHEN grade_percentage >= 90 THEN 'A'
          WHEN grade_percentage >= 80 THEN 'B'
          WHEN grade_percentage >= 70 THEN 'C'
          WHEN grade_percentage >= 60 THEN 'D'
          ELSE 'F'
        END
      ORDER BY grade
    `, [teacherId, teacherId]);
    
    res.json({
      success: true,
      gradeDistribution: gradeDistribution || []
    });
  } catch (error) {
    console.error('Grade distribution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load grade distribution'
    });
  }
});

// Get teacher performance trends
router.get('/teacher/performance-trends', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;
    
    const performanceTrends = await db.all(`
      SELECT 
        EXTRACT(MONTH FROM g.created_at) as month,
        EXTRACT(YEAR FROM g.created_at) as year,
        AVG(g.grade_percentage) as average_grade,
        AVG(CASE WHEN a.status = 'present' THEN 100 ELSE 0 END) as attendance_rate
      FROM grades g
      JOIN assignments ass ON g.assignment_id = ass.id
      JOIN classes cl ON ass.class_id = cl.id
      LEFT JOIN attendance a ON cl.id = a.class_id AND a.date >= NOW() - INTERVAL '6 months'
      WHERE cl.teacher_id = $1 AND g.status != 'deleted'
      GROUP BY TO_CHAR(g.created_at, 'YYYY-MM')
      ORDER BY year DESC, month DESC
      LIMIT 6
    `, [teacherId]);
    
    res.json({
      success: true,
      performanceTrends: performanceTrends || []
    });
  } catch (error) {
    console.error('Performance trends error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load performance trends'
    });
  }
});

// Get teacher upcoming deadlines
router.get('/teacher/upcoming-deadlines', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;
    
    const upcomingDeadlines = await db.all(`
      SELECT 
        a.id,
        a.title,
        a.due_date,
        a.assignment_type as type,
        CASE 
                  WHEN a.due_date <= NOW() + INTERVAL '3 days' THEN 'high'
        WHEN a.due_date <= NOW() + INTERVAL '7 days' THEN 'medium'
          ELSE 'low'
        END as priority,
        cl.name as class_name,
        COUNT(s.id) as submitted_count,
        (SELECT COUNT(*) FROM class_enrollments ce WHERE ce.class_id = cl.id AND ce.status = 'enrolled') as total_students
      FROM assignments a
      JOIN classes cl ON a.class_id = cl.id
      LEFT JOIN assignment_submissions s ON a.id = s.assignment_id
      WHERE cl.teacher_id = $1 AND a.status = 'active' AND a.due_date >= NOW()
      GROUP BY a.id
      ORDER BY a.due_date ASC
      LIMIT 10
    `, [teacherId]);
    
    res.json({
      success: true,
      upcomingDeadlines: upcomingDeadlines || []
    });
  } catch (error) {
    console.error('Upcoming deadlines error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load upcoming deadlines'
    });
  }
});

// Teacher notifications
router.get('/teacher/notifications', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const teacherId = req.user.id;
    
    // Get notifications for teacher
    const notifications = await db.all(`
      SELECT 
        n.id,
        n.title,
        n.message,
        n.type,
        n.created_at,
        n.read_status
      FROM notifications n
      WHERE n.recipient_id = $1 AND n.recipient_type = 'teacher'
      ORDER BY n.created_at DESC
      LIMIT 20
    `, [teacherId]);
    
    res.json({
      success: true,
      notifications: notifications || []
    });
  } catch (error) {
    console.error('Teacher notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load notifications'
    });
  }
});

// Mark notification as read
router.put('/teacher/notifications/:id/read', auth.authenticateToken, auth.authorizeRoles('teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.user.id;
    
    await db.run(`
      UPDATE notifications 
      SET read_status = 'read' 
      WHERE id = $1 AND recipient_id = $2 AND recipient_type = 'teacher'
    `, [id, teacherId]);
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read'
    });
  }
});

module.exports = router;