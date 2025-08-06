const { Pool } = require('pg');
const path = require('path');

class Database {
  constructor() {
    // Use DATABASE_URL from environment variables
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    
    this.pool = new Pool({
      connectionString: 'postgresql://neondb_owner:npg_5jDmyEF4cPul@ep-holy-lab-a1gq3lv4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      ssl: { rejectUnauthorized: false }
    });
    // Do not call initializeTables() in constructor; call it only once on startup
  }

  async initializeTables() {
    // Helper for running queries
    const runAsync = (sql) => this.pool.query(sql);

    // Colleges/Tenants table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS colleges (
        id UUID PRIMARY KEY,
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
        show_on_landing BOOLEAN DEFAULT FALSE,
        landing_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Users table with role-based access
    await runAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        college_id UUID,
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
        push_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        UNIQUE(college_id, email)
      )
    `);

    // Add push_token column to users table if it doesn't exist
    await runAsync(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT`);

    // Courses table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS courses (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT,
        credits INTEGER DEFAULT 3,
        duration_months INTEGER DEFAULT 6,
        fee_amount NUMERIC(10,2),
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id)
      )
    `);

    // Academic Years table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS academic_years (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        name TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id)
      )
    `);

    // Semesters table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS semesters (
        id UUID PRIMARY KEY,
        academic_year_id UUID NOT NULL,
        name TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (academic_year_id) REFERENCES academic_years (id)
      )
    `);

    // Admissions table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS admissions (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        course_id UUID NOT NULL,
        student_id UUID NOT NULL,
        academic_year_id UUID NOT NULL,
        application_number TEXT UNIQUE NOT NULL,
        admission_date DATE NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
        documents_submitted TEXT,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (course_id) REFERENCES courses (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        FOREIGN KEY (academic_year_id) REFERENCES academic_years (id)
      )
    `);

    // Fee Structure table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS fee_structures (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        course_id UUID NOT NULL,
        academic_year_id UUID NOT NULL,
        fee_type TEXT NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        due_date DATE,
        is_optional BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (course_id) REFERENCES courses (id),
        FOREIGN KEY (academic_year_id) REFERENCES academic_years (id)
      )
    `);

    // Fee Collections table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS fee_collections (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        student_id UUID NOT NULL,
        fee_structure_id UUID NOT NULL,
        amount_paid NUMERIC(10,2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method TEXT,
        transaction_id TEXT,
        receipt_number TEXT UNIQUE,
        status TEXT DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
        remarks TEXT,
        collected_by UUID NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id),
        FOREIGN KEY (collected_by) REFERENCES users (id)
      )
    `);

    // Classes table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS classes (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        course_id UUID NOT NULL,
        semester_id UUID NOT NULL,
        teacher_id UUID NOT NULL,
        name TEXT NOT NULL,
        schedule TEXT,
        room_number TEXT,
        max_students INTEGER DEFAULT 50,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (course_id) REFERENCES courses (id),
        FOREIGN KEY (semester_id) REFERENCES semesters (id),
        FOREIGN KEY (teacher_id) REFERENCES users (id)
      )
    `);

    // Class Enrollments table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS class_enrollments (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL,
        student_id UUID NOT NULL,
        enrollment_date DATE NOT NULL,
        status TEXT DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'completed')),
        grade TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        UNIQUE(class_id, student_id)
      )
    `);

    // Attendance table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL,
        student_id UUID NOT NULL,
        date DATE NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
        marked_by UUID NOT NULL,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        FOREIGN KEY (marked_by) REFERENCES users (id),
        UNIQUE(class_id, student_id, date)
      )
    `);

    // Assignments table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS assignments (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        due_date TIMESTAMP NOT NULL,
        total_marks INTEGER NOT NULL,
        weightage NUMERIC(5,2) DEFAULT 0,
        assignment_type TEXT DEFAULT 'assignment' CHECK (assignment_type IN ('assignment', 'project', 'quiz', 'exam')),
        document_path TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
        created_by UUID NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes (id),
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `);

    // Grades table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS grades (
        id UUID PRIMARY KEY,
        assignment_id UUID NOT NULL,
        student_id UUID NOT NULL,
        grade_percentage NUMERIC(5,2) NOT NULL,
        grade_letter TEXT,
        feedback TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assignment_id) REFERENCES assignments (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        UNIQUE(assignment_id, student_id)
      )
    `);

    // Events table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        event_date DATE NOT NULL,
        event_time TIME,
        event_type TEXT DEFAULT 'general' CHECK (event_type IN ('meeting', 'exam', 'holiday', 'sports', 'cultural', 'general')),
        location TEXT,
        organizer_id UUID,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (organizer_id) REFERENCES users (id)
      )
    `);

    // Assignment Submissions table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        id UUID PRIMARY KEY,
        assignment_id UUID NOT NULL,
        student_id UUID NOT NULL,
        submission_date TIMESTAMP NOT NULL,
        file_url TEXT,
        remarks TEXT,
        marks_obtained NUMERIC(5,2),
        feedback TEXT,
        graded_by UUID,
        graded_at TIMESTAMP,
        status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'late', 'graded', 'rejected')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assignment_id) REFERENCES assignments (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        FOREIGN KEY (graded_by) REFERENCES users (id),
        UNIQUE(assignment_id, student_id)
      )
    `);

    // Results table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS results (
        id UUID PRIMARY KEY,
        class_id UUID NOT NULL,
        student_id UUID NOT NULL,
        assignment_id UUID,
        exam_type TEXT CHECK (exam_type IN ('assignment', 'midterm', 'final', 'quiz')),
        marks_obtained NUMERIC(5,2) NOT NULL,
        total_marks NUMERIC(5,2) NOT NULL,
        percentage NUMERIC(5,2),
        grade TEXT,
        remarks TEXT,
        published BOOLEAN DEFAULT FALSE,
        published_by UUID,
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        FOREIGN KEY (assignment_id) REFERENCES assignments (id),
        FOREIGN KEY (published_by) REFERENCES users (id)
      )
    `);

    // Parent-Student Relationships table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS parent_student_relationships (
        id UUID PRIMARY KEY,
        parent_id UUID NOT NULL,
        student_id UUID NOT NULL,
        relationship_type TEXT DEFAULT 'parent',
        is_primary_contact BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES users (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        UNIQUE(parent_id, student_id)
      )
    `);

    // Notifications table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        user_id UUID NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'error', 'success')),
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // API Keys table for additional security
    await runAsync(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        user_id UUID,
        key_hash TEXT NOT NULL,
        name TEXT,
        permissions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Rate limiting logs
    await runAsync(`
      CREATE TABLE IF NOT EXISTS rate_limit_logs (
        id SERIAL PRIMARY KEY,
        college_id UUID,
        ip_address TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id)
      )
    `);

    // Contact Messages table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id UUID PRIMARY KEY,
        college_id UUID,
        user_id UUID,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied', 'closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // App Ratings table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS app_ratings (
        id UUID PRIMARY KEY,
        college_id UUID,
        user_id UUID,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        feedback TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Student Fee Status table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS student_fee_status (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        student_id UUID NOT NULL,
        fee_structure_id UUID NOT NULL,
        status TEXT DEFAULT 'due' CHECK (status IN ('due', 'partial', 'paid', 'overdue')),
        due_date DATE NOT NULL,
        total_amount NUMERIC(10,2) NOT NULL,
        amount_paid NUMERIC(10,2) DEFAULT 0,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id),
        FOREIGN KEY (student_id) REFERENCES users (id),
        FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id),
        UNIQUE(student_id, fee_structure_id)
      )
    `);

    // Admission Inquiries table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS admission_inquiries (
        id UUID PRIMARY KEY,
        college_id UUID NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'enrolled', 'rejected')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (college_id) REFERENCES colleges (id)
      )
    `);

    // Activity Logs table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id UUID PRIMARY KEY,
        user_id UUID,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id UUID,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Messages table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'announcement',
        priority TEXT DEFAULT 'normal',
        sender_id UUID NOT NULL,
        sender_name TEXT,
        target_type TEXT DEFAULT 'all',
        target_ids JSONB,
        attachments JSONB,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users (id)
      )
    `);

    // Message Recipients table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS message_recipients (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL,
        recipient_id UUID NOT NULL,
        is_read INTEGER DEFAULT 0,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
        FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(message_id, recipient_id)
      )
    `);

    console.log('Multi-tenant SaaS database schema initialized successfully (PostgreSQL)');
    return true;
  }

  // Helper method to run queries with promises
  async run(sql, params = []) {
    const res = await this.pool.query(sql, params);
    return { rowCount: res.rowCount, rows: res.rows };
  }

  async get(sql, params = []) {
    const res = await this.pool.query(sql, params);
    return res.rows[0] || null;
  }

  async all(sql, params = []) {
    const res = await this.pool.query(sql, params);
    return res.rows;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;