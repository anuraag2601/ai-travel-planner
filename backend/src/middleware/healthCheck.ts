import { Request, Response, NextFunction } from 'express';
import { performance } from 'perf_hooks';
import { logger } from '../utils/logger';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      responseTime: number;
      details?: any;
      error?: string;
    };
  };
  resources: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
  };
}

export class HealthCheckService {
  private checks: Map<string, () => Promise<any>> = new Map();
  private critical: Set<string> = new Set();

  registerCheck(name: string, checkFn: () => Promise<any>, isCritical = false) {
    this.checks.set(name, checkFn);
    if (isCritical) {
      this.critical.add(name);
    }
  }

  async runHealthChecks(): Promise<HealthCheckResult> {
    const startTime = performance.now();
    const result: HealthCheckResult = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'unknown',
      version: process.env.npm_package_version || '1.0.0',
      checks: {},
      resources: this.getResourceUsage()
    };

    let hasFailures = false;
    let hasWarnings = false;

    // Run all health checks
    for (const [name, checkFn] of this.checks.entries()) {
      const checkStartTime = performance.now();
      
      try {
        const checkResult = await Promise.race([
          checkFn(),
          this.timeout(5000) // 5 second timeout for each check
        ]);

        const responseTime = performance.now() - checkStartTime;
        
        result.checks[name] = {
          status: 'pass',
          responseTime: Math.round(responseTime),
          details: checkResult
        };

        // Warn if response time is high
        if (responseTime > 2000) {
          result.checks[name].status = 'warn';
          hasWarnings = true;
        }

      } catch (error) {
        const responseTime = performance.now() - checkStartTime;
        result.checks[name] = {
          status: 'fail',
          responseTime: Math.round(responseTime),
          error: error instanceof Error ? error.message : String(error)
        };

        if (this.critical.has(name)) {
          hasFailures = true;
        } else {
          hasWarnings = true;
        }

        logger.error(`Health check failed: ${name}`, error);
      }
    }

    // Determine overall status
    if (hasFailures) {
      result.status = 'unhealthy';
    } else if (hasWarnings) {
      result.status = 'degraded';
    }

    const totalTime = performance.now() - startTime;
    logger.info(`Health check completed in ${Math.round(totalTime)}ms`, {
      status: result.status,
      checksRun: this.checks.size
    });

    return result;
  }

  private getResourceUsage() {
    const memoryUsage = process.memoryUsage();
    return {
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      cpu: {
        usage: process.cpuUsage().user / 1000000 // Convert to seconds
      }
    };
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Health check timeout after ${ms}ms`)), ms);
    });
  }
}

// Global health check service instance
export const healthCheckService = new HealthCheckService();

// Register default checks
healthCheckService.registerCheck('database', async () => {
  // Check Firestore connection
  const { db } = await import('../config/firebase');
  const testDoc = await db.collection('health').doc('test').get();
  return { connected: true, latency: 'low' };
}, true);

healthCheckService.registerCheck('redis', async () => {
  // Check Redis connection
  const { redisClient } = await import('../services/redis');
  await redisClient.ping();
  return { connected: true, latency: 'low' };
}, true);

healthCheckService.registerCheck('external-apis', async () => {
  // Check external API connectivity
  const checks = await Promise.allSettled([
    // Check Anthropic API
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }]
      })
    }),
    
    // Check Amadeus API
    fetch('https://api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.AMADEUS_CLIENT_ID || '',
        client_secret: process.env.AMADEUS_CLIENT_SECRET || ''
      })
    })
  ]);

  return {
    anthropic: checks[0].status === 'fulfilled' ? 'connected' : 'failed',
    amadeus: checks[1].status === 'fulfilled' ? 'connected' : 'failed'
  };
}, false);

// Health check middleware
export const healthCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const healthResult = await healthCheckService.runHealthChecks();
    
    // Set appropriate HTTP status code
    let statusCode = 200;
    if (healthResult.status === 'degraded') {
      statusCode = 200; // Still OK, but with warnings
    } else if (healthResult.status === 'unhealthy') {
      statusCode = 503; // Service Unavailable
    }

    res.status(statusCode).json(healthResult);
  } catch (error) {
    logger.error('Health check middleware error', error);
    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
};

// Readiness probe - checks if app is ready to receive traffic
export const readinessProbe = async (req: Request, res: Response) => {
  try {
    // Check critical dependencies only
    const criticalChecks = Array.from(healthCheckService['critical']);
    const result = await healthCheckService.runHealthChecks();
    
    const failedCriticalChecks = criticalChecks.filter(
      check => result.checks[check]?.status === 'fail'
    );

    if (failedCriticalChecks.length > 0) {
      return res.status(503).json({
        status: 'not_ready',
        failedChecks: failedCriticalChecks,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: 'Readiness check failed',
      timestamp: new Date().toISOString()
    });
  }
};

// Liveness probe - checks if app is alive
export const livenessProbe = async (req: Request, res: Response) => {
  // Simple check - if we can respond, we're alive
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
};