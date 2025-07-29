import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import authRouter from '../../routes/auth.js';

// Mock dependencies
const mockFirebaseService = {
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  verifyIdToken: jest.fn(),
};

jest.mock('../../services/external/firebaseService.js', () => ({
  FirebaseService: jest.fn(() => mockFirebaseService)
}));

jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../middleware/asyncHandler.js', () => ({
  asyncHandler: (fn: any) => fn
}));

jest.mock('../../middleware/rateLimiter.js', () => ({
  rateLimiter: () => (req: any, res: any, next: any) => next()
}));

// Create test app
const app = express();
app.use(express.json());
app.use((req: any, res: any, next: any) => {
  req.id = 'test-request-id';
  next();
});
app.use('/auth', authRouter);

describe('Auth API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    const validRegistrationData = {
      email: 'test@example.com',
      password: 'Password123',
      firstName: 'John',
      lastName: 'Doe'
    };

    it('should register a user successfully', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: false
      };

      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/auth/register')
        .send(validRegistrationData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe('user123');
      expect(response.body.data.email).toBe('test@example.com');
      expect(response.body.message).toBe('User registered successfully');

      expect(mockFirebaseService.createUser).toHaveBeenCalledWith(
        'test@example.com',
        'Password123',
        'John Doe'
      );
    });

    it('should return validation error for invalid email', async () => {
      const invalidData = {
        ...validRegistrationData,
        email: 'invalid-email'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid input parameters');
    });

    it('should return validation error for weak password', async () => {
      const invalidData = {
        ...validRegistrationData,
        password: '123'
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for missing required fields', async () => {
      const invalidData = {
        email: 'test@example.com'
        // Missing password, firstName, lastName
      };

      const response = await request(app)
        .post('/auth/register')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle email already exists error', async () => {
      mockFirebaseService.createUser.mockRejectedValue(new Error('Email already exists'));

      const response = await request(app)
        .post('/auth/register')
        .send(validRegistrationData);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_004');
      expect(response.body.error.message).toBe('Email already exists');
    });

    it('should handle invalid email error', async () => {
      mockFirebaseService.createUser.mockRejectedValue(new Error('Invalid email address'));

      const response = await request(app)
        .post('/auth/register')
        .send(validRegistrationData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid email address');
    });

    it('should handle weak password error', async () => {
      mockFirebaseService.createUser.mockRejectedValue(new Error('Password is too weak'));

      const response = await request(app)
        .post('/auth/register')
        .send(validRegistrationData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Password is too weak');
    });

    it('should handle generic registration errors', async () => {
      mockFirebaseService.createUser.mockRejectedValue(new Error('Internal server error'));

      const response = await request(app)
        .post('/auth/register')
        .send(validRegistrationData);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_005');
      expect(response.body.error.message).toBe('Registration failed');
    });
  });

  describe('POST /auth/login', () => {
    const validLoginData = {
      email: 'test@example.com',
      password: 'Password123'
    };

    it('should login successfully', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: true
      };

      mockFirebaseService.getUserByEmail.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/auth/login')
        .send(validLoginData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.userId).toBe('user123');
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.message).toBe('Login successful');

      expect(mockFirebaseService.getUserByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should return validation error for invalid email', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'Password123'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for missing password', async () => {
      const invalidData = {
        email: 'test@example.com'
        // Missing password
      };

      const response = await request(app)
        .post('/auth/login')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle user not found', async () => {
      mockFirebaseService.getUserByEmail.mockResolvedValue(null);

      const response = await request(app)
        .post('/auth/login')
        .send(validLoginData);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_001');
      expect(response.body.error.message).toBe('Invalid credentials');
    });

    it('should handle unverified email', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: false
      };

      mockFirebaseService.getUserByEmail.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/auth/login')
        .send(validLoginData);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_002');
      expect(response.body.error.message).toBe('Account not verified');
    });

    it('should handle login service errors', async () => {
      mockFirebaseService.getUserByEmail.mockRejectedValue(new Error('Service unavailable'));

      const response = await request(app)
        .post('/auth/login')
        .send(validLoginData);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_005');
      expect(response.body.error.message).toBe('Login failed');
    });
  });

  describe('POST /auth/verify', () => {
    const validTokenData = {
      idToken: 'valid-firebase-id-token'
    };

    it('should verify token successfully', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        email_verified: true
      };

      const mockUser = {
        uid: 'user123',
        displayName: 'John Doe',
        preferences: {
          currency: 'USD',
          language: 'en'
        }
      };

      mockFirebaseService.verifyIdToken.mockResolvedValue(mockDecodedToken);
      mockFirebaseService.getUserById.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/auth/verify')
        .send(validTokenData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.uid).toBe('user123');
      expect(response.body.data.email).toBe('test@example.com');
      expect(response.body.data.user.displayName).toBe('John Doe');
      expect(response.body.message).toBe('Token verified successfully');

      expect(mockFirebaseService.verifyIdToken).toHaveBeenCalledWith('valid-firebase-id-token');
      expect(mockFirebaseService.getUserById).toHaveBeenCalledWith('user123');
    });

    it('should return validation error for missing token', async () => {
      const response = await request(app)
        .post('/auth/verify')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle invalid token', async () => {
      mockFirebaseService.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      const response = await request(app)
        .post('/auth/verify')
        .send(validTokenData);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_003');
      expect(response.body.error.message).toBe('Invalid token');
    });

    it('should handle user not found after token verification', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        email_verified: true
      };

      mockFirebaseService.verifyIdToken.mockResolvedValue(mockDecodedToken);
      mockFirebaseService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .post('/auth/verify')
        .send(validTokenData);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_001');
      expect(response.body.error.message).toBe('Invalid token');
    });
  });

  describe('Response Format', () => {
    it('should have consistent response format for success', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: false
      };

      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123',
          firstName: 'John',
          lastName: 'Doe'
        });

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
      
      // Validate timestamp format
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });

    it('should have consistent response format for errors', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'weak'
        });

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('details');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
      
      // Validate timestamp format
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: false
      };

      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123',
          firstName: 'John',
          lastName: 'Doe'
        });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });
});