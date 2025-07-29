import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { FirebaseService } from '../services/external/firebaseService.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { rateLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const firebaseService = new FirebaseService();

// Register endpoint
router.post('/register',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 5 }), // 5 requests per 15 minutes
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    body('firstName').isLength({ min: 1, max: 50 }).trim(),
    body('lastName').isLength({ min: 1, max: 50 }).trim(),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const { email, password, firstName, lastName } = req.body;
    const displayName = `${firstName} ${lastName}`;

    try {
      const user = await firebaseService.createUser(email, password, displayName);

      logger.info('User registered successfully', {
        userId: user.uid,
        email: user.email,
        requestId: req.id
      });

      res.status(201).json({
        success: true,
        data: {
          userId: user.uid,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerified
        },
        message: 'User registered successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('User registration failed', {
        error: error.message,
        email,
        requestId: req.id
      });

      if (error.message === 'Email already exists') {
        return res.status(409).json({
          success: false,
          error: {
            code: 'AUTH_004',
            message: 'Email already exists',
            details: { field: 'email', reason: 'This email is already registered' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (error.message === 'Invalid email address') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid email address',
            details: { field: 'email', reason: 'Please provide a valid email address' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (error.message === 'Password is too weak') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password is too weak',
            details: { field: 'password', reason: 'Password must be at least 8 characters with uppercase, lowercase, and number' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_005',
          message: 'Registration failed',
          details: { reason: 'Internal server error during registration' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Login endpoint
router.post('/login',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }), // 10 requests per 15 minutes
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 1 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const { email, password } = req.body;

    try {
      // Note: In a real implementation, you would verify the password
      // Firebase Client SDK handles authentication, this endpoint might
      // be used for custom token generation or session management
      
      const user = await firebaseService.getUserByEmail(email);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid credentials',
            details: { reason: 'Email or password is incorrect' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (!user.emailVerified) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_002',
            message: 'Account not verified',
            details: { reason: 'Please verify your email address before logging in' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      logger.info('User login successful', {
        userId: user.uid,
        email: user.email,
        requestId: req.id
      });

      res.status(200).json({
        success: true,
        data: {
          user: {
            userId: user.uid,
            email: user.email,
            displayName: user.displayName,
            emailVerified: user.emailVerified
          }
        },
        message: 'Login successful',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('User login failed', {
        error: error.message,
        email,
        requestId: req.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_005',
          message: 'Login failed',
          details: { reason: 'Internal server error during login' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Verify token endpoint
router.post('/verify',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 100 }), // 100 requests per 15 minutes
  [
    body('idToken').isLength({ min: 1 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const { idToken } = req.body;

    try {
      const decodedToken = await firebaseService.verifyIdToken(idToken);
      const user = await firebaseService.getUserById(decodedToken.uid);

      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_001',
            message: 'Invalid token',
            details: { reason: 'User not found' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      res.status(200).json({
        success: true,
        data: {
          uid: decodedToken.uid,
          email: decodedToken.email,
          emailVerified: decodedToken.email_verified,
          user: {
            displayName: user.displayName,
            preferences: user.preferences
          }
        },
        message: 'Token verified successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Token verification failed', {
        error: error.message,
        requestId: req.id
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'Invalid token',
          details: { reason: 'Token verification failed' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

export default router;