import { Request, Response, NextFunction } from 'express';
import { auditService } from '../services/security/auditService';
import { logger } from '../utils/logger';

export interface AuditRequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
  sessionId?: string;
  startTime?: number;
}

export interface AuditOptions {
  action?: string;
  resource?: string;
  resourceId?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  skipAudit?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Audit middleware to log all API requests
 */
export const auditMiddleware = (options: AuditOptions = {}) => {
  return async (req: AuditRequest, res: Response, next: NextFunction) => {
    try {
      // Skip audit if explicitly disabled
      if (options.skipAudit) {
        return next();
      }

      // Record start time for performance metrics
      req.startTime = Date.now();

      // Extract request information
      const ip = getClientIp(req);
      const userAgent = req.get('User-Agent') || '';
      const referer = req.get('Referer');
      
      // Determine action and resource
      const action = options.action || deriveAction(req.method, req.path);
      const resource = options.resource || deriveResource(req.path);
      const resourceId = options.resourceId || extractResourceId(req.path, req.params);

      // Determine severity based on action and resource
      const severity = options.severity || deriveSeverity(action, resource, req.method);

      // Store audit context in request for later use
      (req as any).auditContext = {
        action,
        resource,
        resourceId,
        severity,
        startTime: req.startTime,
        metadata: {
          ...options.metadata,
          method: req.method,
          path: req.path,
          query: sanitizeQuery(req.query),
          bodySize: req.get('content-length') || '0',
        },
      };

      // Hook into response to log completion
      const originalSend = res.send;
      res.send = function (body) {
        logAuditEvent(req as AuditRequest, res, body);
        return originalSend.call(this, body);
      };

      next();
    } catch (error) {
      logger.error('Audit middleware error', { error, path: req.path });
      next(); // Continue even if audit fails
    }
  };
};

/**
 * Audit middleware for authentication events
 */
export const auditAuthMiddleware = () => {
  return auditMiddleware({
    action: 'authentication',
    resource: 'auth',
    severity: 'medium',
    metadata: {
      type: 'auth_attempt',
    },
  });
};

/**
 * Audit middleware for admin actions
 */
export const auditAdminMiddleware = () => {
  return auditMiddleware({
    severity: 'high',
    metadata: {
      type: 'admin_action',
      requires_review: true,
    },
  });
};

/**
 * Audit middleware for data access
 */
export const auditDataAccessMiddleware = (resourceType: string) => {
  return auditMiddleware({
    action: 'data_access',
    resource: resourceType,
    severity: 'low',
    metadata: {
      type: 'data_access',
      resource_type: resourceType,
    },
  });
};

/**
 * Audit middleware for sensitive operations
 */
export const auditSensitiveMiddleware = () => {
  return auditMiddleware({
    severity: 'high',
    metadata: {
      type: 'sensitive_operation',
      requires_monitoring: true,
    },
  });
};

/**
 * Log the audit event after request completion
 */
async function logAuditEvent(req: AuditRequest, res: Response, responseBody: any): Promise<void> {
  try {
    const auditContext = (req as any).auditContext;
    if (!auditContext) return;

    const duration = Date.now() - auditContext.startTime;
    const outcome = res.statusCode < 400 ? 'success' : 'failure';
    const ip = getClientIp(req);

    // Determine if this was a denied request
    const actualOutcome = res.statusCode === 403 || res.statusCode === 401 ? 'denied' : outcome;

    // Enhanced metadata
    const metadata = {
      ...auditContext.metadata,
      statusCode: res.statusCode,
      responseTime: duration,
      responseSize: JSON.stringify(responseBody).length,
      contentType: res.get('Content-Type'),
    };

    // Add suspicious activity indicators
    if (detectSuspiciousActivity(req, res, duration)) {
      metadata.suspicious_activity = true;
      auditContext.severity = 'high';
    }

    // Add rate limiting information if available
    if (res.get('X-RateLimit-Remaining')) {
      metadata.rate_limit_remaining = res.get('X-RateLimit-Remaining');
      metadata.rate_limit_limit = res.get('X-RateLimit-Limit');
    }

    await auditService.logEvent({
      userId: req.user?.id,
      sessionId: req.sessionId,
      action: auditContext.action,
      resource: auditContext.resource,
      resourceId: auditContext.resourceId,
      outcome: actualOutcome,
      severity: auditContext.severity,
      source: {
        ip,
        userAgent: req.get('User-Agent') || '',
        method: req.method,
        path: req.path,
        referer: req.get('Referer'),
      },
      metadata,
    });
  } catch (error) {
    logger.error('Failed to log audit event', {
      error,
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
    });
  }
}

/**
 * Extract client IP address
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
 * Derive action from HTTP method and path
 */
function deriveAction(method: string, path: string): string {
  const normalizedPath = path.toLowerCase();
  
  // Authentication actions
  if (normalizedPath.includes('/auth/login')) return 'login';
  if (normalizedPath.includes('/auth/logout')) return 'logout';
  if (normalizedPath.includes('/auth/register')) return 'register';
  if (normalizedPath.includes('/auth/reset')) return 'password_reset';
  
  // CRUD operations
  switch (method.toUpperCase()) {
    case 'GET':
      return normalizedPath.includes('/search') ? 'search' : 'read';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return method.toLowerCase();
  }
}

/**
 * Derive resource from path
 */
function deriveResource(path: string): string {
  const pathSegments = path.split('/').filter(segment => segment && !segment.match(/^v\d+$/));
  
  // Remove common prefixes
  const filteredSegments = pathSegments.filter(segment => 
    !['api', 'v1', 'v2'].includes(segment)
  );
  
  if (filteredSegments.length === 0) return 'unknown';
  
  // Return the first meaningful segment
  return filteredSegments[0];
}

/**
 * Extract resource ID from path and params
 */
function extractResourceId(path: string, params: any): string | undefined {
  // Try to get ID from params
  if (params.id) return params.id;
  if (params.userId) return params.userId;
  if (params.itineraryId) return params.itineraryId;
  
  // Try to extract from path
  const idMatch = path.match(/\/([a-f0-9-]{36}|[0-9]+)(?:\/|$)/i);
  return idMatch ? idMatch[1] : undefined;
}

/**
 * Derive severity based on action and resource
 */
function deriveSeverity(action: string, resource: string, method: string): 'low' | 'medium' | 'high' | 'critical' {
  // Critical operations
  if (action.includes('delete') && resource === 'user') return 'critical';
  if (action.includes('admin')) return 'critical';
  if (resource.includes('admin')) return 'high';
  
  // High-risk operations
  if (action === 'login' || action === 'register') return 'medium';
  if (action.includes('password')) return 'high';
  if (method === 'DELETE') return 'high';
  if (action.includes('export') || action.includes('download')) return 'medium';
  
  // Medium-risk operations
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'medium';
  
  // Low-risk operations (GET requests, etc.)
  return 'low';
}

/**
 * Sanitize query parameters for logging
 */
function sanitizeQuery(query: any): any {
  if (!query || typeof query !== 'object') return query;
  
  const sanitized = { ...query };
  const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth'];
  
  Object.keys(sanitized).forEach(key => {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

/**
 * Detect suspicious activity patterns
 */
function detectSuspiciousActivity(req: AuditRequest, res: Response, duration: number): boolean {
  // Multiple failed attempts
  if (res.statusCode === 401 || res.statusCode === 403) {
    return true;
  }
  
  // Unusually long response times (potential attacks)
  if (duration > 10000) { // 10 seconds
    return true;
  }
  
  // Large request bodies (potential data exfiltration attempts)
  const contentLength = parseInt(req.get('content-length') || '0');
  if (contentLength > 10 * 1024 * 1024) { // 10MB
    return true;
  }
  
  // Suspicious user agents
  const userAgent = req.get('User-Agent') || '';
  const suspiciousAgents = ['bot', 'crawler', 'scanner', 'wget', 'curl'];
  if (suspiciousAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
    return true;
  }
  
  // Admin endpoints accessed by non-admin users
  if (req.path.includes('/admin') && (!req.user || req.user.role !== 'admin')) {
    return true;
  }
  
  return false;
}