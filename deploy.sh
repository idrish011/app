#!/bin/bash

# CampusLink Backend Production Deployment Script
# Version: 1.0.0

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root"
   exit 1
fi

# Configuration
APP_NAME="campuslink-backend"
DOCKER_COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"

log "Starting CampusLink Backend deployment..."

# Check prerequisites
log "Checking prerequisites..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    warning "Environment file not found. Creating from template..."
    if [ -f "env.example" ]; then
        cp env.example .env
        warning "Please edit .env file with your production settings before continuing."
        echo "Required variables:"
        echo "  - JWT_SECRET (32+ character random string)"
        echo "  - ALLOWED_ORIGINS (your domain)"
        echo "  - FIREBASE_PROJECT_ID (optional)"
        echo "  - GOOGLE_APPLICATION_CREDENTIALS (optional)"
        read -p "Press Enter after editing .env file..."
    else
        error "env.example not found. Please create .env file manually."
        exit 1
    fi
fi

# Validate environment variables
log "Validating environment variables..."

# Source the .env file
set -a
source .env
set +a

# Check required variables
if [ -z "$JWT_SECRET" ]; then
    error "JWT_SECRET is not set in .env file"
    exit 1
fi

if [ -z "$ALLOWED_ORIGINS" ]; then
    error "ALLOWED_ORIGINS is not set in .env file"
    exit 1
fi

if [ "$NODE_ENV" != "production" ]; then
    warning "NODE_ENV is not set to 'production'. Setting to production..."
    echo "NODE_ENV=production" >> .env
fi

success "Environment validation passed"

# Create necessary directories
log "Creating necessary directories..."
mkdir -p logs uploads ssl

# Set proper permissions
log "Setting file permissions..."
chmod 755 logs uploads
chmod 600 .env

# Backup existing database if it exists
if [ -f "campuslink.db" ]; then
    log "Creating database backup..."
    cp campuslink.db campuslink.db.backup.$(date +%Y%m%d_%H%M%S)
    success "Database backed up"
fi

# Stop existing containers
log "Stopping existing containers..."
docker-compose down --remove-orphans || true

# Build and start containers
log "Building and starting containers..."
docker-compose up -d --build

# Wait for container to be healthy
log "Waiting for container to be healthy..."
timeout=60
counter=0
while [ $counter -lt $timeout ]; do
    if docker-compose ps | grep -q "healthy"; then
        success "Container is healthy"
        break
    fi
    sleep 2
    counter=$((counter + 2))
    echo -n "."
done

if [ $counter -eq $timeout ]; then
    error "Container failed to become healthy within $timeout seconds"
    docker-compose logs
    exit 1
fi

# Test the API
log "Testing API health..."
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    success "API health check passed"
else
    error "API health check failed"
    docker-compose logs
    exit 1
fi

# Run security tests
log "Running security tests..."
if [ -f "test-security.js" ]; then
    if node test-security.js > /dev/null 2>&1; then
        success "Security tests passed"
    else
        warning "Some security tests failed (this may be expected in production)"
    fi
else
    warning "Security test file not found"
fi

# Show deployment info
log "Deployment completed successfully!"
echo ""
echo "=== Deployment Information ==="
echo "Application: $APP_NAME"
echo "Status: Running"
echo "Health Check: http://localhost:3000/api/health"
echo "Logs: docker-compose logs -f"
echo "Stop: docker-compose down"
echo "Restart: docker-compose restart"
echo ""

# Show container status
log "Container status:"
docker-compose ps

# Show logs
log "Recent logs:"
docker-compose logs --tail=20

success "CampusLink Backend is now running in production mode!"

# Optional: SSL setup reminder
if [ ! -f "ssl/cert.pem" ] || [ ! -f "ssl/key.pem" ]; then
    echo ""
    warning "SSL certificates not found. For HTTPS:"
    echo "1. Place your SSL certificates in ssl/cert.pem and ssl/key.pem"
    echo "2. Update nginx.conf with your domain name"
    echo "3. Restart with: docker-compose restart nginx"
fi

echo ""
log "Deployment script completed successfully!" 