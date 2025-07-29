import rateLimit from 'express-rate-limit';
import { RedisService } from '../services/redis.js';
import { logger } from '../utils/logger.js';

const redisService = new RedisService();

interface RateLimiterOptions {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum number of requests per window
  message?: string; // Custom error message
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

/**
 * Create a rate limiter middleware with Redis store
 */
export const rateLimiter = (options: RateLimiterOptions) => {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: {
        code: 'API_002',
        message: 'Rate limit exceeded',
        details: { reason: message }
      },
      timestamp: new Date().toISOString()
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests,
    skipFailedRequests,
    
    // Use Redis as the store for distributed rate limiting
    store: {
      async increment(key: string): Promise<{ totalHits: number; resetTime?: Date }> {
        try {
          const redisKey = `ratelimit:${key}`;
          const current = await redisService.get(redisKey);
          
          if (current === null) {
            // First request in window
            await redisService.setex(redisKey, Math.ceil(windowMs / 1000), '1');
            return {
              totalHits: 1,
              resetTime: new Date(Date.now() + windowMs)
            };
          } else {
            // Increment existing count
            const newCount = await redisService.incr(redisKey);
            const ttl = await redisService.ttl(redisKey);
            
            return {
              totalHits: newCount,
              resetTime: new Date(Date.now() + (ttl * 1000))
            };
          }
        } catch (error) {
          logger.error('Rate limiter Redis error:', error);
          // Fallback to in-memory counting if Redis fails
          return { totalHits: 1 };
        }
      },
      
      async decrement(key: string): Promise<void> {
        try {
          const redisKey = `ratelimit:${key}`;
          await redisService.decr(redisKey);
        } catch (error) {
          logger.error('Rate limiter Redis decrement error:', error);
        }
      },
      
      async resetKey(key: string): Promise<void> {
        try {
          const redisKey = `ratelimit:${key}`;
          await redisService.del(redisKey);
        } catch (error) {
          logger.error('Rate limiter Redis reset error:', error);
        }
      }
    },

    // Custom key generator based on user ID if authenticated, otherwise IP
    keyGenerator: (req: any) => {
      if (req.user?.uid) {
        return `user:${req.user.uid}`;
      }
      return req.ip || req.connection.remoteAddress || 'unknown';
    },

    // Custom handler for when rate limit is exceeded
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.uid,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent')
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'API_002',
          message: 'Rate limit exceeded',
          details: { 
            reason: message,
            retryAfter: Math.ceil(windowMs / 1000)
          }
        },
        timestamp: new Date().toISOString(),
        requestId: (req as any).id
      });
    },

    // Skip rate limiting for certain conditions
    skip: (req) => {
      // Skip rate limiting for health checks
      if (req.path === '/health' || req.path === '/api/health') {
        return true;
      }
      
      // Skip for internal requests (if you have internal API calls)
      const userAgent = req.get('User-Agent') || '';
      if (userAgent.includes('internal-service')) {
        return true;
      }

      return false;
    }
  });
};

/**
 * Global rate limiter for all requests
 */
export const globalRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP/user to 1000 requests per windowMs
  message: 'Too many requests from this client, please try again later.'
});

/**
 * Strict rate limiter for sensitive operations
 */
export const strictRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Very limited requests per hour
  message: 'Too many attempts for this operation, please try again later.'
});

/**
 * Auth rate limiter for login/register endpoints
 */
export const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit to 5 login attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later.',
  skipSuccessfulRequests: true // Don't count successful logins
});

/**
 * Search rate limiter for search endpoints
 */
export const searchRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: 'Too many search requests, please slow down.'
});

/**
 * AI generation rate limiter for expensive operations
 */
export const aiRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Very limited AI generations per minute
  message: 'AI generation requests are limited, please wait before trying again.'
});