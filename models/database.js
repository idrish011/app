const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database('./campuslink.db', (err) => {
      if (err) {
        console.error('Error opening database:', err.message);
      } else {
        console.log('Connected to SQLite database');
        this.initializeTables();
      }
    });
  }

  async initializeTables() {
    const runAsync = (sql) => new Promise((resolve, reject) => {
      this.db.run(sql, (err) => err ? reject(err) : resolve());
    });
    // Colleges/Tenants table
    await runAsync(`CREATE TABLE IF NOT EXISTS colleges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT UNIQUE,
      logo_url TEXT,
      address TEXT,
      location TEXT,
      university TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      subscription_plan TEXT DEFAULT 'basic',
      subscription_status TEXT DEFAULT 'active',
      max_users INTEGER DEFAULT 100,
      show_on_landing BOOLEAN DEFAULT 0,
      landing_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Users table with role-based access
    await runAsync(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      college_id TEXT,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'college_admin', 'teacher', 'student', 'parent')),
      status TEXT DEFAULT 'active',
      profile_image TEXT,
      phone TEXT,
      address TEXT,
      date_of_birth DATE,
      gender TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      UNIQUE(college_id, email)
    )`);

    // Courses table
    await runAsync(`CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      credits INTEGER DEFAULT 3,
      duration_months INTEGER DEFAULT 6,
      fee_amount DECIMAL(10,2),
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id)
    )`);

    // Academic Years table
    await runAsync(`CREATE TABLE IF NOT EXISTS academic_years (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id)
    )`);

    // Semesters table
    await runAsync(`CREATE TABLE IF NOT EXISTS semesters (
      id TEXT PRIMARY KEY,
      academic_year_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (academic_year_id) REFERENCES academic_years (id)
    )`);

    // Admissions table
    await runAsync(`CREATE TABLE IF NOT EXISTS admissions (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      academic_year_id TEXT NOT NULL,
      application_number TEXT UNIQUE NOT NULL,
      admission_date DATE NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
      documents_submitted TEXT,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (course_id) REFERENCES courses (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years (id)
    )`);

    // Fee Structure table
    await runAsync(`CREATE TABLE IF NOT EXISTS fee_structures (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      academic_year_id TEXT NOT NULL,
      fee_type TEXT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      due_date DATE,
      is_optional BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (course_id) REFERENCES courses (id),
      FOREIGN KEY (academic_year_id) REFERENCES academic_years (id)
    )`);

    // Fee Collections table
    await runAsync(`CREATE TABLE IF NOT EXISTS fee_collections (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      fee_structure_id TEXT NOT NULL,
      amount_paid DECIMAL(10,2) NOT NULL,
      payment_date DATE NOT NULL,
      payment_method TEXT,
      transaction_id TEXT,
      receipt_number TEXT UNIQUE,
      status TEXT DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
      remarks TEXT,
      collected_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id),
      FOREIGN KEY (collected_by) REFERENCES users (id)
    )`);

    // Classes table
    await runAsync(`CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      semester_id TEXT NOT NULL,
      teacher_id TEXT NOT NULL,
      name TEXT NOT NULL,
      schedule TEXT,
      room_number TEXT,
      max_students INTEGER DEFAULT 50,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (course_id) REFERENCES courses (id),
      FOREIGN KEY (semester_id) REFERENCES semesters (id),
      FOREIGN KEY (teacher_id) REFERENCES users (id)
    )`);

    // Class Enrollments table
    await runAsync(`CREATE TABLE IF NOT EXISTS class_enrollments (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      enrollment_date DATE NOT NULL,
      status TEXT DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'completed')),
      grade TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      UNIQUE(class_id, student_id)
    )`);

    // Attendance table
    await runAsync(`CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      date DATE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
      marked_by TEXT NOT NULL,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      FOREIGN KEY (marked_by) REFERENCES users (id),
      UNIQUE(class_id, student_id, date)
    )`);

    // Assignments table
    await runAsync(`CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATETIME NOT NULL,
      total_marks INTEGER NOT NULL,
      weightage DECIMAL(5,2) DEFAULT 0,
      assignment_type TEXT DEFAULT 'assignment' CHECK (assignment_type IN ('assignment', 'project', 'quiz', 'exam')),
      document_path TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes (id),
      FOREIGN KEY (created_by) REFERENCES users (id)
    )`);

    // Grades table
    await runAsync(`CREATE TABLE IF NOT EXISTS grades (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      grade_percentage DECIMAL(5,2) NOT NULL,
      grade_letter TEXT,
      feedback TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assignment_id) REFERENCES assignments (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      UNIQUE(assignment_id, student_id)
    )`);

    // Events table
    await runAsync(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date DATE NOT NULL,
      event_time TIME,
      event_type TEXT DEFAULT 'general' CHECK (event_type IN ('meeting', 'exam', 'holiday', 'sports', 'cultural', 'general')),
      location TEXT,
      organizer_id TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (organizer_id) REFERENCES users (id)
    )`);

    // Assignment Submissions table
    await runAsync(`CREATE TABLE IF NOT EXISTS assignment_submissions (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      submission_date DATETIME NOT NULL,
      file_url TEXT,
      remarks TEXT,
      marks_obtained DECIMAL(5,2),
      feedback TEXT,
      graded_by TEXT,
      graded_at DATETIME,
      status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'late', 'graded', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assignment_id) REFERENCES assignments (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      FOREIGN KEY (graded_by) REFERENCES users (id),
      UNIQUE(assignment_id, student_id)
    )`);

    // Results table
    await runAsync(`CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      assignment_id TEXT,
      exam_type TEXT CHECK (exam_type IN ('assignment', 'midterm', 'final', 'quiz')),
      marks_obtained DECIMAL(5,2) NOT NULL,
      total_marks DECIMAL(5,2) NOT NULL,
      percentage DECIMAL(5,2),
      grade TEXT,
      remarks TEXT,
      published BOOLEAN DEFAULT 0,
      published_by TEXT,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      FOREIGN KEY (assignment_id) REFERENCES assignments (id),
      FOREIGN KEY (published_by) REFERENCES users (id)
    )`);

    // Parent-Student Relationships table
    await runAsync(`CREATE TABLE IF NOT EXISTS parent_student_relationships (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      relationship_type TEXT DEFAULT 'parent',
      is_primary_contact BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES users (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      UNIQUE(parent_id, student_id)
    )`);

    // Notifications table
    await runAsync(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'error', 'success')),
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // API Keys table for additional security
    await runAsync(`CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      user_id TEXT,
      key_hash TEXT NOT NULL,
      name TEXT,
      permissions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Rate limiting logs
    await runAsync(`CREATE TABLE IF NOT EXISTS rate_limit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      college_id TEXT,
      ip_address TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id)
    )`);

    // Contact Messages table
    await runAsync(`CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      college_id TEXT,
      user_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied', 'closed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // App Ratings table
    await runAsync(`CREATE TABLE IF NOT EXISTS app_ratings (
      id TEXT PRIMARY KEY,
      college_id TEXT,
      user_id TEXT,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      feedback TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Student Fee Status table
    await runAsync(`CREATE TABLE IF NOT EXISTS student_fee_status (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      fee_structure_id TEXT NOT NULL,
      status TEXT DEFAULT 'due' CHECK (status IN ('due', 'partial', 'paid', 'overdue')),
      due_date DATE NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      amount_paid DECIMAL(10,2) DEFAULT 0,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id),
      FOREIGN KEY (student_id) REFERENCES users (id),
      FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id),
      UNIQUE(student_id, fee_structure_id)
    )`);

    // Admission Inquiries table
    await runAsync(`CREATE TABLE IF NOT EXISTS admission_inquiries (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'enrolled', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (college_id) REFERENCES colleges (id)
    )`);

    console.log('Multi-tenant SaaS database schema initialized successfully');
    return true;
  }

  // Helper method to run queries with promises
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = Database; 