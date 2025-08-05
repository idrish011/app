const admin = require('firebase-admin');
const Database = require('../models/database');

// Initialize Firebase Admin SDK with fallback for development
let firebaseApp;
let isFirebaseConfigured = false;

try {
  // Check if Firebase credentials are available
  if (process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'campuslink-app'
    });
    isFirebaseConfigured = true;
    console.log('✅ Firebase Admin SDK initialized successfully');
  } else {
    console.log('⚠️ Firebase credentials not configured. Push notifications will be logged only.');
  }
} catch (error) {
  console.log('⚠️ Firebase Admin SDK initialization failed. Push notifications will be logged only.');
  console.log('   To enable push notifications, set FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS');
}

class PushNotificationService {
  constructor() {
    this.db = new Database();
    if (isFirebaseConfigured) {
      this.messaging = firebaseApp.messaging();
    }
  }

  // Send notification to a single user
  async sendNotification(token, title, body, data = {}) {
    try {
      if (!isFirebaseConfigured) {
        // Log notification for development
        console.log('📱 Push Notification (Development Mode):', {
          token: token ? `${token.substring(0, 20)}...` : 'No token',
          title,
          body,
          data
        });
        return { success: true, message: 'Notification logged (development mode)' };
      }

      const message = {
        token,
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('Push notification sent successfully:', response);
      return response;
    } catch (error) {
      console.error('Error sending push notification:', error);
      throw error;
    }
  }

  // Send notification to multiple users
  async sendNotificationToUsers(userIds, title, body, data = {}) {
    try {
      // Get user tokens using parameterized query
      const placeholders = userIds.map((_, i) => `${i + 1}`).join(',');
      const query = `
        SELECT id, push_token FROM users 
        WHERE id IN (${placeholders}) AND push_token IS NOT NULL
      `;
      
      const users = await this.db.all(query, userIds);
      
      if (users.length === 0) {
        console.log('No users with push tokens found');
        return [];
      }

      if (!isFirebaseConfigured) {
        // Log notifications for development
        console.log('📱 Multicast Push Notification (Development Mode):', {
          userCount: users.length,
          title,
          body,
          data
        });
        return { success: true, message: 'Notifications logged (development mode)' };
      }

      const tokens = users.map(user => user.push_token);
      const message = {
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      console.log('Multicast push notification sent:', response);
      return response;
    } catch (error) {
      console.error('Error sending multicast push notification:', error);
      throw error;
    }
  }

  // Send notification to all users in a college
  async sendNotificationToCollege(collegeId, title, body, data = {}) {
    try {
      // Get all users in college with push tokens using parameterized query
      const users = await this.db.all(`
        SELECT id, push_token FROM users 
        WHERE college_id = $1 AND push_token IS NOT NULL
      `, [collegeId]);

      if (users.length === 0) {
        console.log('No users with push tokens found in college');
        return [];
      }

      if (!isFirebaseConfigured) {
        // Log notifications for development
        console.log('📱 College Push Notification (Development Mode):', {
          collegeId,
          userCount: users.length,
          title,
          body,
          data
        });
        return { success: true, message: 'College notifications logged (development mode)' };
      }

      const tokens = users.map(user => user.push_token);
      const message = {
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      console.log('College-wide push notification sent:', response);
      return response;
    } catch (error) {
      console.error('Error sending college-wide push notification:', error);
      throw error;
    }
  }

  // Send notification to students in a specific class
  async sendNotificationToClass(classId, title, body, data = {}) {
    try {
      // Get students in class with push tokens using parameterized query
      const students = await this.db.all(`
        SELECT u.id, u.push_token 
        FROM users u
        JOIN class_enrollments ce ON u.id = ce.student_id
        WHERE ce.class_id = $1 AND u.push_token IS NOT NULL
      `, [classId]);

      if (students.length === 0) {
        console.log('No students with push tokens found in class');
        return [];
      }

      if (!isFirebaseConfigured) {
        // Log notifications for development
        console.log('📱 Class Push Notification (Development Mode):', {
          classId,
          studentCount: students.length,
          title,
          body,
          data
        });
        return { success: true, message: 'Class notifications logged (development mode)' };
      }

      const tokens = students.map(student => student.push_token);
      const message = {
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      console.log('Class push notification sent:', response);
      return response;
    } catch (error) {
      console.error('Error sending class push notification:', error);
      throw error;
    }
  }

  // Send notification to teachers
  async sendNotificationToTeachers(collegeId, title, body, data = {}) {
    try {
      // Get teachers with push tokens using parameterized query
      const teachers = await this.db.all(`
        SELECT id, push_token FROM users 
        WHERE college_id = $1 AND role = 'teacher' AND push_token IS NOT NULL
      `, [collegeId]);

      if (teachers.length === 0) {
        console.log('No teachers with push tokens found');
        return [];
      }

      if (!isFirebaseConfigured) {
        // Log notifications for development
        console.log('📱 Teacher Push Notification (Development Mode):', {
          collegeId,
          teacherCount: teachers.length,
          title,
          body,
          data
        });
        return { success: true, message: 'Teacher notifications logged (development mode)' };
      }

      const tokens = teachers.map(teacher => teacher.push_token);
      const message = {
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      console.log('Teacher push notification sent:', response);
      return response;
    } catch (error) {
      console.error('Error sending teacher push notification:', error);
      throw error;
    }
  }

  // Send notification to students
  async sendNotificationToStudents(collegeId, title, body, data = {}) {
    try {
      // Get students with push tokens using parameterized query
      const students = await this.db.all(`
        SELECT id, push_token FROM users 
        WHERE college_id = $1 AND role = 'student' AND push_token IS NOT NULL
      `, [collegeId]);

      if (students.length === 0) {
        console.log('No students with push tokens found');
        return [];
      }

      if (!isFirebaseConfigured) {
        // Log notifications for development
        console.log('📱 Student Push Notification (Development Mode):', {
          collegeId,
          studentCount: students.length,
          title,
          body,
          data
        });
        return { success: true, message: 'Student notifications logged (development mode)' };
      }

      const tokens = students.map(student => student.push_token);
      const message = {
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      console.log('Student push notification sent:', response);
      return response;
    } catch (error) {
      console.error('Error sending student push notification:', error);
      throw error;
    }
  }

  // Send notification to parents
  async sendNotificationToParents(collegeId, title, body, data = {}) {
    try {
      // Get parents with push tokens using parameterized query
      const parents = await this.db.all(`
        SELECT id, push_token FROM users 
        WHERE college_id = $1 AND role = 'parent' AND push_token IS NOT NULL
      `, [collegeId]);

      if (parents.length === 0) {
        console.log('No parents with push tokens found');
        return [];
      }

      if (!isFirebaseConfigured) {
        // Log notifications for development
        console.log('📱 Parent Push Notification (Development Mode):', {
          collegeId,
          parentCount: parents.length,
          title,
          body,
          data
        });
        return { success: true, message: 'Parent notifications logged (development mode)' };
      }

      const tokens = parents.map(parent => parent.push_token);
      const message = {
        notification: {
          title,
          body
        },
        data: {
          ...data,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'high'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      console.log('Parent push notification sent:', response);
      return response;
    } catch (error) {
      console.error('Error sending parent push notification:', error);
      throw error;
    }
  }

  // Legacy methods for backward compatibility
  async sendMessageNotification(recipientIds, notification) {
    return await this.sendNotificationToUsers(recipientIds, notification.title, notification.body, notification.data);
  }

  async sendAssignmentNotification(classId, notification) {
    return await this.sendNotificationToClass(classId, notification.title, notification.body, notification.data);
  }

  async sendGradeNotification(studentId, notification) {
    return await this.sendNotificationToUsers([studentId], notification.title, notification.body, notification.data);
  }

  async sendAttendanceNotification(classId, notification) {
    return await this.sendNotificationToClass(classId, notification.title, notification.body, notification.data);
  }

  async sendFeeNotification(studentId, notification) {
    return await this.sendNotificationToUsers([studentId], notification.title, notification.body, notification.data);
  }

  async sendExamNotification(classId, notification) {
    return await this.sendNotificationToClass(classId, notification.title, notification.body, notification.data);
  }

  async sendScheduleNotification(classId, notification) {
    return await this.sendNotificationToClass(classId, notification.title, notification.body, notification.data);
  }

  async sendEmergencyNotification(collegeId, notification) {
    return await this.sendNotificationToCollege(collegeId, notification.title, notification.body, notification.data);
  }

  async sendAnnouncementNotification(targetIds, notification) {
    return await this.sendNotificationToUsers(targetIds, notification.title, notification.body, notification.data);
  }

  // Set database instance for queries
  setDatabase(db) {
    this.db = db;
  }
}

module.exports = new PushNotificationService();