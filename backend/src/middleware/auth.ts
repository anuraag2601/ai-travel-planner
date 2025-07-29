import { Request, Response, NextFunction } from 'express';
import { FirebaseService } from '../services/external/firebaseService.js';
import { logger } from '../utils/logger.js';

const firebaseService = new FirebaseService();

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email?: string;
        emailVerified?: boolean;
        customClaims?: Record<string, any>;
      };
    }
  }
}

/**
 * Authentication middleware that verifies Firebase ID tokens
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_001',
          message: 'Authentication required',
          details: { reason: 'Missing or invalid authorization header' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_001',
          message: 'Authentication required',
          details: { reason: 'Missing ID token' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    // Verify the ID token with Firebase
    const decodedToken = await firebaseService.verifyIdToken(idToken);
    
    // Get additional user data from Firestore
    const user = await firebaseService.getUserById(decodedToken.uid);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_001',
          message: 'Invalid authentication',
          details: { reason: 'User not found' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    // Check if user account is disabled
    if (user.disabled) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_006',
          message: 'Account disabled',
          details: { reason: 'Your account has been disabled' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    // Attach user information to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      customClaims: decodedToken.custom_claims
    };

    logger.info('User authenticated successfully', {
      userId: req.user.uid,
      email: req.user.email,
      path: req.path,
      method: req.method,
      requestId: (req as any).id
    });

    next();
  } catch (error: any) {
    logger.error('Authentication failed', {
      error: error.message,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: (req as any).id
    });

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'Token expired',
          details: { reason: 'Your session has expired, please login again' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'Token revoked',
          details: { reason: 'Your session has been revoked, please login again' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_003',
          message: 'Invalid token',
          details: { reason: 'The provided authentication token is invalid' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    // Generic authentication error
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_001',
        message: 'Authentication failed',
        details: { reason: 'Unable to verify authentication token' }
      },
      timestamp: new Date().toISOString(),
      requestId: (req as any).id
    });
  }
};

/**
 * Optional authentication middleware - sets user if token is provided but doesn't require it
 */
export const optionalAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth header provided, continue without user
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return next();
    }

    try {
      const decodedToken = await firebaseService.verifyIdToken(idToken);
      const user = await firebaseService.getUserById(decodedToken.uid);
      
      if (user && !user.disabled) {
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          emailVerified: decodedToken.email_verified,
          customClaims: decodedToken.custom_claims
        };
      }
    } catch (error) {
      // Ignore auth errors in optional middleware
      logger.debug('Optional auth failed', { error: (error as Error).message });
    }

    next();
  } catch (error) {
    // Continue without authentication on any error
    next();
  }
};

/**
 * Admin-only authentication middleware
 */
export const adminAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // First run regular auth middleware
  await authMiddleware(req, res, (error) => {
    if (error) return next(error);

    // Check if user has admin role
    const isAdmin = req.user?.customClaims?.admin === true;
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_007',
          message: 'Admin access required',
          details: { reason: 'This operation requires admin privileges' }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    logger.info('Admin user authenticated', {
      userId: req.user?.uid,
      path: req.path,
      method: req.method,
      requestId: (req as any).id
    });

    next();
  });
};

/**
 * Email verification required middleware
 */
export const emailVerificationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.emailVerified) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_002',
        message: 'Email verification required',
        details: { reason: 'Please verify your email address to access this feature' }
      },
      timestamp: new Date().toISOString(),
      requestId: (req as any).id
    });
  }

  next();
};

/**
 * Role-based authorization middleware factory
 */
export const requireRole = (roles: string | string[]) => {
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req: Request, res: Response, next: NextFunction) => {
    const userRoles = req.user?.customClaims?.roles || [];
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));
    
    if (!hasRequiredRole) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_007',
          message: 'Insufficient permissions',
          details: { 
            reason: `This operation requires one of these roles: ${requiredRoles.join(', ')}`,
            requiredRoles,
            userRoles
          }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    }

    next();
  };
};