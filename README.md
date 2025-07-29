# Travel Itinerary Planner

A comprehensive AI-powered travel itinerary planning application built with Node.js, React, and Google Cloud Platform. This production-ready application helps users plan, organize, and manage their travel itineraries with intelligent recommendations powered by Claude AI, featuring enterprise-grade security, comprehensive testing, and automated deployment.

## 🌟 Features

### Core Functionality
- **AI-Powered Itinerary Generation**: Leverages Anthropic's Claude AI for intelligent travel recommendations
- **Flight & Hotel Search**: Integrated with Amadeus API for real-time travel data
- **User Authentication**: Secure Firebase Authentication with role-based access control
- **Real-time Collaboration**: Share and collaborate on itineraries with others
- **Price Alerts**: Get notified when flight or hotel prices change
- **Offline Support**: Progressive Web App with offline capabilities
- **Export Functionality**: Export itineraries to PDF or send via email

### Security & Monitoring
- **API Key Rotation**: Automated security key management with configurable rotation schedules
- **Rate Limiting**: Redis-backed rate limiting to prevent abuse and ensure fair usage
- **Comprehensive Audit Logging**: Track all user activities and security events with detailed metadata
- **Input Validation**: Robust validation middleware to prevent injection attacks and XSS
- **Security Monitoring**: Real-time threat detection, pattern analysis, and automated alerting
- **Threat Detection**: ML-based suspicious activity detection with configurable response actions

### Developer Experience
- **Comprehensive Testing**: 80%+ test coverage with unit, integration, and end-to-end tests
- **CI/CD Pipeline**: Automated testing, security scanning, and deployment with GitHub Actions
- **Infrastructure as Code**: Complete Terraform configuration for GCP resources
- **Docker Support**: Multi-stage containerized builds for consistent deployment
- **Monitoring & Logging**: Winston logging with Google Cloud integration and structured JSON output
- **API Documentation**: Interactive Swagger/OpenAPI documentation with examples

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Redux Toolkit** with RTK Query for state management
- **Material-UI (MUI) v5** for UI components
- **Vite** for build tooling and development server
- **PWA** capabilities for offline access

### Backend
- **Node.js 18 LTS** with Express.js
- **TypeScript** for type safety
- **Google Cloud Firestore** for database
- **Redis** (Google Memorystore) for caching
- **Firebase Authentication** for user management

### External APIs
- **Anthropic Claude API** for AI itinerary generation
- **Amadeus API** for flights and hotels data
- **Google Maps API** for location services

### Infrastructure
- **Google Cloud Platform** (GCP)
- **Cloud Run** for containerized deployment
- **Cloud CDN** for global content delivery
- **Cloud Monitoring** for observability

## Project Structure

```
travel-itinerary-planner/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Route-level components
│   │   ├── store/           # Redux store and slices
│   │   ├── services/        # API services
│   │   ├── hooks/           # Custom React hooks
│   │   ├── utils/           # Utility functions
│   │   └── types/           # TypeScript type definitions
│   ├── public/              # Static assets
│   └── package.json
├── backend/                 # Node.js backend API
│   ├── src/
│   │   ├── routes/          # API route handlers
│   │   ├── services/        # Business logic services
│   │   ├── models/          # Data models
│   │   ├── middleware/      # Express middleware
│   │   ├── config/          # Configuration files
│   │   └── utils/           # Utility functions
│   └── package.json
├── deployment/              # Deployment configurations
│   ├── gcp/                 # Google Cloud Platform configs
│   └── docker/              # Docker configurations
├── docs/                    # Documentation
├── scripts/                 # Build and deployment scripts
└── .github/workflows/       # CI/CD workflows
```

## Quick Start

### Prerequisites
- Node.js 18 or higher
- npm 8 or higher
- Google Cloud Platform account
- Anthropic API key
- Amadeus API credentials

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/travel-itinerary-planner.git
cd travel-itinerary-planner
```

2. Install dependencies:
```bash
npm run setup
```

3. Set up environment variables:
```bash
# Copy environment templates
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit the .env files with your API keys and configuration
```

4. Start the development servers:
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000` and the backend at `http://localhost:8080`.

### Environment Variables

#### Backend (.env)
```env
# Server Configuration
NODE_ENV=development
PORT=8080
CORS_ORIGIN=http://localhost:3000

# Database
FIRESTORE_PROJECT_ID=your-project-id
FIRESTORE_CREDENTIALS_PATH=./path/to/service-account.json

# Cache
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-redis-password

# External APIs
ANTHROPIC_API_KEY=your-anthropic-api-key
AMADEUS_CLIENT_ID=your-amadeus-client-id
AMADEUS_CLIENT_SECRET=your-amadeus-client-secret

# Authentication
JWT_SECRET=your-jwt-secret
FIREBASE_ADMIN_SDK_PATH=./path/to/firebase-admin-sdk.json

# Email (for notifications)
SENDGRID_API_KEY=your-sendgrid-api-key
FROM_EMAIL=noreply@yourdomain.com
```

#### Frontend (.env)
```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

## Development

### Running Tests
```bash
# Run all tests
npm run test

# Run frontend tests only
npm run test:frontend

# Run backend tests only
npm run test:backend
```

### Linting and Code Formatting
```bash
# Run linting for all projects
npm run lint

# Run linting for frontend only
npm run lint:frontend

# Run linting for backend only
npm run lint:backend
```

### Building for Production
```bash
# Build all projects
npm run build

# Build frontend only
npm run build:frontend

# Build backend only
npm run build:backend
```

## Deployment

### Google Cloud Platform

1. Set up GCP project and enable required APIs:
   - Cloud Run API
   - Cloud Firestore API
   - Cloud Storage API
   - Cloud CDN API
   - Cloud Monitoring API

2. Configure authentication:
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

3. Deploy to Cloud Run:
```bash
npm run deploy
```

### Environment Setup

Detailed setup instructions for different environments:

- [Development Setup](docs/development-setup.md)
- [Production Deployment](docs/production-deployment.md)
- [GCP Configuration](docs/gcp-configuration.md)

## API Documentation

The API follows RESTful principles with comprehensive documentation available at:
- Development: `http://localhost:8080/api/docs`
- Production: `https://your-domain.com/api/docs`

### Key Endpoints

- `POST /api/v1/auth/login` - User authentication
- `POST /api/v1/search/flights` - Search flights
- `POST /api/v1/search/hotels` - Search hotels  
- `POST /api/v1/itineraries/generate` - Generate AI itinerary
- `GET /api/v1/itineraries/{id}` - Get itinerary details
- `PUT /api/v1/itineraries/{id}` - Update itinerary

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- Use TypeScript for all new code
- Follow the existing code style and conventions
- Write tests for new features
- Update documentation as needed

## Security

- All API endpoints require authentication
- Input validation and sanitization on all user inputs
- Rate limiting implemented on all endpoints
- HTTPS/TLS encryption for all data transmission
- Secure secret management using Google Secret Manager

## Performance

- Redis caching for external API responses
- CDN for static asset delivery
- Database query optimization with proper indexing
- Lazy loading and code splitting in frontend
- Auto-scaling infrastructure on Google Cloud Platform

## Monitoring and Logging

- Application performance monitoring with Google Cloud Monitoring
- Error tracking and alerting with Sentry
- Structured logging with JSON format
- Health checks and uptime monitoring
- Real-time metrics and dashboards

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Email: support@yourdomain.com
- Documentation: [docs/](docs/)

## Roadmap

- [ ] Multi-city trip planning
- [ ] Group travel coordination
- [ ] Mobile application (React Native)
- [ ] Advanced analytics and insights
- [ ] Travel document management
- [ ] Integration with additional booking platforms