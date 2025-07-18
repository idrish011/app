# CampusLink Backend API

A secure, production-ready Node.js backend API for the CampusLink education management system.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 16.0.0
- npm >= 8.0.0
- SQLite3

### Installation
```bash
# Clone the repository
git clone https://github.com/campuslink/backend.git
cd backend

# Install dependencies
npm install

# Set up environment
cp env.example .env
# Edit .env with your configuration

# Run database migrations
npm run migrate

# Start the server
npm start
```

## 📋 Features

### 🔐 Security
- JWT Authentication
- SQL Injection Prevention
- XSS Protection
- Rate Limiting
- Security Headers
- Input Validation
- File Upload Security

### 🏗️ Architecture
- Express.js Framework
- SQLite Database
- Multi-tenant Architecture
- RESTful API Design
- Modular Route Structure

### 📱 Push Notifications
- Firebase Cloud Messaging
- Multi-device Support
- Targeted Notifications
- Development Mode Fallback

## 🔧 Configuration

### Environment Variables

Create a `.env` file based on `env.example`:

```bash
# Required
NODE_ENV=production
PORT=3000
JWT_SECRET=your-very-long-and-very-random-secret-key

# Security
ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT_ENABLED=true
SECURITY_HEADERS_ENABLED=true

# Optional - Push Notifications
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

### Production Checklist

- [ ] Set strong JWT_SECRET (32+ characters)
- [ ] Configure ALLOWED_ORIGINS for production domains
- [ ] Enable rate limiting
- [ ] Set up SSL/HTTPS
- [ ] Configure Firebase (optional)
- [ ] Set up logging
- [ ] Configure database backups

## 📁 Project Structure

```
backend/
├── index.js                 # Main server file
├── package.json            # Dependencies and scripts
├── env.example            # Environment variables template
├── middleware/            # Security and auth middleware
│   ├── auth.js           # JWT authentication
│   └── security.js       # Security middleware
├── routes/               # API routes
│   ├── auth.js          # Authentication routes
│   ├── dashboard.js     # Dashboard routes
│   ├── messages.js      # Messaging routes
│   └── ...              # Other route files
├── models/              # Database models
│   └── database.js      # Database connection
├── utils/               # Utility functions
│   └── pushNotifications.js # Push notification service
├── uploads/             # File uploads directory
├── logs/                # Application logs
└── campuslink.db        # SQLite database
```

## 🛠️ API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout
- `GET /api/auth/profile` - Get user profile

### Dashboard
- `GET /api/dashboard/overview` - Dashboard overview
- `GET /api/dashboard/stats` - Statistics
- `GET /api/dashboard/recent` - Recent activities

### Messaging
- `GET /api/messages` - Get messages
- `POST /api/messages` - Send message
- `PUT /api/messages/:id` - Update message
- `DELETE /api/messages/:id` - Delete message

### Health Check
- `GET /api/health` - Health check endpoint

## 🔒 Security Features

### Authentication & Authorization
- JWT-based authentication
- Role-based access control
- Session management
- Password hashing with bcrypt

### Input Validation
- Request validation middleware
- SQL injection prevention
- XSS protection
- File upload validation

### Rate Limiting
- Global rate limiting
- Authentication-specific limits
- Configurable windows and limits

### Security Headers
- Helmet.js integration
- Content Security Policy
- X-Frame-Options
- X-Content-Type-Options

## 📊 Monitoring & Logging

### Logging
- Winston logger configuration
- Daily log rotation
- Error tracking
- Request/response logging

### Health Checks
- Database connectivity
- Memory usage
- Uptime monitoring
- API response times

## 🚀 Deployment

### Docker (Recommended)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### PM2 Process Manager
```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start index.js --name campuslink-backend

# Monitor
pm2 monit

# Logs
pm2 logs campuslink-backend
```

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🧪 Testing

### Security Tests
```bash
# Run security tests
npm run test:security

# Test specific features
node test-security.js
```

### API Tests
```bash
# Health check
curl http://localhost:3000/api/health

# Authentication test
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

## 📈 Performance

### Optimization
- Response compression
- Database query optimization
- Caching strategies
- Memory management

### Monitoring
- Response time tracking
- Error rate monitoring
- Database performance
- Memory usage

## 🔧 Maintenance

### Database
```bash
# Backup database
cp campuslink.db campuslink.db.backup

# Run migrations
npm run migrate

# Check database integrity
sqlite3 campuslink.db "PRAGMA integrity_check;"
```

### Logs
```bash
# View logs
npm run logs

# View error logs
npm run logs:error

# Rotate logs
pm2 reload campuslink-backend
```

## 🆘 Troubleshooting

### Common Issues

#### JWT Secret Error
```
Error: JWT_SECRET environment variable is required in production
```
**Solution**: Set a strong JWT_SECRET in your .env file.

#### Database Connection Error
```
Error: Cannot connect to database
```
**Solution**: Check database file permissions and path.

#### CORS Error
```
Error: Not allowed by CORS
```
**Solution**: Add your domain to ALLOWED_ORIGINS.

#### Rate Limiting Error
```
Error: Too many requests
```
**Solution**: Wait for rate limit window to reset.

### Debug Mode
```bash
# Enable debug logging
DEBUG=* npm start

# Check environment
node -e "console.log(process.env)"
```

## 📞 Support

- **Documentation**: [API Documentation](./API_DOCUMENTATION.md)
- **Security**: [Security Checklist](./SECURITY_CHECKLIST.md)
- **Issues**: [GitHub Issues](https://github.com/campuslink/backend/issues)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Maintainer**: CampusLink Team 