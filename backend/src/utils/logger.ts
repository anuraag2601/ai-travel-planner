import winston from 'winston';
import { config } from '../config/index.js';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Create the logger configuration
const loggerConfig: winston.LoggerOptions = {
  level: config.env === 'development' ? 'debug' : 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      let log = `${timestamp} [${level}]: ${message}`;
      
      // Add metadata if present
      if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta, null, 2)}`;
      }
      
      // Add stack trace for errors
      if (stack) {
        log += `\n${stack}`;
      }
      
      return log;
    })
  ),
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let log = `${timestamp} [${level}]: ${message}`;
          
          if (Object.keys(meta).length > 0) {
            log += ` ${JSON.stringify(meta, null, 2)}`;
          }
          
          return log;
        })
      ),
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.uncolorize(),
        winston.format.json()
      ),
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.uncolorize(),
        winston.format.json()
      ),
    }),
  ],
  
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' }),
  ],
};

// Add additional transports for production
if (config.env === 'production') {
  // Remove console transport in production
  loggerConfig.transports = loggerConfig.transports?.filter(
    transport => !(transport instanceof winston.transports.Console)
  );
  
  // Add structured logging for production
  loggerConfig.format = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, stack, requestId, userId, ...meta }) => {
      const logEntry = {
        timestamp,
        level,
        message,
        requestId,
        userId,
        ...meta,
      };
      
      if (stack) {
        logEntry.stack = stack;
      }
      
      return JSON.stringify(logEntry);
    })
  );
}

// Create the logger instance
export const logger = winston.createLogger(loggerConfig);

// Create structured logging methods
export const structuredLogger = {
  info: (message: string, meta: Record<string, any> = {}) => {
    logger.info(message, meta);
  },
  
  error: (message: string, error?: Error | string, meta: Record<string, any> = {}) => {
    if (error instanceof Error) {
      logger.error(message, { ...meta, error: error.message, stack: error.stack });
    } else if (typeof error === 'string') {
      logger.error(message, { ...meta, error });
    } else {
      logger.error(message, meta);
    }
  },
  
  warn: (message: string, meta: Record<string, any> = {}) => {
    logger.warn(message, meta);
  },
  
  debug: (message: string, meta: Record<string, any> = {}) => {
    logger.debug(message, meta);
  },
  
  http: (message: string, meta: Record<string, any> = {}) => {
    logger.http(message, meta);
  },
};

// Request logging middleware
export const requestLogger = (req: any, res: any, next: any) => {
  const startTime = Date.now();
  
  // Generate unique request ID
  req.id = req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log request start
  logger.http('Request started', {
    requestId: req.id,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.uid,
  });
  
  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    
    // Log response
    logger.http('Request completed', {
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.uid,
      success: body?.success,
      errorCode: body?.error?.code,
    });
    
    return originalJson.call(this, body);
  };
  
  next();
};

// Audit logging for sensitive operations
export const auditLogger = {
  userAction: (action: string, userId: string, details: Record<string, any> = {}) => {
    logger.info('User action audit', {
      type: 'USER_ACTION',
      action,
      userId,
      timestamp: new Date().toISOString(),
      ...details,
    });
  },
  
  dataAccess: (resource: string, userId: string, operation: string, details: Record<string, any> = {}) => {
    logger.info('Data access audit', {
      type: 'DATA_ACCESS',
      resource,
      operation,
      userId,
      timestamp: new Date().toISOString(),
      ...details,
    });
  },
  
  securityEvent: (event: string, details: Record<string, any> = {}) => {
    logger.warn('Security event', {
      type: 'SECURITY_EVENT',
      event,
      timestamp: new Date().toISOString(),
      ...details,
    });
  },
  
  systemEvent: (event: string, details: Record<string, any> = {}) => {
    logger.info('System event', {
      type: 'SYSTEM_EVENT',
      event,
      timestamp: new Date().toISOString(),
      ...details,
    });
  },
};

// Performance logging
export const performanceLogger = {
  measureTime: (operation: string) => {
    const startTime = process.hrtime.bigint();
    
    return {
      end: (meta: Record<string, any> = {}) => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
        
        logger.debug('Performance measurement', {
          operation,
          duration: `${duration.toFixed(2)}ms`,
          ...meta,
        });
        
        return duration;
      },
    };
  },
  
  logMemoryUsage: () => {
    const memUsage = process.memoryUsage();
    
    logger.debug('Memory usage', {
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`,
    });
  },
};

// Error logging helper
export const logError = (error: Error, context: Record<string, any> = {}) => {
  logger.error('Unhandled error', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...context,
  });
};

// Log application startup
logger.info('Logger initialized', {
  level: loggerConfig.level,
  env: config.env,
  timestamp: new Date().toISOString(),
});

export default logger;