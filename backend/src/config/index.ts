import dotenv from 'dotenv'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load environment variables
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '../../.env') })

// Validate required environment variables
const requiredEnvVars = [
  'NODE_ENV',
  'FIRESTORE_PROJECT_ID',
  'ANTHROPIC_API_KEY',
  'AMADEUS_CLIENT_ID',
  'AMADEUS_CLIENT_SECRET',
  'JWT_SECRET',
] as const

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

// Configuration object
export const config = {
  // Server configuration
  nodeEnv: process.env.NODE_ENV as 'development' | 'production' | 'test',
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // Database configuration
  firestore: {
    projectId: process.env.FIRESTORE_PROJECT_ID!,
    credentialsPath: process.env.FIRESTORE_CREDENTIALS_PATH,
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  },

  // Cache configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    db: parseInt(process.env.REDIS_DB || '0', 10),
    ttl: {
      default: 3600, // 1 hour
      flightSearch: 900, // 15 minutes
      hotelSearch: 1800, // 30 minutes
      userSession: 86400, // 24 hours
      locationSearch: 86400, // 24 hours
      exchangeRates: 21600, // 6 hours
    },
  },

  // Authentication configuration
  auth: {
    jwtSecret: process.env.JWT_SECRET!,
    jwtExpiration: process.env.JWT_EXPIRATION || '1h',
    refreshTokenExpiration: process.env.REFRESH_TOKEN_EXPIRATION || '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '300000', 10), // 5 minutes
  },

  // External APIs configuration
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229',
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4000', 10),
    temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || '0.7'),
    timeout: parseInt(process.env.ANTHROPIC_TIMEOUT || '60000', 10), // 60 seconds
  },

  amadeus: {
    clientId: process.env.AMADEUS_CLIENT_ID!,
    clientSecret: process.env.AMADEUS_CLIENT_SECRET!,
    environment: (process.env.AMADEUS_ENVIRONMENT as 'test' | 'production') || 'test',
    timeout: parseInt(process.env.AMADEUS_TIMEOUT || '30000', 10), // 30 seconds
    retries: parseInt(process.env.AMADEUS_RETRIES || '3', 10),
  },

  // Google Cloud configuration
  gcp: {
    projectId: process.env.GCP_PROJECT_ID || process.env.FIRESTORE_PROJECT_ID!,
    region: process.env.GCP_REGION || 'us-central1',
    storageBasketName: process.env.GCP_STORAGE_BUCKET,
    secretManagerPrefix: process.env.SECRET_MANAGER_PREFIX || 'travel-planner',
  },

  // Email configuration
  email: {
    service: process.env.EMAIL_SERVICE || 'sendgrid',
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.FROM_EMAIL || 'noreply@travel-planner.com',
      fromName: process.env.FROM_NAME || 'Travel Planner',
    },
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10), // 100 requests per window
    message: process.env.RATE_LIMIT_MESSAGE || 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  },

  // File upload configuration
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    allowedMimetypes: process.env.ALLOWED_MIMETYPES?.split(',') || [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ],
    destination: process.env.UPLOAD_DESTINATION || 'uploads/',
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    file: {
      enabled: process.env.LOG_FILE_ENABLED === 'true',
      path: process.env.LOG_FILE_PATH || 'logs/app.log',
      maxSize: process.env.LOG_FILE_MAX_SIZE || '10m',
      maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES || '5', 10),
    },
  },

  // WebSocket configuration
  websocket: {
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '60000', 10),
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '25000', 10),
    maxHttpBufferSize: parseInt(process.env.WS_MAX_HTTP_BUFFER_SIZE || '1e6', 10),
  },

  // Security configuration
  security: {
    enableHttps: process.env.ENABLE_HTTPS === 'true',
    httpsPort: parseInt(process.env.HTTPS_PORT || '8443', 10),
    sslCert: process.env.SSL_CERT_PATH,
    sslKey: process.env.SSL_KEY_PATH,
    trustProxy: process.env.TRUST_PROXY === 'true',
    sessionSecret: process.env.SESSION_SECRET || 'fallback-session-secret',
  },

  // Feature flags
  features: {
    enableAnalytics: process.env.ENABLE_ANALYTICS !== 'false',
    enablePriceAlerts: process.env.ENABLE_PRICE_ALERTS !== 'false',
    enableEmailNotifications: process.env.ENABLE_EMAIL_NOTIFICATIONS !== 'false',
    enablePushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS !== 'false',
    enableFileUpload: process.env.ENABLE_FILE_UPLOAD !== 'false',
    enableRealTimeUpdates: process.env.ENABLE_REAL_TIME_UPDATES !== 'false',
  },

  // Development configuration
  dev: {
    enableSwagger: process.env.ENABLE_SWAGGER === 'true',
    enableDebugLogs: process.env.ENABLE_DEBUG_LOGS === 'true',
    mockExternalApis: process.env.MOCK_EXTERNAL_APIS === 'true',
  },
} as const

// Validate configuration
export function validateConfig() {
  const errors: string[] = []

  // Validate port
  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('Invalid port number')
  }

  // Validate JWT secret
  if (config.auth.jwtSecret.length < 32) {
    errors.push('JWT secret must be at least 32 characters long')
  }

  // Validate bcrypt rounds
  if (config.auth.bcryptRounds < 10 || config.auth.bcryptRounds > 15) {
    errors.push('Bcrypt rounds must be between 10 and 15')
  }

  // Validate Anthropic configuration
  if (!config.anthropic.apiKey.startsWith('sk-ant-')) {
    errors.push('Invalid Anthropic API key format')
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`)
  }

  return true
}

// Initialize configuration validation
if (config.nodeEnv !== 'test') {
  validateConfig()
}

export default config