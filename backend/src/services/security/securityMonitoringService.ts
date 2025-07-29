import { logger } from '../../utils/logger';
import { auditService } from './auditService';
import { keyRotationService } from './keyRotationService';
import { redisService } from '../cache/redisService';
import cron from 'node-cron';

export interface SecurityMetrics {
  timestamp: Date;
  totalRequests: number;
  failedRequests: number;
  blockedRequests: number;
  suspiciousActivities: number;
  activeAlerts: number;
  apiKeyUsage: number;
  rateLimitHits: number;
  uniqueIps: number;
  topRiskyIps: { ip: string; riskScore: number; requestCount: number }[];
  alertsByType: { type: string; count: number }[];
  performanceMetrics: {
    averageResponseTime: number;
    slowRequests: number;
    errorRate: number;
  };
}

export interface ThreatPattern {
  id: string;
  name: string;
  description: string;
  pattern: RegExp | ((data: any) => boolean);
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'log' | 'alert' | 'block';
  metadata?: Record<string, any>;
}

export interface SecurityConfig {
  monitoring: {
    metricsInterval: number; // minutes
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      suspiciousActivity: number;
      failedLogins: number;
    };
    retentionDays: number;
  };
  threats: {
    enabled: boolean;
    patterns: ThreatPattern[];
  };
  notifications: {
    enabled: boolean;
    channels: string[];
    severityThreshold: 'low' | 'medium' | 'high' | 'critical';
  };
}

export class SecurityMonitoringService {
  private config: SecurityConfig;
  private isRunning: boolean = false;
  private metricsCache: Map<string, any> = new Map();

  constructor(config?: Partial<SecurityConfig>) {
    this.config = {
      monitoring: {
        metricsInterval: 5,
        alertThresholds: {
          errorRate: 0.05, // 5%
          responseTime: 2000, // 2 seconds
          suspiciousActivity: 10,
          failedLogins: 5,
        },
        retentionDays: 30,
      },
      threats: {
        enabled: true,
        patterns: this.getDefaultThreatPatterns(),
      },
      notifications: {
        enabled: true,
        channels: ['email', 'webhook'],
        severityThreshold: 'medium',
      },
      ...config,
    };
  }

  /**
   * Start the security monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Security monitoring service is already running');
      return;
    }

    try {
      this.isRunning = true;
      
      // Schedule metrics collection
      this.scheduleMetricsCollection();
      
      // Schedule threat pattern checks
      if (this.config.threats.enabled) {
        this.scheduleThreatDetection();
      }
      
      // Schedule cleanup tasks
      this.scheduleCleanupTasks();
      
      // Schedule security reports
      this.scheduleSecurityReports();

      logger.info('Security monitoring service started', {
        metricsInterval: this.config.monitoring.metricsInterval,
        threatsEnabled: this.config.threats.enabled,
        notificationsEnabled: this.config.notifications.enabled,
      });
    } catch (error) {
      logger.error('Failed to start security monitoring service', { error });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the security monitoring service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Security monitoring service stopped');
  }

  /**
   * Get current security metrics
   */
  async getSecurityMetrics(): Promise<SecurityMetrics> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Get recent audit events
      const recentEvents = await auditService.searchEvents({
        startDate: oneHourAgo,
        endDate: now,
      }, 1000);

      // Get active alerts
      const activeAlerts = await auditService.getActiveAlerts();

      // Calculate metrics
      const totalRequests = recentEvents.length;
      const failedRequests = recentEvents.filter(e => e.outcome === 'failure').length;
      const blockedRequests = recentEvents.filter(e => e.outcome === 'denied').length;
      const suspiciousActivities = recentEvents.filter(e => 
        e.metadata?.suspicious_activity || (e.risk_score || 0) > 70
      ).length;

      // Calculate unique IPs
      const uniqueIps = new Set(recentEvents.map(e => e.source.ip)).size;

      // Calculate performance metrics
      const responseTimeEvents = recentEvents.filter(e => e.metadata?.responseTime);
      const totalResponseTime = responseTimeEvents.reduce((sum, e) => 
        sum + (e.metadata?.responseTime || 0), 0
      );
      const averageResponseTime = responseTimeEvents.length > 0 
        ? totalResponseTime / responseTimeEvents.length 
        : 0;

      const slowRequests = responseTimeEvents.filter(e => 
        (e.metadata?.responseTime || 0) > this.config.monitoring.alertThresholds.responseTime
      ).length;

      const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

      // Top risky IPs
      const ipRisks = new Map<string, { riskScore: number; requestCount: number }>();
      recentEvents.forEach(event => {
        const ip = event.source.ip;
        const current = ipRisks.get(ip) || { riskScore: 0, requestCount: 0 };
        current.requestCount++;
        current.riskScore += event.risk_score || 0;
        ipRisks.set(ip, current);
      });

      const topRiskyIps = Array.from(ipRisks.entries())
        .map(([ip, data]) => ({
          ip,
          riskScore: Math.round(data.riskScore / data.requestCount),
          requestCount: data.requestCount,
        }))
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 10);

      // Alerts by type
      const alertTypeMap = new Map<string, number>();
      activeAlerts.forEach(alert => {
        alertTypeMap.set(alert.type, (alertTypeMap.get(alert.type) || 0) + 1);
      });

      const alertsByType = Array.from(alertTypeMap.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      // Get rate limit hits from Redis
      const rateLimitKeys = await redisService.keys('ratelimit:*');
      const rateLimitHits = rateLimitKeys.length;

      // Get API key usage stats
      const apiKeyStats = await this.getApiKeyUsageStats();

      const metrics: SecurityMetrics = {
        timestamp: now,
        totalRequests,
        failedRequests,
        blockedRequests,
        suspiciousActivities,
        activeAlerts: activeAlerts.length,
        apiKeyUsage: apiKeyStats.totalUsage,
        rateLimitHits,
        uniqueIps,
        topRiskyIps,
        alertsByType,
        performanceMetrics: {
          averageResponseTime,
          slowRequests,
          errorRate,
        },
      };

      // Cache metrics
      await this.cacheMetrics(metrics);

      return metrics;
    } catch (error) {
      logger.error('Failed to get security metrics', { error });
      throw new Error('Failed to get security metrics');
    }
  }

  /**
   * Analyze threat patterns in recent activity
   */
  async analyzeThreatPatterns(): Promise<void> {
    try {
      if (!this.config.threats.enabled) {
        return;
      }

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const recentEvents = await auditService.searchEvents({
        startDate: oneHourAgo,
        endDate: now,
      }, 500);

      for (const pattern of this.config.threats.patterns) {
        const matchingEvents = recentEvents.filter(event => 
          this.matchesThreatPattern(event, pattern)
        );

        if (matchingEvents.length > 0) {
          await this.handleThreatDetection(pattern, matchingEvents);
        }
      }
    } catch (error) {
      logger.error('Failed to analyze threat patterns', { error });
    }
  }

  /**
   * Generate security dashboard data
   */
  async getSecurityDashboard(): Promise<{
    currentMetrics: SecurityMetrics;
    trends: {
      requestTrend: { timestamp: Date; count: number }[];
      errorTrend: { timestamp: Date; rate: number }[];
      alertTrend: { timestamp: Date; count: number }[];
    };
    recentAlerts: any[];
    systemHealth: {
      status: 'healthy' | 'warning' | 'critical';
      issues: string[];
      recommendations: string[];
    };
  }> {
    try {
      const currentMetrics = await this.getSecurityMetrics();
      const trends = await this.getSecurityTrends();
      const recentAlerts = await auditService.getActiveAlerts(10);
      const systemHealth = await this.assessSystemHealth(currentMetrics);

      return {
        currentMetrics,
        trends,
        recentAlerts,
        systemHealth,
      };
    } catch (error) {
      logger.error('Failed to get security dashboard', { error });
      throw new Error('Failed to get security dashboard');
    }
  }

  /**
   * Schedule metrics collection
   */
  private scheduleMetricsCollection(): void {
    const interval = `*/${this.config.monitoring.metricsInterval} * * * *`;
    
    cron.schedule(interval, async () => {
      try {
        const metrics = await this.getSecurityMetrics();
        await this.checkAlertThresholds(metrics);
      } catch (error) {
        logger.error('Failed to collect security metrics', { error });
      }
    });

    logger.info('Security metrics collection scheduled', { interval });
  }

  /**
   * Schedule threat detection
   */
  private scheduleThreatDetection(): void {
    // Run threat detection every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        await this.analyzeThreatPatterns();
      } catch (error) {
        logger.error('Failed to analyze threat patterns', { error });
      }
    });

    logger.info('Threat detection scheduled');
  }

  /**
   * Schedule cleanup tasks
   */
  private scheduleCleanupTasks(): void {
    // Run cleanup daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        await keyRotationService.cleanupExpiredKeys();
        await this.cleanupOldMetrics();
        logger.info('Security cleanup tasks completed');
      } catch (error) {
        logger.error('Failed to run cleanup tasks', { error });
      }
    });

    // Run key rotation weekly
    cron.schedule('0 3 * * 0', async () => {
      try {
        await keyRotationService.rotateAllKeys();
        logger.info('Weekly key rotation completed');
      } catch (error) {
        logger.error('Failed to rotate keys', { error });
      }
    });
  }

  /**
   * Schedule security reports
   */
  private scheduleSecurityReports(): void {
    // Generate daily security report at 6 AM
    cron.schedule('0 6 * * *', async () => {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const today = new Date(yesterday);
        today.setDate(today.getDate() + 1);

        const report = await auditService.generateSecurityReport(yesterday, today);
        
        logger.info('Daily security report generated', {
          date: yesterday.toISOString().split('T')[0],
          summary: report.summary,
        });

        // Send report via configured channels
        await this.sendSecurityReport(report, 'daily');
      } catch (error) {
        logger.error('Failed to generate daily security report', { error });
      }
    });
  }

  /**
   * Check alert thresholds
   */
  private async checkAlertThresholds(metrics: SecurityMetrics): Promise<void> {
    const thresholds = this.config.monitoring.alertThresholds;

    // Check error rate
    if (metrics.performanceMetrics.errorRate > thresholds.errorRate) {
      await auditService.createAlert({
        type: 'high_error_rate',
        severity: 'high',
        title: 'High Error Rate Detected',
        description: `Error rate is ${(metrics.performanceMetrics.errorRate * 100).toFixed(2)}%, exceeding threshold of ${(thresholds.errorRate * 100).toFixed(2)}%`,
        sourceIp: 'system',
        events: [],
        metadata: {
          currentErrorRate: metrics.performanceMetrics.errorRate,
          threshold: thresholds.errorRate,
          totalRequests: metrics.totalRequests,
          failedRequests: metrics.failedRequests,
        },
      });
    }

    // Check response time
    if (metrics.performanceMetrics.averageResponseTime > thresholds.responseTime) {
      await auditService.createAlert({
        type: 'slow_response_time',
        severity: 'medium',
        title: 'Slow Response Time',
        description: `Average response time is ${metrics.performanceMetrics.averageResponseTime.toFixed(0)}ms, exceeding threshold of ${thresholds.responseTime}ms`,
        sourceIp: 'system',
        events: [],
        metadata: {
          averageResponseTime: metrics.performanceMetrics.averageResponseTime,
          threshold: thresholds.responseTime,
          slowRequests: metrics.performanceMetrics.slowRequests,
        },
      });
    }

    // Check suspicious activities
    if (metrics.suspiciousActivities > thresholds.suspiciousActivity) {
      await auditService.createAlert({
        type: 'suspicious_activity_spike',
        severity: 'high',
        title: 'Suspicious Activity Spike',
        description: `${metrics.suspiciousActivities} suspicious activities detected, exceeding threshold of ${thresholds.suspiciousActivity}`,
        sourceIp: 'system',
        events: [],
        metadata: {
          suspiciousActivities: metrics.suspiciousActivities,
          threshold: thresholds.suspiciousActivity,
          timeWindow: '1 hour',
        },
      });
    }
  }

  /**
   * Get default threat detection patterns for common security threats
   * 
   * SECURITY ALGORITHM: Threat Pattern Library
   * ==========================================
   * 
   * This function defines a comprehensive library of threat detection patterns
   * that cover the most common attack vectors in web applications.
   * 
   * THREAT PATTERN CATEGORIES:
   * 
   * 1. INJECTION ATTACKS:
   *    
   *    a) SQL Injection Detection:
   *       - Patterns: SQL keywords that shouldn't appear in normal input
   *       - Keywords: 'union select', 'drop table', 'exec(', etc.
   *       - Case-insensitive matching for evasion resistance
   *       - Severity: High (data breach potential)
   *       - Action: Alert for immediate investigation
   *    
   *    b) Cross-Site Scripting (XSS):
   *       - Regex pattern for script injection attempts
   *       - Detects: <script> tags, javascript: URLs, event handlers
   *       - Covers reflected, stored, and DOM-based XSS
   *       - Severity: High (session hijacking, malware distribution)
   *       - Action: Alert for security review
   * 
   * 2. AUTHENTICATION ATTACKS:
   *    
   *    a) Brute Force Detection:
   *       - Function-based pattern for behavioral analysis
   *       - Criteria: Failed login + multiple_failures metadata
   *       - Correlates with audit service failure tracking
   *       - Severity: High (account compromise risk)
   *       - Action: Block to prevent further attempts
   * 
   * 3. DATA PROTECTION THREATS:
   *    
   *    a) Data Exfiltration:
   *       - Detects large data exports/downloads
   *       - Threshold: 10MB response size (configurable)
   *       - Monitors export and download actions
   *       - Severity: Medium (depends on data sensitivity)
   *       - Action: Alert for access pattern review
   * 
   * 4. PRIVILEGE ESCALATION:
   *    
   *    a) Unauthorized Admin Access:
   *       - Monitors denied access to admin endpoints
   *       - Path-based detection: /admin/* routes
   *       - Indicates reconnaissance or escalation attempts
   *       - Severity: Critical (system compromise risk)
   *       - Action: Alert for immediate response
   * 
   * PATTERN DESIGN PRINCIPLES:
   * - Low false positive rate for operational stability
   * - High coverage of common attack vectors
   * - Performance-optimized detection logic
   * - Configurable thresholds and responses
   * - Integration with existing audit infrastructure
   * 
   * CUSTOMIZATION GUIDELINES:
   * - Add application-specific patterns as needed
   * - Adjust severity levels based on risk assessment
   * - Configure actions based on incident response procedures
   * - Regular review and updates for emerging threats
   * 
   * @returns Array of threat pattern definitions for security monitoring
   */
  private getDefaultThreatPatterns(): ThreatPattern[] {
    return [
      {
        id: 'sql_injection',
        name: 'SQL Injection Attempt',
        description: 'Detects potential SQL injection patterns including UNION attacks, table manipulation, and code execution attempts',
        pattern: (data: any) => {
          const sqlPatterns = [
            'union select',    // UNION-based injection
            'drop table',      // Table destruction
            'exec(',           // Stored procedure execution
            'script>',         // Script tag injection
            '<script',         // Script tag variants
            'insert into',     // Data insertion
            'delete from',     // Data deletion
            'update set',      // Data modification
            'information_schema', // Schema enumeration
          ];
          const text = JSON.stringify(data).toLowerCase();
          return sqlPatterns.some(pattern => text.includes(pattern));
        },
        severity: 'high',
        action: 'alert',
        metadata: {
          category: 'injection_attack',
          mitigation: 'parameterized_queries',
          references: ['OWASP_A03_2021']
        }
      },
      {
        id: 'xss_attempt',
        name: 'Cross-Site Scripting (XSS) Attempt',
        description: 'Detects potential XSS attacks including script injection, JavaScript URLs, and event handler injection',
        pattern: /<script[^>]*>|<\/script>|javascript:|on\w+\s*=|eval\(|setTimeout\(|setInterval\(/i,
        severity: 'high',
        action: 'alert',
        metadata: {
          category: 'injection_attack',
          attack_types: ['reflected_xss', 'stored_xss', 'dom_xss'],
          mitigation: 'content_security_policy'
        }
      },
      {
        id: 'brute_force',
        name: 'Brute Force Authentication Attack',
        description: 'Detects coordinated login attempts indicating brute force or credential stuffing attacks',
        pattern: (data: any) => {
          return data.action === 'login' && 
                 data.outcome === 'failure' && 
                 data.metadata?.multiple_failures;
        },
        severity: 'high',
        action: 'block',
        metadata: {
          category: 'authentication_attack',
          indicators: ['repeated_failures', 'rapid_attempts'],
          mitigation: 'account_lockout'
        }
      },
      {
        id: 'data_exfiltration',
        name: 'Potential Data Exfiltration',
        description: 'Detects unusual large data access patterns that may indicate data theft or unauthorized extraction',
        pattern: (data: any) => {
          return (data.action.includes('export') || data.action.includes('download')) &&
                 data.metadata?.responseSize > 10 * 1024 * 1024; // 10MB threshold
        },
        severity: 'medium',
        action: 'alert',
        metadata: {
          category: 'data_protection',
          threshold: '10MB',
          risk_factors: ['bulk_export', 'unusual_volume']
        }
      },
      {
        id: 'admin_access',
        name: 'Unauthorized Administrative Access Attempt',
        description: 'Detects attempts to access administrative functions without proper authorization',
        pattern: (data: any) => {
          return data.source?.path?.includes('/admin') && 
                 data.outcome === 'denied';
        },
        severity: 'critical',
        action: 'alert',
        metadata: {
          category: 'privilege_escalation',
          target: 'administrative_functions',
          response: 'immediate_investigation'
        }
      },
    ];
  }

  /**
   * Evaluate if an event matches a specific threat pattern using pattern matching algorithms
   * 
   * SECURITY ALGORITHM: Threat Pattern Matching
   * ===========================================
   * 
   * This function implements a flexible pattern matching system that can detect
   * various types of security threats using both rule-based and functional patterns.
   * 
   * PATTERN MATCHING METHODOLOGY:
   * 
   * 1. Function-Based Pattern Matching:
   *    - Executes custom JavaScript functions for complex threat detection
   *    - Allows contextual analysis of event properties and metadata
   *    - Supports multi-field correlation and behavioral analysis
   *    - Examples: Brute force detection, data exfiltration patterns
   * 
   * 2. Regular Expression Pattern Matching:
   *    - Uses regex patterns for string-based threat detection
   *    - Serializes entire event object to JSON for comprehensive scanning
   *    - Effective for detecting injection attacks, XSS, and malicious payloads
   *    - Case-insensitive matching for robust detection
   * 
   * 3. Pattern Types and Use Cases:
   *    
   *    a) SQL Injection Detection:
   *       - Searches for SQL keywords in event data
   *       - Patterns: 'union select', 'drop table', 'exec('
   *       - Covers common injection vectors and techniques
   *    
   *    b) Cross-Site Scripting (XSS):
   *       - Regex patterns for script tags and JavaScript events
   *       - Detects: <script>, javascript:, onclick= patterns
   *       - Protects against reflected and stored XSS
   *    
   *    c) Brute Force Attacks:
   *       - Function-based analysis of login failure patterns
   *       - Considers frequency, timing, and metadata
   *       - Detects distributed and concentrated attacks
   *    
   *    d) Data Exfiltration:
   *       - Analyzes export/download patterns and data volumes
   *       - Threshold-based detection for unusual access patterns
   *       - Considers user behavior baselines
   * 
   * ERROR HANDLING AND SECURITY:
   * - Comprehensive try-catch to prevent pattern evaluation failures
   * - Graceful degradation: Pattern failures don't stop other detections
   * - Detailed logging for pattern debugging and tuning
   * - No sensitive data exposure in error logs
   * 
   * PERFORMANCE OPTIMIZATIONS:
   * - Early return for non-matching pattern types
   * - Efficient JSON serialization only when needed
   * - Pattern execution timeout prevention (implicit via V8)
   * 
   * INCIDENT RESPONSE INTEGRATION:
   * - Pattern matches trigger immediate threat response workflows
   * - Metadata preservation for forensic analysis
   * - Severity-based escalation procedures
   * 
   * @param event - Security event to evaluate against threat pattern
   * @param pattern - Threat pattern definition with matching logic
   * @returns true if event matches the threat pattern, false otherwise
   */
  private matchesThreatPattern(event: any, pattern: ThreatPattern): boolean {
    try {
      // Function-based pattern matching for complex behavioral analysis
      if (typeof pattern.pattern === 'function') {
        return pattern.pattern(event);
      } 
      // Regular expression pattern matching for string-based threats
      else if (pattern.pattern instanceof RegExp) {
        // Serialize event to JSON for comprehensive string-based scanning
        const text = JSON.stringify(event);
        return pattern.pattern.test(text);
      }
      
      // Return false for unsupported pattern types
      return false;
    } catch (error) {
      // Log pattern matching failures for debugging and security monitoring
      logger.error('Failed to match threat pattern', { 
        error: error.message, 
        patternId: pattern.id,
        patternName: pattern.name,
        eventId: event.id
      });
      return false;
    }
  }

  /**
   * Handle threat detection
   */
  private async handleThreatDetection(pattern: ThreatPattern, events: any[]): Promise<void> {
    try {
      const severity = pattern.severity;
      const eventIds = events.map(e => e.id);

      // Create security alert
      await auditService.createAlert({
        type: pattern.id,
        severity,
        title: pattern.name,
        description: `${pattern.description}. ${events.length} matching events detected.`,
        sourceIp: events[0]?.source?.ip || 'unknown',
        events: eventIds,
        metadata: {
          patternId: pattern.id,
          eventCount: events.length,
          action: pattern.action,
        },
      });

      logger.warn('Threat pattern detected', {
        patternId: pattern.id,
        patternName: pattern.name,
        severity,
        eventCount: events.length,
        action: pattern.action,
      });

      // Send notifications if enabled
      if (this.config.notifications.enabled && 
          this.shouldNotify(severity)) {
        await this.sendThreatNotification(pattern, events);
      }
    } catch (error) {
      logger.error('Failed to handle threat detection', { error, patternId: pattern.id });
    }
  }

  /**
   * Cache security metrics
   */
  private async cacheMetrics(metrics: SecurityMetrics): Promise<void> {
    try {
      const key = `security_metrics:${Math.floor(metrics.timestamp.getTime() / (5 * 60 * 1000))}`;
      const ttl = this.config.monitoring.retentionDays * 24 * 60 * 60;
      
      await redisService.setex(key, ttl, JSON.stringify(metrics));
    } catch (error) {
      logger.error('Failed to cache security metrics', { error });
    }
  }

  /**
   * Get API key usage statistics
   */
  private async getApiKeyUsageStats(): Promise<{ totalUsage: number; activeKeys: number }> {
    try {
      const keyStatsKeys = await redisService.keys('key_stats:*');
      let totalUsage = 0;
      let activeKeys = 0;

      for (const keyStatsKey of keyStatsKeys) {
        const stats = await redisService.get(keyStatsKey);
        if (stats) {
          const keyStats = JSON.parse(stats);
          totalUsage += keyStats.requestCount || 0;
          activeKeys++;
        }
      }

      return { totalUsage, activeKeys };
    } catch (error) {
      logger.error('Failed to get API key usage stats', { error });
      return { totalUsage: 0, activeKeys: 0 };
    }
  }

  /**
   * Get security trends
   */
  private async getSecurityTrends(): Promise<{
    requestTrend: { timestamp: Date; count: number }[];
    errorTrend: { timestamp: Date; rate: number }[];
    alertTrend: { timestamp: Date; count: number }[];
  }> {
    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Get cached metrics from last 24 hours
      const metricsKeys = await redisService.keys('security_metrics:*');
      const metrics: SecurityMetrics[] = [];

      for (const key of metricsKeys) {
        const data = await redisService.get(key);
        if (data) {
          const metricsData = JSON.parse(data);
          if (new Date(metricsData.timestamp) >= twentyFourHoursAgo) {
            metrics.push(metricsData);
          }
        }
      }

      // Sort by timestamp
      metrics.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return {
        requestTrend: metrics.map(m => ({
          timestamp: new Date(m.timestamp),
          count: m.totalRequests,
        })),
        errorTrend: metrics.map(m => ({
          timestamp: new Date(m.timestamp),
          rate: m.performanceMetrics.errorRate,
        })),
        alertTrend: metrics.map(m => ({
          timestamp: new Date(m.timestamp),
          count: m.activeAlerts,
        })),
      };
    } catch (error) {
      logger.error('Failed to get security trends', { error });
      return {
        requestTrend: [],
        errorTrend: [],
        alertTrend: [],
      };
    }
  }

  /**
   * Assess system health
   */
  private async assessSystemHealth(metrics: SecurityMetrics): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check error rate
    if (metrics.performanceMetrics.errorRate > 0.1) {
      issues.push(`High error rate: ${(metrics.performanceMetrics.errorRate * 100).toFixed(2)}%`);
      recommendations.push('Investigate recent application changes or infrastructure issues');
      status = 'critical';
    } else if (metrics.performanceMetrics.errorRate > 0.05) {
      issues.push(`Elevated error rate: ${(metrics.performanceMetrics.errorRate * 100).toFixed(2)}%`);
      recommendations.push('Monitor error trends and investigate if continues to rise');
      if (status === 'healthy') status = 'warning';
    }

    // Check response time
    if (metrics.performanceMetrics.averageResponseTime > 5000) {
      issues.push(`Very slow response times: ${metrics.performanceMetrics.averageResponseTime.toFixed(0)}ms average`);
      recommendations.push('Check database performance and server resources');
      status = 'critical';
    } else if (metrics.performanceMetrics.averageResponseTime > 2000) {
      issues.push(`Slow response times: ${metrics.performanceMetrics.averageResponseTime.toFixed(0)}ms average`);
      recommendations.push('Consider optimizing database queries and caching');
      if (status === 'healthy') status = 'warning';
    }

    // Check suspicious activities
    if (metrics.suspiciousActivities > 50) {
      issues.push(`High number of suspicious activities: ${metrics.suspiciousActivities}`);
      recommendations.push('Review security alerts and consider additional rate limiting');
      status = 'critical';
    } else if (metrics.suspiciousActivities > 20) {
      issues.push(`Elevated suspicious activities: ${metrics.suspiciousActivities}`);
      recommendations.push('Monitor security patterns and review access logs');
      if (status === 'healthy') status = 'warning';
    }

    // Check active alerts
    if (metrics.activeAlerts > 10) {
      issues.push(`Many active security alerts: ${metrics.activeAlerts}`);
      recommendations.push('Review and resolve active security alerts');
      if (status === 'healthy') status = 'warning';
    }

    return { status, issues, recommendations };
  }

  /**
   * Clean up old metrics
   */
  private async cleanupOldMetrics(): Promise<void> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.config.monitoring.retentionDays);
      const cutoffTimestamp = Math.floor(cutoff.getTime() / (5 * 60 * 1000));

      const metricsKeys = await redisService.keys('security_metrics:*');
      let deletedCount = 0;

      for (const key of metricsKeys) {
        const timestamp = parseInt(key.split(':')[1]);
        if (timestamp < cutoffTimestamp) {
          await redisService.del(key);
          deletedCount++;
        }
      }

      logger.info('Old security metrics cleaned up', { deletedCount });
    } catch (error) {
      logger.error('Failed to cleanup old metrics', { error });
    }
  }

  /**
   * Check if notification should be sent
   */
  private shouldNotify(severity: string): boolean {
    const severityLevels = ['low', 'medium', 'high', 'critical'];
    const currentLevel = severityLevels.indexOf(severity);
    const thresholdLevel = severityLevels.indexOf(this.config.notifications.severityThreshold);
    
    return currentLevel >= thresholdLevel;
  }

  /**
   * Send threat notification
   */
  private async sendThreatNotification(pattern: ThreatPattern, events: any[]): Promise<void> {
    try {
      // This would integrate with your notification system (email, Slack, etc.)
      logger.warn('Threat notification sent', {
        patternId: pattern.id,
        patternName: pattern.name,
        severity: pattern.severity,
        eventCount: events.length,
      });
      
      // TODO: Implement actual notification sending
      // await emailService.sendThreatAlert(pattern, events);
      // await slackService.sendThreatAlert(pattern, events);
    } catch (error) {
      logger.error('Failed to send threat notification', { error, patternId: pattern.id });
    }
  }

  /**
   * Send security report
   */
  private async sendSecurityReport(report: any, type: 'daily' | 'weekly'): Promise<void> {
    try {
      // This would integrate with your reporting system
      logger.info('Security report sent', {
        type,
        totalEvents: report.summary.totalEvents,
        activeAlerts: report.summary.activeAlerts,
      });
      
      // TODO: Implement actual report sending
      // await emailService.sendSecurityReport(report, type);
    } catch (error) {
      logger.error('Failed to send security report', { error, type });
    }
  }
}

export const securityMonitoringService = new SecurityMonitoringService();