import { jest } from '@jest/globals';

// Mock Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn()
  },
  firestore: jest.fn(() => ({
    collection: jest.fn(),
    doc: jest.fn(),
    batch: jest.fn()
  })),
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn()
  }))
}));

// Mock Redis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
    exists: jest.fn(),
    disconnect: jest.fn()
  }));
});

// Mock external APIs
jest.mock('amadeus', () => ({
  default: jest.fn().mockImplementation(() => ({
    shopping: {
      flightOffersSearch: {
        get: jest.fn()
      },
      hotelOffersSearch: {
        get: jest.fn()
      }
    },
    referenceData: {
      locations: {
        get: jest.fn()
      }
    }
  }))
}));

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn()
    }
  }))
}));

// Mock Winston logger
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    printf: jest.fn(),
    colorize: jest.fn()
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn()
  }
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.AMADEUS_CLIENT_ID = 'test-amadeus-id';
process.env.AMADEUS_CLIENT_SECRET = 'test-amadeus-secret';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FIRESTORE_PROJECT_ID = 'test-project';

// Global test timeout
jest.setTimeout(10000);

// Cleanup function
afterEach(() => {
  jest.clearAllMocks();
});