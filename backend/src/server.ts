import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'

import { config } from '@/config/index.js'
import { logger } from '@/utils/logger.js'
import { errorHandler } from '@/middleware/errorHandler.js'
import { rateLimiter } from '@/middleware/rateLimiter.js'
import { authMiddleware } from '@/middleware/auth.js'
import { requestLogger } from '@/middleware/requestLogger.js'
import { corsOptions } from '@/config/cors.js'

// Route imports
import authRoutes from '@/routes/auth.js'
import userRoutes from '@/routes/user.js'
import searchRoutes from '@/routes/search.js'
import itineraryRoutes from '@/routes/itinerary.js'
import notificationRoutes from '@/routes/notification.js'
import healthRoutes from '@/routes/health.js'

// Service imports
import { initializeFirebase } from '@/config/firebase.js'
import { connectRedis } from '@/config/redis.js'
import { setupWebSocketHandlers } from '@/services/websocket.js'

// Initialize Express app
const app = express()
const httpServer = createServer(app)

// Initialize Socket.IO
const io = new SocketServer(httpServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
})

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
    },
  },
}))

// CORS configuration
app.use(cors(corsOptions))

// Compression middleware
app.use(compression())

// Body parsing middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request logging
app.use(requestLogger)
app.use(morgan('combined', { 
  stream: { write: (message) => logger.info(message.trim()) }
}))

// Rate limiting
app.use(rateLimiter)

// Health check route (no auth required)
app.use('/api/v1/health', healthRoutes)

// API routes
const apiRouter = express.Router()

// Public routes
apiRouter.use('/auth', authRoutes)

// Protected routes
apiRouter.use('/users', authMiddleware, userRoutes)
apiRouter.use('/search', authMiddleware, searchRoutes)
apiRouter.use('/itineraries', authMiddleware, itineraryRoutes)
apiRouter.use('/notifications', authMiddleware, notificationRoutes)

// Mount API router
app.use('/api/v1', apiRouter)

// API documentation route
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'Travel Itinerary Planner API',
    version: '1.0.0',
    description: 'API documentation for the Travel Itinerary Planner',
    baseUrl: '/api/v1',
    endpoints: {
      auth: {
        'POST /auth/login': 'User login',
        'POST /auth/register': 'User registration',
        'POST /auth/refresh': 'Refresh access token',
        'POST /auth/logout': 'User logout',
      },
      users: {
        'GET /users/profile': 'Get user profile',
        'PUT /users/profile': 'Update user profile',
        'GET /users/preferences': 'Get user preferences',
        'PUT /users/preferences': 'Update user preferences',
      },
      search: {
        'POST /search/flights': 'Search flights',
        'POST /search/hotels': 'Search hotels',
        'GET /search/locations': 'Get location suggestions',
        'GET /search/history': 'Get search history',
      },
      itineraries: {
        'POST /itineraries/generate': 'Generate AI itinerary',
        'GET /itineraries': 'Get user itineraries',
        'GET /itineraries/:id': 'Get itinerary details',
        'PUT /itineraries/:id': 'Update itinerary',
        'DELETE /itineraries/:id': 'Delete itinerary',
        'POST /itineraries/:id/share': 'Share itinerary',
      },
      notifications: {
        'GET /notifications': 'Get notifications',
        'PUT /notifications/:id/read': 'Mark notification as read',
        'POST /notifications/alerts': 'Create price alert',
        'POST /notifications/email': 'Send email notification',
      }
    }
  })
})

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Travel Itinerary Planner API',
    version: '1.0.0',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    documentation: '/api/docs'
  })
})

// 404 handler for unmatched routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || 'unknown'
  })
})

// Global error handler
app.use(errorHandler)

// Initialize services
async function initializeServices() {
  try {
    // Initialize Firebase
    await initializeFirebase()
    logger.info('Firebase initialized successfully')

    // Connect to Redis
    await connectRedis()
    logger.info('Redis connected successfully')

    // Setup WebSocket handlers
    setupWebSocketHandlers(io)
    logger.info('WebSocket handlers configured')

    logger.info('All services initialized successfully')
  } catch (error) {
    logger.error('Failed to initialize services:', error)
    process.exit(1)
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`)
  
  // Close HTTP server
  httpServer.close(() => {
    logger.info('HTTP server closed')
  })

  // Close WebSocket server
  io.close(() => {
    logger.info('WebSocket server closed')
  })

  // Give ongoing requests time to complete
  setTimeout(() => {
    logger.info('Forcing shutdown')
    process.exit(0)
  }, 30000) // 30 seconds
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

// Start server
async function startServer() {
  try {
    await initializeServices()
    
    const port = config.port || 8080
    const host = config.host || '0.0.0.0'
    
    httpServer.listen(port, host, () => {
      logger.info(`🚀 Server running on http://${host}:${port}`)
      logger.info(`🌍 Environment: ${config.nodeEnv}`)
      logger.info(`📚 API Documentation: http://${host}:${port}/api/docs`)
      
      if (config.nodeEnv === 'development') {
        logger.info('🔥 Hot reload enabled')
      }
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Export for testing
export { app, httpServer, io }

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}