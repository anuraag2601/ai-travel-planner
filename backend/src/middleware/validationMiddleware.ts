import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationChain } from 'express-validator';
import { logger } from '../utils/logger';
import DOMPurify from 'isomorphic-dompurify';
import { auditService } from '../services/security/auditService';

export interface ValidationOptions {
  sanitize?: boolean;
  logValidationErrors?: boolean;
  createAuditEvent?: boolean;
}

/**
 * Validation middleware that handles validation results
 */
export const handleValidationErrors = (options: ValidationOptions = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorDetails = errors.array();
      
      if (options.logValidationErrors !== false) {
        logger.warn('Validation errors', {
          path: req.path,
          method: req.method,
          errors: errorDetails,
          ip: getClientIp(req),
          userAgent: req.get('User-Agent'),
        });
      }

      if (options.createAuditEvent !== false) {
        try {
          await auditService.logEvent({
            userId: (req as any).user?.id,
            action: 'validation_failure',
            resource: 'input',
            outcome: 'failure',
            severity: 'medium',
            source: {
              ip: getClientIp(req),
              userAgent: req.get('User-Agent') || '',
              method: req.method,
              path: req.path,
            },
            metadata: {
              validationErrors: errorDetails,
              inputValidation: true,
            },
          });
        } catch (auditError) {
          logger.error('Failed to create validation audit event', { auditError });
        }
      }

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorDetails.map(error => ({
          field: error.param,
          message: error.msg,
          value: error.value,
        })),
      });
    }

    // Sanitize input if enabled
    if (options.sanitize !== false) {
      sanitizeRequest(req);
    }

    next();
  };
};

/**
 * Authentication validation rules
 */
export const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required')
    .isLength({ max: 255 })
    .withMessage('Email must be less than 255 characters'),
    
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
    
  handleValidationErrors({ createAuditEvent: true }),
];

export const validateRegister = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required')
    .isLength({ max: 255 })
    .withMessage('Email must be less than 255 characters'),
    
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'),
    
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match password');
      }
      return true;
    }),
    
  body('displayName')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Display name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-_.]+$/)
    .withMessage('Display name contains invalid characters'),
    
  handleValidationErrors({ createAuditEvent: true }),
];

export const validatePasswordReset = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
    
  handleValidationErrors(),
];

/**
 * Flight search validation rules
 */
export const validateFlightSearch = [
  body('from')
    .matches(/^[A-Z]{3}$/)
    .withMessage('From airport must be a valid 3-letter IATA code'),
    
  body('to')
    .matches(/^[A-Z]{3}$/)
    .withMessage('To airport must be a valid 3-letter IATA code'),
    
  body('departDate')
    .isISO8601()
    .withMessage('Departure date must be a valid ISO date')
    .custom((value) => {
      const date = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) {
        throw new Error('Departure date cannot be in the past');
      }
      return true;
    }),
    
  body('returnDate')
    .optional()
    .isISO8601()
    .withMessage('Return date must be a valid ISO date')
    .custom((value, { req }) => {
      if (value) {
        const returnDate = new Date(value);
        const departDate = new Date(req.body.departDate);
        if (returnDate <= departDate) {
          throw new Error('Return date must be after departure date');
        }
      }
      return true;
    }),
    
  body('passengers')
    .isInt({ min: 1, max: 9 })
    .withMessage('Passengers must be between 1 and 9'),
    
  body('class')
    .optional()
    .isIn(['economy', 'business', 'first'])
    .withMessage('Class must be economy, business, or first'),
    
  handleValidationErrors(),
];

/**
 * Hotel search validation rules
 */
export const validateHotelSearch = [
  body('destination')
    .isLength({ min: 2, max: 100 })
    .withMessage('Destination must be between 2 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-,.']+$/)
    .withMessage('Destination contains invalid characters'),
    
  body('checkIn')
    .isISO8601()
    .withMessage('Check-in date must be a valid ISO date')
    .custom((value) => {
      const date = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) {
        throw new Error('Check-in date cannot be in the past');
      }
      return true;
    }),
    
  body('checkOut')
    .isISO8601()
    .withMessage('Check-out date must be a valid ISO date')
    .custom((value, { req }) => {
      const checkOut = new Date(value);
      const checkIn = new Date(req.body.checkIn);
      if (checkOut <= checkIn) {
        throw new Error('Check-out date must be after check-in date');
      }
      return true;
    }),
    
  body('guests')
    .isInt({ min: 1, max: 10 })
    .withMessage('Guests must be between 1 and 10'),
    
  body('rooms')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rooms must be between 1 and 5'),
    
  handleValidationErrors(),
];

/**
 * Itinerary validation rules
 */
export const validateCreateItinerary = [
  body('title')
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters')
    .matches(/^[a-zA-Z0-9\s\-_.,'!?]+$/)
    .withMessage('Title contains invalid characters'),
    
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters'),
    
  body('destination')
    .isLength({ min: 2, max: 100 })
    .withMessage('Destination must be between 2 and 100 characters'),
    
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO date'),
    
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO date')
    .custom((value, { req }) => {
      const endDate = new Date(value);
      const startDate = new Date(req.body.startDate);
      if (endDate <= startDate) {
        throw new Error('End date must be after start date');
      }
      
      // Check maximum trip duration (1 year)
      const maxDuration = 365 * 24 * 60 * 60 * 1000;
      if (endDate.getTime() - startDate.getTime() > maxDuration) {
        throw new Error('Trip duration cannot exceed 1 year');
      }
      
      return true;
    }),
    
  body('budget')
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage('Budget must be between 0 and 1,000,000'),
    
  body('preferences')
    .optional()
    .isArray()
    .withMessage('Preferences must be an array'),
    
  body('preferences.*')
    .optional()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each preference must be between 1 and 50 characters'),
    
  handleValidationErrors(),
];

export const validateUpdateItinerary = [
  param('id')
    .isUUID()
    .withMessage('Invalid itinerary ID'),
    
  body('title')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
    
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters'),
    
  body('budget')
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage('Budget must be between 0 and 1,000,000'),
    
  handleValidationErrors(),
];

/**
 * Common parameter validations
 */
export const validateUUID = (paramName: string) => [
  param(paramName)
    .isUUID()
    .withMessage(`Invalid ${paramName}`),
    
  handleValidationErrors(),
];

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be between 1 and 1000'),
    
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
    
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'title', 'startDate', 'endDate'])
    .withMessage('Invalid sort field'),
    
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),
    
  handleValidationErrors(),
];

/**
 * API key validation
 */
export const validateApiKey = [
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('API key name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-_.]+$/)
    .withMessage('API key name contains invalid characters'),
    
  body('permissions')
    .isArray({ min: 1 })
    .withMessage('Permissions must be a non-empty array'),
    
  body('permissions.*')
    .isIn(['read', 'write', 'delete', 'admin'])
    .withMessage('Invalid permission'),
    
  body('expiryDays')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Expiry days must be between 1 and 365'),
    
  handleValidationErrors({ createAuditEvent: true }),
];

/**
 * File upload validation
 */
export const validateFileUpload = [
  body('file')
    .custom((value, { req }) => {
      if (!req.file) {
        throw new Error('File is required');
      }
      
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        throw new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed');
      }
      
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (req.file.size > maxSize) {
        throw new Error('File size must be less than 5MB');
      }
      
      return true;
    }),
    
  handleValidationErrors(),
];

/**
 * Sanitize request data to prevent XSS and injection attacks
 */
function sanitizeRequest(req: Request): void {
  try {
    // Sanitize body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    
    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }
    
    // Sanitize params
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params);
    }
  } catch (error) {
    logger.error('Failed to sanitize request', { error, path: req.path });
  }
}

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    return DOMPurify.sanitize(obj, { ALLOWED_TAGS: [] });
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = DOMPurify.sanitize(key, { ALLOWED_TAGS: [] });
      sanitized[sanitizedKey] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  const forwarded = req.get('X-Forwarded-For');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  return req.get('X-Real-IP') || 
         req.get('X-Client-IP') || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         'unknown';
}

/**
 * Custom validation for SQL injection prevention
 */
export const preventSQLInjection = (field: string) => {
  return body(field).custom((value) => {
    if (typeof value === 'string') {
      const sqlKeywords = [
        'select', 'insert', 'update', 'delete', 'drop', 'create', 'alter',
        'exec', 'execute', 'union', 'declare', 'cast', 'convert'
      ];
      
      const lowerValue = value.toLowerCase();
      const hasSQLKeywords = sqlKeywords.some(keyword => 
        lowerValue.includes(keyword)
      );
      
      if (hasSQLKeywords) {
        throw new Error('Input contains potentially dangerous content');
      }
    }
    return true;
  });
};

/**
 * Rate limiting validation for sensitive operations
 */
export const validateRateLimit = (operation: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const remaining = res.get('X-RateLimit-Remaining');
    const limit = res.get('X-RateLimit-Limit');
    
    if (remaining && limit) {
      const remainingNum = parseInt(remaining);
      const limitNum = parseInt(limit);
      
      // Log if rate limit is getting close
      if (remainingNum < limitNum * 0.1) { // Less than 10% remaining
        logger.warn('Rate limit approaching', {
          operation,
          remaining: remainingNum,
          limit: limitNum,
          ip: getClientIp(req),
          userId: (req as any).user?.id,
        });
        
        try {
          await auditService.logEvent({
            userId: (req as any).user?.id,
            action: 'rate_limit_warning',
            resource: 'api',
            outcome: 'success',
            severity: 'medium',
            source: {
              ip: getClientIp(req),
              userAgent: req.get('User-Agent') || '',
              method: req.method,
              path: req.path,
            },
            metadata: {
              operation,
              remaining: remainingNum,
              limit: limitNum,
              percentage: (remainingNum / limitNum) * 100,
            },
          });
        } catch (auditError) {
          logger.error('Failed to create rate limit audit event', { auditError });
        }
      }
    }
    
    next();
  };
};