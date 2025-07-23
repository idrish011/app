const Database = require('../models/database');
const db = new Database();

/**
 * Check if a date is Sunday
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {boolean} - True if the date is Sunday
 */
function isSunday(date) {
  const dayOfWeek = new Date(date).getDay();
  return dayOfWeek === 0; // 0 = Sunday
}

/**
 * Check if a date is a holiday
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} collegeId - College ID
 * @returns {Promise<boolean>} - True if the date is a holiday
 */
async function isHoliday(date, collegeId) {
  try {
    const holiday = await db.get(`
      SELECT id FROM events 
      WHERE college_id = $1 
      AND event_type = 'holiday' 
      AND event_date = $2 
      AND status = 'active'
    `, [collegeId, date]);
    
    return !!holiday;
  } catch (error) {
    console.error('Error checking holiday:', error);
    return false;
  }
}

/**
 * Check if attendance is allowed on a given date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} collegeId - College ID
 * @returns {Promise<{allowed: boolean, reason: string}>} - Attendance validation result
 */
async function isAttendanceAllowed(date, collegeId) {
  // Check if it's Sunday
  if (isSunday(date)) {
    return {
      allowed: false,
      reason: 'Attendance is not allowed on Sundays'
    };
  }

  // Check if it's a holiday
  const holiday = await isHoliday(date, collegeId);
  if (holiday) {
    return {
      allowed: false,
      reason: 'Attendance is not allowed on holidays'
    };
  }

  return {
    allowed: true,
    reason: 'Attendance is allowed'
  };
}

/**
 * Get all holidays for a college
 * @param {string} collegeId - College ID
 * @param {string} startDate - Start date (optional)
 * @param {string} endDate - End date (optional)
 * @returns {Promise<Array>} - Array of holiday events
 */
async function getHolidays(collegeId, startDate = null, endDate = null) {
  try {
    let query = `
      SELECT id, title, event_date, description
      FROM events 
      WHERE college_id = $1 
      AND event_type = 'holiday' 
      AND status = 'active'
    `;
    const params = [collegeId];

    if (startDate && endDate) {
      query += ' AND event_date BETWEEN $2 AND $3';
      params.push(startDate, endDate);
    }

    query += ' ORDER BY event_date';

    const holidays = await db.all(query, params);
    return holidays;
  } catch (error) {
    console.error('Error fetching holidays:', error);
    return [];
  }
}

/**
 * Get attendance calendar with holiday information
 * @param {string} classId - Class ID
 * @param {string} month - Month (1-12)
 * @param {string} year - Year
 * @returns {Promise<Object>} - Calendar data with holidays
 */
async function getAttendanceCalendarWithHolidays(classId, month, year) {
  try {
    // Get class information to get college_id
    const classInfo = await db.get(`
      SELECT cl.college_id, cl.name as class_name
      FROM classes cl
      WHERE cl.id = $1
    `, [classId]);

    if (!classInfo) {
      throw new Error('Class not found');
    }

    // Get holidays for the month
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;
    
    const holidays = await getHolidays(classInfo.college_id, startDate, endDate);

    // Get attendance data
    const attendanceData = await db.all(`
      SELECT 
        a.date,
        a.status,
        COUNT(a.id) as student_count
      FROM attendance a
      WHERE a.class_id = $1 
        AND EXTRACT(MONTH FROM a.date) = $2 
        AND EXTRACT(YEAR FROM a.date) = $3
      GROUP BY a.date, a.status
      ORDER BY a.date
    `, [classId, parseInt(month), parseInt(year)]);

    // Get total students in class
    const totalStudents = await db.get(`
      SELECT COUNT(*) as count
      FROM class_enrollments ce
      WHERE ce.class_id = $1 AND ce.status = 'enrolled'
    `, [classId]);

    return {
      class_id: classId,
      class_name: classInfo.class_name,
      month: parseInt(month),
      year: parseInt(year),
      attendance_data: attendanceData,
      holidays: holidays,
      total_students: totalStudents.count
    };
  } catch (error) {
    console.error('Error getting attendance calendar with holidays:', error);
    throw error;
  }
}

module.exports = {
  isSunday,
  isHoliday,
  isAttendanceAllowed,
  getHolidays,
  getAttendanceCalendarWithHolidays
};