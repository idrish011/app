const express = require('express');
const Database = require('../models/database');

const router = express.Router();
const db = new Database();

// Public: Get all colleges for landing page
router.get('/colleges/landing', async (req, res) => {
  try {
    const colleges = await db.all(`
      SELECT c.*, GROUP_CONCAT(co.name) as courses
      FROM colleges c
      LEFT JOIN courses co ON c.id = co.college_id
      WHERE c.show_on_landing = 1
      GROUP BY c.id
      ORDER BY c.landing_order
    `);
    
    // Parse courses as array
    const result = colleges.map(college => ({
      ...college,
      courses: college.courses ? college.courses.split(',') : []
    }));
    
    res.json({
      message: 'Landing colleges fetched successfully',
      colleges: result
    });
  } catch (error) {
    console.error('Landing colleges fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch landing colleges',
      message: error.message
    });
  }
});

// Public: Get specific college details for landing page
router.get('/colleges/:collegeId', async (req, res) => {
  try {
    const { collegeId } = req.params;

    const college = await db.get(`
      SELECT c.*, GROUP_CONCAT(co.name) as courses
      FROM colleges c
      LEFT JOIN courses co ON c.id = co.college_id
      WHERE c.id = ? AND c.show_on_landing = 1
      GROUP BY c.id
    `, [collegeId]);

    if (!college) {
      return res.status(404).json({
        error: 'College not found',
        message: 'The specified college does not exist or is not available on landing page'
      });
    }

    // Parse courses as array
    const result = {
      ...college,
      courses: college.courses ? college.courses.split(',') : []
    };

    res.json({
      message: 'College details fetched successfully',
      college: result
    });
  } catch (error) {
    console.error('College details fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch college details',
      message: error.message
    });
  }
});

// Public: Submit admission inquiry
router.post('/admission-inquiry', async (req, res) => {
  try {
    const { college_id, name, email, phone, message } = req.body;
    
    // Validate required fields
    if (!college_id || !name || !email || !phone || !message) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'All fields are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format',
        message: 'Please provide a valid email address'
      });
    }

    // Check if college exists and is available on landing page
    const college = await db.get(`
      SELECT id FROM colleges 
      WHERE id = $1 AND show_on_landing = TRUE
    `, [college_id]);

    if (!college) {
      return res.status(404).json({
        error: 'College not found',
        message: 'The specified college does not exist or is not available'
      });
    }

    const inquiryId = require('uuid').v4();
    
    await db.run(`
      INSERT INTO admission_inquiries (
        id, college_id, name, email, phone, message
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [inquiryId, college_id, name, email, phone, message]);

    res.status(201).json({
      message: 'Admission inquiry submitted successfully',
      inquiry_id: inquiryId
    });
  } catch (error) {
    console.error('Admission inquiry error:', error);
    res.status(500).json({
      error: 'Failed to submit admission inquiry',
      message: error.message
    });
  }
});

// Public: Get college contact information
router.get('/colleges/:collegeId/contact', async (req, res) => {
  try {
    const { collegeId } = req.params;

    const college = await db.get(`
      SELECT id, name, contact_email, contact_phone, address
      FROM colleges 
      WHERE id = ? AND show_on_landing = 1
    `, [collegeId]);

    if (!college) {
      return res.status(404).json({
        error: 'College not found',
        message: 'The specified college does not exist or is not available'
      });
    }

    res.json({
      message: 'College contact information fetched successfully',
      contact: {
        id: college.id,
        name: college.name,
        email: college.contact_email,
        phone: college.contact_phone,
        address: college.address
      }
    });
  } catch (error) {
    console.error('College contact fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch college contact information',
      message: error.message
    });
  }
});

module.exports = router;