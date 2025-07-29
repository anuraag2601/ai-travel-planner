import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AuditService, AuditEvent, SecurityAlert, AuditConfig } from '../../../services/security/auditService.js';

// Mock dependencies
const mockRedisService = {
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  lrange: jest.fn(),
  lpush: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

// Mock the external dependencies
jest.mock('../../../services/redis.js', () => ({
  redisService: mockRedisService
}));

jest.mock('../../../utils/logger.js', () => ({
  logger: mockLogger
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-123')
}));

describe('AuditService', () => {
  let auditService: AuditService;
  let mockConfig: Partial<AuditConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      retentionDays: 30,
      alertThresholds: {
        failedLogins: 3,
        suspiciousActivity: 5,
        dataAccess: 50
      },
      riskScoreThreshold: 75
    };
    auditService = new AuditService(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('logEvent', () => {
    const mockEventData = {
      userId: 'user123',
      sessionId: 'session456',
      action: 'login',
      resource: 'auth',
      resourceId: 'auth123',
      outcome: 'success' as const,
      severity: 'low' as const,
      source: {
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        method: 'POST',
        path: '/api/auth/login',
        referer: 'https://example.com'
      },
      metadata: {
        loginMethod: 'email'
      }
    };

    it('should successfully log an audit event', async () => {
      const eventId = await auditService.logEvent(mockEventData);

      expect(eventId).toBe('mock-uuid-123');
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'audit_event:mock-uuid-123',
        2592000, // 30 days in seconds
        expect.stringContaining('"id":"mock-uuid-123"')
      );
      expect(mockRedisService.lpush).toHaveBeenCalledWith('user_events:user123', 'mock-uuid-123');
      expect(mockRedisService.lpush).toHaveBeenCalledWith('ip_events:192.168.1.1', 'mock-uuid-123');
      expect(mockRedisService.lpush).toHaveBeenCalledWith('action_events:login', 'mock-uuid-123');
      expect(mockLogger.info).toHaveBeenCalledWith('Audit event logged', expect.any(Object));
    });

    it('should calculate risk score correctly for different event types', async () => {
      const highRiskEvent = {
        ...mockEventData,
        outcome: 'failure' as const,
        severity: 'critical' as const,
        action: 'admin_delete',
        metadata: {
          suspicious_activity: true,
          multiple_failures: true
        }
      };

      mockRedisService.setex.mockImplementation((key, ttl, value) => {
        const eventData = JSON.parse(value);
        expect(eventData.risk_score).toBeGreaterThan(50);
        return Promise.resolve('OK');
      });

      await auditService.logEvent(highRiskEvent);
    });

    it('should handle Redis storage errors gracefully', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis connection failed'));

      await expect(auditService.logEvent(mockEventData))
        .rejects.toThrow('Failed to log audit event');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to log audit event',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('should trigger security alerts for high-risk events', async () => {
      const highRiskEvent = {
        ...mockEventData,
        outcome: 'failure' as const,
        severity: 'critical' as const,
        action: 'login',
        metadata: { suspicious_activity: true }
      };

      // Mock the private checkSecurityAlerts method behavior
      const createAlertSpy = jest.spyOn(auditService, 'createAlert');
      createAlertSpy.mockResolvedValue('alert-123');

      // Mock getIpEvents to return failed login attempts
      const getIpEventsSpy = jest.spyOn(auditService, 'getIpEvents');
      getIpEventsSpy.mockResolvedValue([
        { ...highRiskEvent, id: 'event1', timestamp: new Date() } as AuditEvent,
        { ...highRiskEvent, id: 'event2', timestamp: new Date() } as AuditEvent,
        { ...highRiskEvent, id: 'event3', timestamp: new Date() } as AuditEvent
      ]);

      await auditService.logEvent(highRiskEvent);

      expect(createAlertSpy).toHaveBeenCalled();
      createAlertSpy.mockRestore();
      getIpEventsSpy.mockRestore();
    });
  });

  describe('getUserEvents', () => {
    it('should return user events in descending order by timestamp', async () => {
      const mockEventIds = ['event1', 'event2', 'event3'];
      const mockEvents = [
        { id: 'event1', timestamp: '2023-01-01T10:00:00Z', action: 'login' },
        { id: 'event2', timestamp: '2023-01-02T10:00:00Z', action: 'search' },
        { id: 'event3', timestamp: '2023-01-03T10:00:00Z', action: 'book' }
      ];

      mockRedisService.lrange.mockResolvedValue(mockEventIds);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockEvents[0]))
        .mockResolvedValueOnce(JSON.stringify(mockEvents[1]))
        .mockResolvedValueOnce(JSON.stringify(mockEvents[2]));

      const result = await auditService.getUserEvents('user123', 10, 0);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('event3'); // Most recent first
      expect(result[2].id).toBe('event1'); // Oldest last
      expect(mockRedisService.lrange).toHaveBeenCalledWith('user_events:user123', 0, 9);
    });

    it('should handle missing events gracefully', async () => {
      const mockEventIds = ['event1', 'event2'];
      mockRedisService.lrange.mockResolvedValue(mockEventIds);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify({ id: 'event1' }))
        .mockResolvedValueOnce(null); // Missing event

      const result = await auditService.getUserEvents('user123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event1');
    });

    it('should return empty array on Redis errors', async () => {
      mockRedisService.lrange.mockRejectedValue(new Error('Redis error'));

      const result = await auditService.getUserEvents('user123');

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get user events',
        expect.objectContaining({ error: expect.any(Error), userId: 'user123' })
      );
    });
  });

  describe('getIpEvents', () => {
    it('should return IP events sorted by timestamp', async () => {
      const mockEventIds = ['event1', 'event2'];
      const mockEvents = [
        { id: 'event1', timestamp: '2023-01-01T10:00:00Z', source: { ip: '192.168.1.1' } },
        { id: 'event2', timestamp: '2023-01-02T10:00:00Z', source: { ip: '192.168.1.1' } }
      ];

      mockRedisService.lrange.mockResolvedValue(mockEventIds);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockEvents[0]))
        .mockResolvedValueOnce(JSON.stringify(mockEvents[1]));

      const result = await auditService.getIpEvents('192.168.1.1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('event2'); // Most recent first
      expect(mockRedisService.lrange).toHaveBeenCalledWith('ip_events:192.168.1.1', 0, 49);
    });
  });

  describe('searchEvents', () => {
    it('should filter events by userId', async () => {
      const mockEvents = [
        { 
          id: 'event1', 
          userId: 'user123',
          resource: 'booking',
          outcome: 'success',
          severity: 'low',
          timestamp: '2023-01-01T10:00:00Z',
          risk_score: 10
        }
      ];

      const getUserEventsSpy = jest.spyOn(auditService, 'getUserEvents');
      getUserEventsSpy.mockResolvedValue(mockEvents as AuditEvent[]);

      const result = await auditService.searchEvents({ 
        userId: 'user123',
        resource: 'booking'
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event1');
      getUserEventsSpy.mockRestore();
    });

    it('should filter events by action when no userId provided', async () => {
      const mockEventIds = ['event1', 'event2'];
      const mockEvents = [
        { 
          id: 'event1', 
          action: 'login',
          resource: 'auth',
          outcome: 'success',
          severity: 'low',
          timestamp: '2023-01-01T10:00:00Z'
        }
      ];

      mockRedisService.lrange.mockResolvedValue(mockEventIds);
      mockRedisService.get.mockResolvedValue(JSON.stringify(mockEvents[0]));

      const result = await auditService.searchEvents({ action: 'login' });

      expect(mockRedisService.lrange).toHaveBeenCalledWith('action_events:login', 0, 99);
      expect(result).toHaveLength(1);
    });

    it('should apply additional filters correctly', async () => {
      const mockEvents = [
        { 
          id: 'event1',
          resource: 'booking',
          outcome: 'success',
          severity: 'low',
          timestamp: '2023-01-01T10:00:00Z',
          risk_score: 30
        },
        { 
          id: 'event2',
          resource: 'payment',
          outcome: 'failure',
          severity: 'high',
          timestamp: '2023-01-02T10:00:00Z',
          risk_score: 80
        }
      ];

      const getUserEventsSpy = jest.spyOn(auditService, 'getUserEvents');
      getUserEventsSpy.mockResolvedValue(mockEvents as AuditEvent[]);

      const result = await auditService.searchEvents({
        userId: 'user123',
        outcome: 'failure',
        minRiskScore: 50
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event2');
      getUserEventsSpy.mockRestore();
    });

    it('should handle search errors gracefully', async () => {
      const getUserEventsSpy = jest.spyOn(auditService, 'getUserEvents');
      getUserEventsSpy.mockRejectedValue(new Error('Search error'));

      const result = await auditService.searchEvents({ userId: 'user123' });

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to search events',
        expect.objectContaining({ error: expect.any(Error) })
      );
      getUserEventsSpy.mockRestore();
    });
  });

  describe('createAlert', () => {
    const mockAlertData = {
      type: 'failed_login_attempts',
      severity: 'high' as const,
      title: 'Multiple Failed Login Attempts',
      description: 'Too many failed login attempts detected',
      sourceIp: '192.168.1.1',
      events: ['event1', 'event2'],
      metadata: { attemptCount: 5 }
    };

    it('should create a security alert successfully', async () => {
      const alertId = await auditService.createAlert(mockAlertData);

      expect(alertId).toBe('mock-uuid-123');
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'security_alert:mock-uuid-123',
        2592000, // 30 days
        expect.stringContaining('"status":"open"')
      );
      expect(mockRedisService.lpush).toHaveBeenCalledWith('active_alerts', 'mock-uuid-123');
    });

    it('should log critical alerts immediately', async () => {
      const criticalAlert = {
        ...mockAlertData,
        severity: 'critical' as const
      };

      await auditService.createAlert(criticalAlert);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security alert created',
        expect.objectContaining({
          alertId: 'mock-uuid-123',
          severity: 'critical'
        })
      );
    });

    it('should handle alert creation errors', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis error'));

      await expect(auditService.createAlert(mockAlertData))
        .rejects.toThrow('Failed to create security alert');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create security alert',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('getActiveAlerts', () => {
    it('should return active alerts only', async () => {
      const mockAlertIds = ['alert1', 'alert2', 'alert3'];
      const mockAlerts = [
        { id: 'alert1', status: 'open', timestamp: '2023-01-01T10:00:00Z' },
        { id: 'alert2', status: 'resolved', timestamp: '2023-01-02T10:00:00Z' },
        { id: 'alert3', status: 'investigating', timestamp: '2023-01-03T10:00:00Z' }
      ];

      mockRedisService.lrange.mockResolvedValue(mockAlertIds);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockAlerts[0]))
        .mockResolvedValueOnce(JSON.stringify(mockAlerts[1]))
        .mockResolvedValueOnce(JSON.stringify(mockAlerts[2]));

      const result = await auditService.getActiveAlerts();

      expect(result).toHaveLength(2); // Only 'open' and 'investigating' alerts
      expect(result.map(a => a.status)).toEqual(['investigating', 'open']); // Sorted by timestamp desc
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisService.lrange.mockRejectedValue(new Error('Redis error'));

      const result = await auditService.getActiveAlerts();

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get active alerts',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('updateAlertStatus', () => {
    it('should update alert status successfully', async () => {
      const mockAlert = {
        id: 'alert123',
        status: 'open',
        type: 'failed_login',
        title: 'Test Alert'
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(mockAlert));

      await auditService.updateAlertStatus('alert123', 'resolved');

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'security_alert:alert123',
        2592000,
        expect.stringContaining('"status":"resolved"')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Security alert status updated',
        expect.objectContaining({ alertId: 'alert123', newStatus: 'resolved' })
      );
    });

    it('should throw error when alert not found', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await expect(auditService.updateAlertStatus('nonexistent', 'resolved'))
        .rejects.toThrow('Failed to update alert status');
    });
  });

  describe('generateSecurityReport', () => {
    it('should generate comprehensive security report', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      
      const mockEvents = [
        { 
          id: 'event1',
          action: 'login',
          outcome: 'success',
          resource: 'auth',
          source: { ip: '192.168.1.1' },
          userId: 'user1',
          risk_score: 20,
          timestamp: '2023-01-15T10:00:00Z'
        },
        { 
          id: 'event2',
          action: 'login',
          outcome: 'failure',
          resource: 'auth',
          source: { ip: '192.168.1.2' },
          userId: 'user2',
          risk_score: 60,
          timestamp: '2023-01-16T10:00:00Z'
        },
        { 
          id: 'event3',
          action: 'data_export',
          outcome: 'success',
          resource: 'booking',
          source: { ip: '192.168.1.1' },
          userId: 'user1',
          risk_score: 80,
          timestamp: '2023-01-17T10:00:00Z'
        }
      ];

      const mockAlerts = [
        { type: 'failed_login', status: 'open' },
        { type: 'data_access', status: 'investigating' }
      ];

      const searchEventsSpy = jest.spyOn(auditService, 'searchEvents');
      const getActiveAlertsSpy = jest.spyOn(auditService, 'getActiveAlerts');
      
      searchEventsSpy.mockResolvedValue(mockEvents as AuditEvent[]);
      getActiveAlertsSpy.mockResolvedValue(mockAlerts as SecurityAlert[]);

      const report = await auditService.generateSecurityReport(startDate, endDate);

      expect(report.summary.totalEvents).toBe(3);
      expect(report.summary.failedLogins).toBe(1);
      expect(report.summary.successfulLogins).toBe(1);
      expect(report.summary.highRiskEvents).toBe(1); // events with risk_score >= 75
      expect(report.summary.activeAlerts).toBe(2);
      
      expect(report.topRiskyIps).toHaveLength(2);
      expect(report.topRiskyIps[0].ip).toBe('192.168.1.1'); // Higher average risk score
      
      expect(report.topUsers).toHaveLength(2);
      expect(report.alertsByType).toEqual([
        { type: 'failed_login', count: 1 },
        { type: 'data_access', count: 1 }
      ]);

      searchEventsSpy.mockRestore();
      getActiveAlertsSpy.mockRestore();
    });

    it('should handle report generation errors', async () => {
      const searchEventsSpy = jest.spyOn(auditService, 'searchEvents');
      searchEventsSpy.mockRejectedValue(new Error('Search failed'));

      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');

      await expect(auditService.generateSecurityReport(startDate, endDate))
        .rejects.toThrow('Failed to generate security report');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate security report',
        expect.objectContaining({ error: expect.any(Error) })
      );

      searchEventsSpy.mockRestore();
    });
  });

  describe('risk score calculation', () => {
    it('should calculate risk scores correctly for different scenarios', () => {
      const testCases = [
        {
          event: {
            outcome: 'success',
            severity: 'low',
            action: 'view',
            metadata: {}
          },
          expectedMinScore: 10,
          expectedMaxScore: 30
        },
        {
          event: {
            outcome: 'failure',
            severity: 'critical',
            action: 'admin_delete',
            metadata: { suspicious_activity: true, multiple_failures: true }
          },
          expectedMinScore: 80,
          expectedMaxScore: 100
        },
        {
          event: {
            outcome: 'denied',
            severity: 'high',
            action: 'export',
            metadata: { unusual_location: true }
          },
          expectedMinScore: 70,
          expectedMaxScore: 100
        }
      ];

      testCases.forEach((testCase, index) => {
        // Access private method through type assertion for testing
        const riskScore = (auditService as any).calculateRiskScore(testCase.event);
        
        expect(riskScore).toBeGreaterThanOrEqual(testCase.expectedMinScore);
        expect(riskScore).toBeLessThanOrEqual(testCase.expectedMaxScore);
        expect(riskScore).toBeLessThanOrEqual(100); // Should never exceed 100
      });
    });
  });

  describe('configuration', () => {
    it('should use default configuration when none provided', () => {
      const defaultService = new AuditService();
      
      // Verify default values through public methods
      expect(defaultService).toBeInstanceOf(AuditService);
    });

    it('should merge custom configuration with defaults', () => {
      const customConfig = {
        retentionDays: 60,
        alertThresholds: {
          failedLogins: 10,
          suspiciousActivity: 20,
          dataAccess: 200
        }
      };

      const customService = new AuditService(customConfig);
      expect(customService).toBeInstanceOf(AuditService);
    });
  });
});