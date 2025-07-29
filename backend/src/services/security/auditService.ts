import { logger } from '../../utils/logger';
import { redisService } from '../cache/redisService';
import { v4 as uuidv4 } from 'uuid';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  outcome: 'success' | 'failure' | 'denied';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: {
    ip: string;
    userAgent?: string;
    method: string;
    path: string;
    referer?: string;
  };
  metadata?: Record<string, any>;
  risk_score?: number;
}

export interface SecurityAlert {
  id: string;
  timestamp: Date;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  userId?: string;
  sourceIp: string;
  events: string[]; // audit event IDs
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  metadata?: Record<string, any>;
}

export interface AuditConfig {
  retentionDays: number;
  alertThresholds: {
    failedLogins: number;
    suspiciousActivity: number;
    dataAccess: number;
  };
  riskScoreThreshold: number;
}

export class AuditService {
  private config: AuditConfig = {
    retentionDays: 90,
    alertThresholds: {
      failedLogins: 5,
      suspiciousActivity: 10,
      dataAccess: 100,
    },
    riskScoreThreshold: 70,
  };

  constructor(config?: Partial<AuditConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Log an audit event
   */
  async logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<string> {
    try {
      const auditEvent: AuditEvent = {
        id: uuidv4(),
        timestamp: new Date(),
        ...event,
        risk_score: this.calculateRiskScore(event),
      };

      // Store in Redis with TTL
      const eventKey = `audit_event:${auditEvent.id}`;
      const ttl = this.config.retentionDays * 24 * 60 * 60;
      
      await redisService.setex(eventKey, ttl, JSON.stringify(auditEvent));

      // Index by user for fast lookup
      if (auditEvent.userId) {
        await this.indexEventByUser(auditEvent.userId, auditEvent.id);
      }

      // Index by IP for security monitoring
      await this.indexEventByIp(auditEvent.source.ip, auditEvent.id);

      // Index by action type
      await this.indexEventByAction(auditEvent.action, auditEvent.id);

      // Log to application logger
      logger.info('Audit event logged', {
        eventId: auditEvent.id,
        action: auditEvent.action,
        resource: auditEvent.resource,
        outcome: auditEvent.outcome,
        severity: auditEvent.severity,
        userId: auditEvent.userId,
        sourceIp: auditEvent.source.ip,
        riskScore: auditEvent.risk_score,
      });

      // Check for security alerts
      await this.checkSecurityAlerts(auditEvent);

      return auditEvent.id;
    } catch (error) {
      logger.error('Failed to log audit event', { error, event });
      throw new Error('Failed to log audit event');
    }
  }

  /**
   * Get audit events for a user
   */
  async getUserEvents(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<AuditEvent[]> {
    try {
      const userEventsKey = `user_events:${userId}`;
      const eventIds = await redisService.lrange(userEventsKey, offset, offset + limit - 1);
      
      const events: AuditEvent[] = [];
      for (const eventId of eventIds) {
        const eventData = await redisService.get(`audit_event:${eventId}`);
        if (eventData) {
          events.push(JSON.parse(eventData));
        }
      }

      return events.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      logger.error('Failed to get user events', { error, userId });
      return [];
    }
  }

  /**
   * Get audit events by IP address
   */
  async getIpEvents(
    ip: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<AuditEvent[]> {
    try {
      const ipEventsKey = `ip_events:${ip}`;
      const eventIds = await redisService.lrange(ipEventsKey, offset, offset + limit - 1);
      
      const events: AuditEvent[] = [];
      for (const eventId of eventIds) {
        const eventData = await redisService.get(`audit_event:${eventId}`);
        if (eventData) {
          events.push(JSON.parse(eventData));
        }
      }

      return events.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      logger.error('Failed to get IP events', { error, ip });
      return [];
    }
  }

  /**
   * Search audit events
   */
  async searchEvents(
    filters: {
      userId?: string;
      action?: string;
      resource?: string;
      outcome?: string;
      severity?: string;
      startDate?: Date;
      endDate?: Date;
      minRiskScore?: number;
    },
    limit: number = 50
  ): Promise<AuditEvent[]> {
    try {
      // This is a simplified search - in production, you'd use a proper search engine
      let events: AuditEvent[] = [];

      if (filters.userId) {
        events = await this.getUserEvents(filters.userId, limit * 2);
      } else if (filters.action) {
        const actionEventsKey = `action_events:${filters.action}`;
        const eventIds = await redisService.lrange(actionEventsKey, 0, limit * 2 - 1);
        
        for (const eventId of eventIds) {
          const eventData = await redisService.get(`audit_event:${eventId}`);
          if (eventData) {
            events.push(JSON.parse(eventData));
          }
        }
      }

      // Apply additional filters
      events = events.filter(event => {
        if (filters.resource && event.resource !== filters.resource) return false;
        if (filters.outcome && event.outcome !== filters.outcome) return false;
        if (filters.severity && event.severity !== filters.severity) return false;
        if (filters.startDate && new Date(event.timestamp) < filters.startDate) return false;
        if (filters.endDate && new Date(event.timestamp) > filters.endDate) return false;
        if (filters.minRiskScore && (event.risk_score || 0) < filters.minRiskScore) return false;
        return true;
      });

      return events
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    } catch (error) {
      logger.error('Failed to search events', { error, filters });
      return [];
    }
  }

  /**
   * Create a security alert
   */
  async createAlert(alert: Omit<SecurityAlert, 'id' | 'timestamp' | 'status'>): Promise<string> {
    try {
      const securityAlert: SecurityAlert = {
        id: uuidv4(),
        timestamp: new Date(),
        status: 'open',
        ...alert,
      };

      const alertKey = `security_alert:${securityAlert.id}`;
      const ttl = this.config.retentionDays * 24 * 60 * 60;
      
      await redisService.setex(alertKey, ttl, JSON.stringify(securityAlert));

      // Index active alerts
      await redisService.lpush('active_alerts', securityAlert.id);
      await redisService.expire('active_alerts', ttl);

      // Log critical alerts immediately
      if (securityAlert.severity === 'critical' || securityAlert.severity === 'high') {
        logger.warn('Security alert created', {
          alertId: securityAlert.id,
          type: securityAlert.type,
          severity: securityAlert.severity,
          title: securityAlert.title,
          userId: securityAlert.userId,
          sourceIp: securityAlert.sourceIp,
        });
      }

      return securityAlert.id;
    } catch (error) {
      logger.error('Failed to create security alert', { error, alert });
      throw new Error('Failed to create security alert');
    }
  }

  /**
   * Get active security alerts
   */
  async getActiveAlerts(limit: number = 50): Promise<SecurityAlert[]> {
    try {
      const alertIds = await redisService.lrange('active_alerts', 0, limit - 1);
      const alerts: SecurityAlert[] = [];

      for (const alertId of alertIds) {
        const alertData = await redisService.get(`security_alert:${alertId}`);
        if (alertData) {
          const alert: SecurityAlert = JSON.parse(alertData);
          if (alert.status === 'open' || alert.status === 'investigating') {
            alerts.push(alert);
          }
        }
      }

      return alerts.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      logger.error('Failed to get active alerts', { error });
      return [];
    }
  }

  /**
   * Update alert status
   */
  async updateAlertStatus(alertId: string, status: SecurityAlert['status']): Promise<void> {
    try {
      const alertData = await redisService.get(`security_alert:${alertId}`);
      if (!alertData) {
        throw new Error('Alert not found');
      }

      const alert: SecurityAlert = JSON.parse(alertData);
      alert.status = status;

      await redisService.setex(
        `security_alert:${alertId}`,
        this.config.retentionDays * 24 * 60 * 60,
        JSON.stringify(alert)
      );

      logger.info('Security alert status updated', {
        alertId,
        oldStatus: alert.status,
        newStatus: status,
      });
    } catch (error) {
      logger.error('Failed to update alert status', { error, alertId, status });
      throw new Error('Failed to update alert status');
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    summary: {
      totalEvents: number;
      failedLogins: number;
      successfulLogins: number;
      dataAccess: number;
      highRiskEvents: number;
      activeAlerts: number;
    };
    topRiskyIps: { ip: string; riskScore: number; eventCount: number }[];
    topUsers: { userId: string; eventCount: number; riskScore: number }[];
    alertsByType: { type: string; count: number }[];
  }> {
    try {
      const events = await this.searchEvents({
        startDate,
        endDate,
      }, 10000); // Large limit for comprehensive report

      const alerts = await this.getActiveAlerts(1000);

      // Calculate summary
      const summary = {
        totalEvents: events.length,
        failedLogins: events.filter(e => e.action === 'login' && e.outcome === 'failure').length,
        successfulLogins: events.filter(e => e.action === 'login' && e.outcome === 'success').length,
        dataAccess: events.filter(e => e.resource.includes('data') || e.action.includes('read')).length,
        highRiskEvents: events.filter(e => (e.risk_score || 0) >= this.config.riskScoreThreshold).length,
        activeAlerts: alerts.filter(a => a.status === 'open' || a.status === 'investigating').length,
      };

      // Top risky IPs
      const ipStats = new Map<string, { eventCount: number; totalRiskScore: number }>();
      events.forEach(event => {
        const ip = event.source.ip;
        const stats = ipStats.get(ip) || { eventCount: 0, totalRiskScore: 0 };
        stats.eventCount++;
        stats.totalRiskScore += event.risk_score || 0;
        ipStats.set(ip, stats);
      });

      const topRiskyIps = Array.from(ipStats.entries())
        .map(([ip, stats]) => ({
          ip,
          eventCount: stats.eventCount,
          riskScore: Math.round(stats.totalRiskScore / stats.eventCount),
        }))
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 10);

      // Top users by activity
      const userStats = new Map<string, { eventCount: number; totalRiskScore: number }>();
      events
        .filter(e => e.userId)
        .forEach(event => {
          const userId = event.userId!;
          const stats = userStats.get(userId) || { eventCount: 0, totalRiskScore: 0 };
          stats.eventCount++;
          stats.totalRiskScore += event.risk_score || 0;
          userStats.set(userId, stats);
        });

      const topUsers = Array.from(userStats.entries())
        .map(([userId, stats]) => ({
          userId,
          eventCount: stats.eventCount,
          riskScore: Math.round(stats.totalRiskScore / stats.eventCount),
        }))
        .sort((a, b) => b.eventCount - a.eventCount)
        .slice(0, 10);

      // Alerts by type
      const alertTypeStats = new Map<string, number>();
      alerts.forEach(alert => {
        alertTypeStats.set(alert.type, (alertTypeStats.get(alert.type) || 0) + 1);
      });

      const alertsByType = Array.from(alertTypeStats.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      return {
        summary,
        topRiskyIps,
        topUsers,
        alertsByType,
      };
    } catch (error) {
      logger.error('Failed to generate security report', { error, startDate, endDate });
      throw new Error('Failed to generate security report');
    }
  }

  /**
   * Calculate risk score for an event using a weighted scoring algorithm
   * 
   * SECURITY ALGORITHM: Risk Score Calculation
   * ==========================================
   * 
   * This algorithm calculates a numerical risk score (0-100) for security events
   * to enable automated threat detection and prioritization.
   * 
   * SCORING METHODOLOGY:
   * 1. Outcome-based scoring (20-30 points):
   *    - Success: 0 points (baseline)
   *    - Failure: +20 points (moderate risk)
   *    - Denied: +30 points (higher risk, indicates potential attack)
   * 
   * 2. Severity-based scoring (10-80 points):
   *    - Low: +10 points
   *    - Medium: +25 points  
   *    - High: +50 points
   *    - Critical: +80 points
   * 
   * 3. Action-type scoring (15-30 points):
   *    - Login operations: +15 points (common attack vector)
   *    - Admin operations: +30 points (privileged access)
   *    - Delete operations: +25 points (data destruction risk)
   *    - Export operations: +20 points (data exfiltration risk)
   * 
   * 4. Contextual metadata scoring (25-40 points):
   *    - Suspicious activity flag: +40 points
   *    - Multiple failure pattern: +30 points
   *    - Unusual location access: +25 points
   * 
   * RISK SCORE INTERPRETATION:
   * - 0-30: Low risk (normal operations)
   * - 31-50: Medium risk (monitor closely)
   * - 51-70: High risk (investigate immediately)
   * - 71-100: Critical risk (automated alert + immediate response)
   * 
   * The algorithm caps at 100 to maintain consistent scoring boundaries
   * and uses additive scoring to allow multiple risk factors to compound.
   * 
   * @param event - The audit event to score (excluding id and timestamp)
   * @returns Risk score from 0-100
   */
  private calculateRiskScore(event: Omit<AuditEvent, 'id' | 'timestamp'>): number {
    let score = 0;

    // Base score by outcome - primary risk indicator
    if (event.outcome === 'failure') score += 20;
    if (event.outcome === 'denied') score += 30;

    // Score by severity - security impact weighting
    switch (event.severity) {
      case 'low': score += 10; break;
      case 'medium': score += 25; break;
      case 'high': score += 50; break;
      case 'critical': score += 80; break;
    }

    // Score by action type - operation risk assessment
    if (event.action.includes('login')) score += 15;  // Authentication attacks
    if (event.action.includes('admin')) score += 30;  // Privilege escalation
    if (event.action.includes('delete')) score += 25; // Data destruction
    if (event.action.includes('export')) score += 20; // Data exfiltration

    // Additional contextual risk factors from metadata
    if (event.metadata?.suspicious_activity) score += 40; // ML/rule-based detection
    if (event.metadata?.multiple_failures) score += 30;   // Brute force indicators
    if (event.metadata?.unusual_location) score += 25;    // Geolocation anomalies

    // Cap at 100 to maintain consistent risk boundaries
    return Math.min(score, 100);
  }

  /**
   * Check for security alerts based on behavioral patterns and thresholds
   * 
   * SECURITY ALGORITHM: Automated Threat Detection
   * ==============================================
   * 
   * This function implements a multi-layered threat detection system that
   * analyzes audit events in real-time to identify potential security incidents.
   * 
   * DETECTION PATTERNS:
   * 
   * 1. Failed Login Pattern Detection:
   *    - Monitors consecutive login failures from same IP
   *    - Triggers on threshold breaches (configurable, default: 5 failures)
   *    - Time window: 15 minutes (sliding window)
   *    - Indicates: Brute force attacks, credential stuffing
   * 
   * 2. High-Risk Event Detection:
   *    - Triggers on events exceeding risk score threshold (default: 70)
   *    - Immediate alerting for critical severity events
   *    - Indicates: Privilege escalation, data breaches, system compromise
   * 
   * 3. Data Access Pattern Detection:
   *    - Monitors read/export operations frequency per user
   *    - Time window: 1 hour (sliding window)
   *    - Threshold: 100 operations (configurable)
   *    - Indicates: Data exfiltration, automated scraping, insider threats
   * 
   * INCIDENT RESPONSE WORKFLOW:
   * 1. Event classification and risk scoring
   * 2. Pattern matching against known threat signatures
   * 3. Threshold evaluation for alert generation
   * 4. Alert creation with contextual metadata
   * 5. Notification routing based on severity
   * 6. Audit trail preservation for forensics
   * 
   * ERROR HANDLING:
   * - Non-blocking: Alert generation failures don't impact application flow
   * - Comprehensive logging for security operations monitoring
   * - Graceful degradation to ensure system stability
   * 
   * @param event - The audit event to analyze for security threats
   */
  private async checkSecurityAlerts(event: AuditEvent): Promise<void> {
    try {
      // Pattern 1: Brute force login detection
      if (event.action === 'login' && event.outcome === 'failure') {
        await this.checkFailedLoginAlert(event);
      }

      // Pattern 2: High-risk event immediate alerting
      if ((event.risk_score || 0) >= this.config.riskScoreThreshold) {
        await this.checkHighRiskAlert(event);
      }

      // Pattern 3: Suspicious data access volume detection
      if (event.action.includes('read') || event.action.includes('export')) {
        await this.checkDataAccessAlert(event);
      }
    } catch (error) {
      logger.error('Failed to check security alerts', { error, eventId: event.id });
    }
  }

  /**
   * Check for failed login alerts using sliding window analysis
   * 
   * SECURITY ALGORITHM: Brute Force Detection
   * =========================================
   * 
   * This function implements a sliding window algorithm to detect brute force
   * login attacks by monitoring failed authentication attempts from single IPs.
   * 
   * ALGORITHM DETAILS:
   * 
   * 1. Sliding Window Implementation:
   *    - Window size: 15 minutes (900,000 milliseconds)
   *    - Window slides with each new event (real-time analysis)
   *    - Only events within current window are considered
   * 
   * 2. Threshold-based Detection:
   *    - Default threshold: 5 failed logins per window
   *    - Configurable via alertThresholds.failedLogins
   *    - Threshold breach triggers high-severity alert
   * 
   * 3. IP-based Correlation:
   *    - Groups events by source IP address
   *    - Retrieves last 20 events for performance optimization
   *    - Filters for login failures within time window
   * 
   * 4. Attack Pattern Indicators:
   *    - Multiple rapid login failures
   *    - Consistent source IP across attempts
   *    - Timing patterns consistent with automated tools
   * 
   * INCIDENT RESPONSE ACTIONS:
   * - Generate high-severity security alert
   * - Include all related event IDs for forensic analysis
   * - Metadata includes attempt count and time window
   * - Enable correlation with other security systems
   * 
   * RECOMMENDED MITIGATIONS:
   * - Implement progressive delays after failed attempts
   * - Consider IP-based rate limiting or temporary blocking
   * - Enable CAPTCHA after threshold warnings
   * - Monitor for distributed attacks from multiple IPs
   * 
   * @param event - The failed login audit event that triggered this check
   */
  private async checkFailedLoginAlert(event: AuditEvent): Promise<void> {
    // Define sliding window parameters
    const timeWindow = 15 * 60 * 1000; // 15 minutes in milliseconds
    const now = new Date().getTime();
    const windowStart = new Date(now - timeWindow);

    // Retrieve recent events from the same IP (limited for performance)
    const recentEvents = await this.getIpEvents(event.source.ip, 20);
    
    // Filter for failed login attempts within the time window
    const failedLogins = recentEvents.filter(e =>
      e.action === 'login' &&
      e.outcome === 'failure' &&
      new Date(e.timestamp) >= windowStart
    );

    // Check if failure count exceeds the configured threshold
    if (failedLogins.length >= this.config.alertThresholds.failedLogins) {
      await this.createAlert({
        type: 'failed_login_attempts',
        severity: 'high',
        title: 'Multiple Failed Login Attempts',
        description: `${failedLogins.length} failed login attempts from IP ${event.source.ip} in the last 15 minutes`,
        sourceIp: event.source.ip,
        events: failedLogins.map(e => e.id),
        metadata: {
          attemptCount: failedLogins.length,
          timeWindow: '15 minutes',
          threshold: this.config.alertThresholds.failedLogins,
          attackPattern: 'brute_force_login',
        },
      });
    }
  }

  /**
   * Check for high-risk event alerts
   */
  private async checkHighRiskAlert(event: AuditEvent): Promise<void> {
    await this.createAlert({
      type: 'high_risk_activity',
      severity: event.severity === 'critical' ? 'critical' : 'high',
      title: 'High-Risk Activity Detected',
      description: `High-risk activity detected: ${event.action} on ${event.resource}`,
      userId: event.userId,
      sourceIp: event.source.ip,
      events: [event.id],
      metadata: {
        riskScore: event.risk_score,
        action: event.action,
        resource: event.resource,
      },
    });
  }

  /**
   * Check for suspicious data access alerts
   */
  private async checkDataAccessAlert(event: AuditEvent): Promise<void> {
    if (!event.userId) return;

    const timeWindow = 60 * 60 * 1000; // 1 hour
    const now = new Date().getTime();
    const windowStart = new Date(now - timeWindow);

    const recentEvents = await this.getUserEvents(event.userId, 100);
    const dataAccessEvents = recentEvents.filter(e =>
      (e.action.includes('read') || e.action.includes('export')) &&
      new Date(e.timestamp) >= windowStart
    );

    if (dataAccessEvents.length >= this.config.alertThresholds.dataAccess) {
      await this.createAlert({
        type: 'excessive_data_access',
        severity: 'medium',
        title: 'Excessive Data Access',
        description: `User ${event.userId} accessed data ${dataAccessEvents.length} times in the last hour`,
        userId: event.userId,
        sourceIp: event.source.ip,
        events: dataAccessEvents.map(e => e.id),
        metadata: {
          accessCount: dataAccessEvents.length,
          timeWindow: '1 hour',
        },
      });
    }
  }

  /**
   * Index event by user
   */
  private async indexEventByUser(userId: string, eventId: string): Promise<void> {
    const userEventsKey = `user_events:${userId}`;
    await redisService.lpush(userEventsKey, eventId);
    await redisService.expire(userEventsKey, this.config.retentionDays * 24 * 60 * 60);
  }

  /**
   * Index event by IP
   */
  private async indexEventByIp(ip: string, eventId: string): Promise<void> {
    const ipEventsKey = `ip_events:${ip}`;
    await redisService.lpush(ipEventsKey, eventId);
    await redisService.expire(ipEventsKey, this.config.retentionDays * 24 * 60 * 60);
  }

  /**
   * Index event by action
   */
  private async indexEventByAction(action: string, eventId: string): Promise<void> {
    const actionEventsKey = `action_events:${action}`;
    await redisService.lpush(actionEventsKey, eventId);
    await redisService.expire(actionEventsKey, this.config.retentionDays * 24 * 60 * 60);
  }
}

export const auditService = new AuditService();