# Developer Guide

Welcome to the Travel Itinerary Planner development team! This guide will help you get up and running quickly with the codebase and development environment.

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your development machine:

### Required Software
- **Node.js 18+** - JavaScript runtime ([Download](https://nodejs.org/))
- **npm 8+** - Package manager (comes with Node.js)
- **Git** - Version control system ([Download](https://git-scm.com/))
- **Docker & Docker Compose** - For containerization ([Download](https://www.docker.com/))
- **Redis** - For caching and rate limiting ([Installation Guide](https://redis.io/docs/getting-started/installation/))

### Recommended Tools
- **Visual Studio Code** - Code editor with TypeScript support
- **Postman** - API testing (import our collection from `/api-testing/`)
- **Google Cloud SDK** - For deployment and GCP services
- **Terraform** - For infrastructure management

### Required Accounts & API Keys
You'll need accounts and API keys for the following services:

1. **Google Cloud Platform**
   - Create a new project
   - Enable required APIs (Cloud Run, Firestore, Secret Manager, etc.)
   - Create a service account with appropriate permissions

2. **Firebase**
   - Create a Firebase project (can be same as GCP project)
   - Enable Authentication and Firestore
   - Download service account keys

3. **Anthropic**
   - Sign up for Claude API access
   - Get your API key from the dashboard

4. **Amadeus**
   - Register for Amadeus Self-Service API
   - Get client ID and client secret

5. **SendGrid** (Optional)
   - For email notifications
   - Get API key from dashboard

## 🚀 Quick Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd travel-itinerary-planner

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Return to root directory
cd ..
```

### 2. Environment Configuration

#### Backend Environment (backend/.env)
```bash
# Copy the example file
cp backend/.env.example backend/.env

# Edit with your configuration
nano backend/.env
```

Key configuration values:
```env
# Server
NODE_ENV=development
PORT=8080
CORS_ORIGIN=http://localhost:3000

# Database
FIRESTORE_PROJECT_ID=your-firebase-project-id
FIRESTORE_CREDENTIALS_PATH=./secrets/firebase-service-account.json

# Cache
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# External APIs
ANTHROPIC_API_KEY=your-anthropic-api-key
AMADEUS_CLIENT_ID=your-amadeus-client-id
AMADEUS_CLIENT_SECRET=your-amadeus-client-secret

# Authentication
JWT_SECRET=your-jwt-secret-key-min-32-characters
FIREBASE_ADMIN_SDK_PATH=./secrets/firebase-admin-sdk.json

# Email (optional)
SENDGRID_API_KEY=your-sendgrid-api-key
FROM_EMAIL=noreply@yourdomain.com
```

#### Frontend Environment (frontend/.env)
```bash
# Copy the example file
cp frontend/.env.example frontend/.env

# Edit with your configuration
nano frontend/.env
```

Key configuration values:
```env
# API
VITE_API_BASE_URL=http://localhost:8080/api/v1

# Firebase
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-firebase-project-id

# Google Maps
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

### 3. Set Up Service Account Keys

Create a `secrets` directory in both backend and root:
```bash
mkdir -p backend/secrets
mkdir -p secrets
```

Download and place your service account keys:
- `backend/secrets/firebase-service-account.json` - Firebase service account
- `backend/secrets/firebase-admin-sdk.json` - Firebase admin SDK
- `secrets/gcp-service-account.json` - GCP service account (for deployment)

### 4. Start Development Services

#### Option A: Using Docker Compose (Recommended)
```bash
# Start all services including Redis
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

#### Option B: Manual Setup
```bash
# Start Redis (in separate terminal)
redis-server

# Start backend (in separate terminal)
cd backend
npm run dev

# Start frontend (in separate terminal)
cd frontend
npm run dev
```

### 5. Verify Setup

1. **Backend Health Check**: http://localhost:8080/health
2. **Frontend Application**: http://localhost:3000
3. **API Documentation**: http://localhost:8080/api-docs

## 🏗️ Architecture Overview

### Backend Structure
```
backend/src/
├── controllers/         # Request handlers
├── middleware/         # Express middleware
│   ├── auth.ts         # Authentication middleware
│   ├── rateLimiter.ts  # Rate limiting
│   ├── validation.ts   # Input validation
│   └── audit.ts        # Audit logging
├── models/            # Data models and interfaces
├── routes/            # API route definitions
├── services/          # Business logic
│   ├── external/      # Third-party API services
│   │   ├── amadeusService.ts
│   │   ├── claudeService.ts
│   │   └── firebaseService.ts
│   ├── cache/         # Caching services
│   │   └── redisService.ts
│   └── security/      # Security services
│       ├── auditService.ts
│       ├── keyRotationService.ts
│       └── securityMonitoringService.ts
├── utils/             # Utility functions
│   └── logger.ts      # Winston logging
└── app.ts             # Express app setup
```

### Frontend Structure
```
frontend/src/
├── components/        # Reusable UI components
│   ├── common/        # Generic components
│   ├── forms/         # Form components
│   └── layout/        # Layout components
├── pages/            # Route-level components
├── services/         # API client services
├── store/            # Redux state management
│   ├── slices/       # Redux slices
│   └── api/          # RTK Query API definitions
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
└── App.tsx           # Main application component
```

## 🧪 Testing Strategy

### Running Tests

```bash
# Backend tests
cd backend
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:coverage      # With coverage report

# Frontend tests
cd frontend
npm test                   # All tests
npm run test:coverage      # With coverage report
npm run test:e2e          # End-to-end tests
```

### Writing Tests

#### Backend Test Structure
```typescript
// backend/src/tests/services/amadeusService.test.ts
import { AmadeusService } from '../../services/external/amadeusService';
import { redisService } from '../../services/cache/redisService';

jest.mock('../../services/cache/redisService');
const mockRedisService = redisService as jest.Mocked<typeof redisService>;

describe('AmadeusService', () => {
  let amadeusService: AmadeusService;

  beforeEach(() => {
    amadeusService = new AmadeusService();
    jest.clearAllMocks();
  });

  describe('searchFlights', () => {
    it('should return cached results when available', async () => {
      // Test implementation
    });

    it('should fetch fresh data when cache miss', async () => {
      // Test implementation
    });
  });
});
```

#### Frontend Test Structure
```typescript
// frontend/src/components/FlightSearch/FlightSearch.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { FlightSearch } from './FlightSearch';
import { store } from '../../store';

describe('FlightSearch', () => {
  const renderWithProvider = (component: React.ReactElement) =>
    render(<Provider store={store}>{component}</Provider>);

  it('should render flight search form', () => {
    renderWithProvider(<FlightSearch />);
    expect(screen.getByLabelText(/from/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
  });
});
```

### Test Coverage Requirements
- **Minimum 80% coverage** for all components
- **Unit tests** for all service methods
- **Integration tests** for all API endpoints
- **End-to-end tests** for critical user journeys

## 🔒 Security Best Practices

### Authentication & Authorization
```typescript
// Always validate user permissions
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
```

### Input Validation
```typescript
// Always validate and sanitize inputs
import { body, validationResult } from 'express-validator';

const validateFlightSearch = [
  body('from').matches(/^[A-Z]{3}$/).withMessage('Invalid airport code'),
  body('to').matches(/^[A-Z]{3}$/).withMessage('Invalid airport code'),
  body('departDate').isISO8601().withMessage('Invalid date format'),
  // Handle validation errors
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];
```

### Security Monitoring
```typescript
// Log security events
import { auditService } from '../services/security/auditService';

await auditService.logEvent({
  userId: req.user.id,
  action: 'login',
  resource: 'auth',
  outcome: 'success',
  severity: 'medium',
  source: {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    method: req.method,
    path: req.path
  }
});
```

## 🚀 Deployment Guide

### Local Development Deployment
```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.prod.yml up --build
```

### Google Cloud Platform Deployment

#### Prerequisites
```bash
# Install and authenticate with gcloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Set up application default credentials
gcloud auth application-default login
```

#### Using Deployment Script
```bash
cd deployment/gcp
chmod +x deploy.sh

# Set required environment variables
export GCP_PROJECT_ID=your-project-id
export ANTHROPIC_API_KEY=your-key
export AMADEUS_CLIENT_ID=your-client-id
export AMADEUS_CLIENT_SECRET=your-secret

# Run deployment
./deploy.sh
```

#### Using Terraform
```bash
cd deployment/terraform

# Initialize Terraform
terraform init

# Review deployment plan
terraform plan

# Apply infrastructure changes
terraform apply
```

## 📊 Monitoring & Debugging

### Logging
The application uses structured logging with Winston:

```typescript
import { logger } from '../utils/logger';

// Log levels: error, warn, info, debug
logger.info('User logged in', {
  userId: user.id,
  email: user.email,
  timestamp: new Date().toISOString()
});

logger.error('Database connection failed', {
  error: error.message,
  stack: error.stack,
  query: sanitizedQuery
});
```

### Performance Monitoring
```typescript
// Add timing information to logs
const startTime = Date.now();
// ... operation
const duration = Date.now() - startTime;

logger.info('Operation completed', {
  operation: 'flight_search',
  duration,
  cacheHit: true
});
```

### Health Checks
Monitor application health at:
- Backend: `GET /health`
- Frontend: `GET /health`
- Database connectivity
- Redis connectivity
- External API availability

## 🔧 Development Workflow

### Git Workflow
1. Create feature branch: `git checkout -b feature/your-feature-name`
2. Make changes and commit: `git commit -m "feat: add new feature"`
3. Run tests: `npm test`
4. Push branch: `git push origin feature/your-feature-name`
5. Create Pull Request
6. Code review and merge

### Code Style
- **ESLint + Prettier** for code formatting
- **TypeScript** for type safety
- **Conventional Commits** for commit messages
- **Husky** for pre-commit hooks

### Pre-commit Checklist
- [ ] All tests pass (`npm test`)
- [ ] Code is properly formatted (`npm run lint`)
- [ ] TypeScript compiles without errors (`npm run type-check`)
- [ ] No security vulnerabilities (`npm audit`)
- [ ] Documentation is updated if needed

## 🐛 Common Issues & Solutions

### Redis Connection Issues
```bash
# Check if Redis is running
redis-cli ping

# Start Redis server
redis-server

# Check Redis logs
redis-cli monitor
```

### Firebase Authentication Issues
```bash
# Verify Firebase configuration
firebase projects:list

# Check service account permissions
gcloud iam service-accounts list

# Test Firestore connection
gcloud firestore databases list
```

### API Integration Issues
```bash
# Test external APIs
curl -H "Authorization: Bearer $AMADEUS_TOKEN" \
  "https://test.api.amadeus.com/v1/shopping/flight-offers"

# Check API quotas and usage
# Review API documentation for rate limits
```

### Docker Issues
```bash
# Clean up Docker resources
docker system prune -a

# Rebuild containers
docker-compose down
docker-compose up --build

# Check container logs
docker-compose logs backend
docker-compose logs frontend
```

## 📚 Additional Resources

### Documentation
- [API Documentation](http://localhost:8080/api-docs) (when running locally)
- [Frontend Component Library](./COMPONENT_LIBRARY.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [Security Guide](./SECURITY.md)

### External APIs
- [Amadeus API Documentation](https://developers.amadeus.com/)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Google Cloud Platform](https://cloud.google.com/docs)

### Tools & Libraries
- [React Documentation](https://reactjs.org/docs)
- [Redux Toolkit](https://redux-toolkit.js.org/)
- [Material-UI](https://mui.com/)
- [Express.js](https://expressjs.com/)
- [Winston Logger](https://github.com/winstonjs/winston)

## 🤝 Getting Help

### Internal Resources
- **Slack**: #travel-planner-dev channel
- **Wiki**: Internal project documentation
- **Code Reviews**: Tag @team-leads for reviews

### External Resources
- **Stack Overflow**: Tag questions with relevant technologies
- **GitHub Issues**: For bug reports and feature requests
- **Community Forums**: Technology-specific communities

### Contact Information
- **Tech Lead**: tech-lead@company.com
- **DevOps**: devops@company.com
- **Security**: security@company.com

---

Happy coding! 🚀