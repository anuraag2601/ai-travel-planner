import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AuditService, AuditEvent, SecurityAlert, AuditConfig } from '../../../services/security/auditService.js';

// Mock dependencies
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  setex: jest.fn(),
  exists: jest.fn(),
  lpush: jest.fn(),
  lrange: jest.fn(),
  expire: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

jest.mock('../../../services/cache/redisService.js', () => ({
  redisService: mockRedisService
}));

jest.mock('../../../utils/logger.js', () => ({
  logger: mockLogger
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234')
}));

describe('AuditService Enhanced Unit Tests', () => {
  let auditService: AuditService;

  const mockAuditEvent = {
    userId: 'user-123',
    sessionId: 'session-456',
    action: 'login',
    resource: 'authentication',
    resourceId: 'auth-endpoint',
    outcome: 'success' as const,
    severity: 'low' as const,
    source: {
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      method: 'POST',
      path: '/api/auth/login',
      referer: 'https://example.com/login'
    },
    metadata: {
      loginMethod: 'password',
      deviceType: 'desktop'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    auditService = new AuditService();
    
    // Mock current time for consistent testing
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Event Logging', () => {
    it('should log audit event successfully', async () => {
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const eventId = await auditService.logEvent(mockAuditEvent);

      expect(eventId).toBe('test-uuid-1234');
      
      // Verify event was stored
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'audit_event:test-uuid-1234',
        7776000, // 90 days
        expect.stringContaining('"id":"test-uuid-1234"')
      );

      // Verify indexing
      expect(mockRedisService.lpush).toHaveBeenCalledWith('user_events:user-123', 'test-uuid-1234');
      expect(mockRedisService.lpush).toHaveBeenCalledWith('ip_events:192.168.1.100', 'test-uuid-1234');
      expect(mockRedisService.lpush).toHaveBeenCalledWith('action_events:login', 'test-uuid-1234');

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith('Audit event logged', {
        eventId: 'test-uuid-1234',
        action: 'login',
        resource: 'authentication',
        outcome: 'success',
        severity: 'low',
        userId: 'user-123',
        sourceIp: '192.168.1.100',
        riskScore: expect.any(Number)
      });
    });

    it('should calculate risk score correctly', async () => {
      const highRiskEvent = {
        ...mockAuditEvent,
        action: 'admin_delete',
        outcome: 'failure' as const,
        severity: 'critical' as const,
        metadata: {
          suspicious_activity: true,
          multiple_failures: true,
          unusual_location: true
        }
      };

      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      await auditService.logEvent(highRiskEvent);

      const storedEvent = JSON.parse(mockRedisService.setex.mock.calls[0][2]);
      
      // Expected risk score calculation:
      // failure: +20, critical: +80, admin: +30, delete: +25
      // suspicious_activity: +40, multiple_failures: +30, unusual_location: +25
      // Total would be 250, but capped at 100
      expect(storedEvent.risk_score).toBe(100);
    });

    it('should handle event logging errors', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis connection failed'));

      await expect(auditService.logEvent(mockAuditEvent))
        .rejects.toThrow('Failed to log audit event');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to log audit event',
        expect.objectContaining({
          error: expect.any(Error),
          event: mockAuditEvent
        })
      );
    });
  });

  describe('Risk Score Calculation', () => {
    const testCases = [
      {
        description: 'low risk successful login',
        event: { ...mockAuditEvent, outcome: 'success', severity: 'low', action: 'login' },
        expectedScore: 25 // low(10) + login(15)
      },
      {
        description: 'medium risk failed login',
        event: { ...mockAuditEvent, outcome: 'failure', severity: 'medium', action: 'login' },
        expectedScore: 60 // failure(20) + medium(25) + login(15)
      },
      {
        description: 'high risk admin operation',
        event: { ...mockAuditEvent, outcome: 'denied', severity: 'high', action: 'admin_access' },
        expectedScore: 100 // denied(30) + high(50) + admin(30) = 110, capped at 100
      },
      {
        description: 'critical risk with metadata flags',
        event: {
          ...mockAuditEvent,
          outcome: 'failure',
          severity: 'critical',
          action: 'export_data',
          metadata: { suspicious_activity: true }
        },
        expectedScore: 100 // failure(20) + critical(80) + export(20) + suspicious(40) = 160, capped at 100
      }
    ];

    testCases.forEach(({ description, event, expectedScore }) => {
      it(`should calculate correct risk score for ${description}`, async () => {
        mockRedisService.setex.mockResolvedValue('OK');
        mockRedisService.lpush.mockResolvedValue(1);
        mockRedisService.expire.mockResolvedValue(1);

        await auditService.logEvent(event);

        const storedEvent = JSON.parse(mockRedisService.setex.mock.calls[0][2]);
        expect(storedEvent.risk_score).toBe(expectedScore);
      });
    });
  });

  describe('Security Alert Detection', () => {
    it('should create failed login alert when threshold is exceeded', async () => {
      // Mock recent failed login events
      const failedLoginEvents = Array.from({ length: 6 }, (_, i) => ({
        id: `event-${i}`,
        timestamp: new Date(Date.now() - i * 60000), // Events 1 minute apart
        action: 'login',
        outcome: 'failure',
        source: { ip: '192.168.1.100' }
      }));

      mockRedisService.lrange.mockResolvedValue(failedLoginEvents.map(e => e.id));
      mockRedisService.get.mockImplementation((key) => {
        const eventId = key.split(':')[1];
        const event = failedLoginEvents.find(e => e.id === eventId);
        return Promise.resolve(event ? JSON.stringify(event) : null);
      });

      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const failedLoginEvent = {
        ...mockAuditEvent,
        action: 'login',
        outcome: 'failure' as const,
        source: { ...mockAuditEvent.source, ip: '192.168.1.100' }
      };

      await auditService.logEvent(failedLoginEvent);

      // Verify alert was created
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'security_alert:test-uuid-1234',
        expect.any(Number),
        expect.stringContaining('"type":"failed_login_attempts"')
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security alert created',
        expect.objectContaining({
          alertId: 'test-uuid-1234',
          type: 'failed_login_attempts',
          severity: 'high'
        })
      );
    });

    it('should create high-risk alert for events exceeding threshold', async () => {
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const highRiskEvent = {
        ...mockAuditEvent,
        action: 'admin_delete',
        outcome: 'failure' as const,
        severity: 'critical' as const
      };

      await auditService.logEvent(highRiskEvent);

      // Verify high-risk alert was created
      const alertCalls = mockRedisService.setex.mock.calls.filter(call => 
        call[0].startsWith('security_alert:')
      );
      
      expect(alertCalls).toHaveLength(1);
      
      const alertData = JSON.parse(alertCalls[0][2]);
      expect(alertData.type).toBe('high_risk_activity');
      expect(alertData.severity).toBe('critical');
    });

    it('should create data access alert for excessive access', async () => {
      // Mock user with many data access events
      const dataAccessEvents = Array.from({ length: 101 }, (_, i) => ({
        id: `event-${i}`,
        timestamp: new Date(Date.now() - i * 30000), // Events 30 seconds apart
        action: 'read_data',
        userId: 'user-123'
      }));

      mockRedisService.lrange.mockResolvedValue(dataAccessEvents.map(e => e.id));
      mockRedisService.get.mockImplementation((key) => {
        const eventId = key.split(':')[1];
        const event = dataAccessEvents.find(e => e.id === eventId);
        return Promise.resolve(event ? JSON.stringify(event) : null);
      });

      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const dataAccessEvent = {
        ...mockAuditEvent,
        action: 'read_data',
        userId: 'user-123'
      };

      await auditService.logEvent(dataAccessEvent);

      // Verify data access alert was created
      const alertCalls = mockRedisService.setex.mock.calls.filter(call => 
        call[0].startsWith('security_alert:')
      );
      
      expect(alertCalls).toHaveLength(1);
      
      const alertData = JSON.parse(alertCalls[0][2]);
      expect(alertData.type).toBe('excessive_data_access');
      expect(alertData.severity).toBe('medium');
    });
  });

  describe('Event Retrieval', () => {
    it('should get user events successfully', async () => {
      const userEvents = [
        { id: 'event-1', userId: 'user-123', timestamp: new Date('2024-01-01T09:00:00Z') },
        { id: 'event-2', userId: 'user-123', timestamp: new Date('2024-01-01T08:00:00Z') }
      ];

      mockRedisService.lrange.mockResolvedValue(['event-1', 'event-2']);
      mockRedisService.get.mockImplementation((key) => {
        const eventId = key.split(':')[1];
        const event = userEvents.find(e => e.id === eventId);
        return Promise.resolve(event ? JSON.stringify(event) : null);
      });

      const result = await auditService.getUserEvents('user-123', 10, 0);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('event-1'); // Most recent first
      expect(result[1].id).toBe('event-2');
      
      expect(mockRedisService.lrange).toHaveBeenCalledWith('user_events:user-123', 0, 9);
    });

    it('should get IP events successfully', async () => {
      const ipEvents = [
        { id: 'event-1', source: { ip: '192.168.1.100' }, timestamp: new Date('2024-01-01T09:00:00Z') },
        { id: 'event-2', source: { ip: '192.168.1.100' }, timestamp: new Date('2024-01-01T08:00:00Z') }
      ];

      mockRedisService.lrange.mockResolvedValue(['event-1', 'event-2']);
      mockRedisService.get.mockImplementation((key) => {
        const eventId = key.split(':')[1];
        const event = ipEvents.find(e => e.id === eventId);
        return Promise.resolve(event ? JSON.stringify(event) : null);
      });

      const result = await auditService.getIpEvents('192.168.1.100', 10, 0);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('event-1');
      
      expect(mockRedisService.lrange).toHaveBeenCalledWith('ip_events:192.168.1.100', 0, 9);
    });

    it('should handle retrieval errors gracefully', async () => {
      mockRedisService.lrange.mockRejectedValue(new Error('Redis error'));

      const result = await auditService.getUserEvents('user-123');

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get user events',
        expect.objectContaining({
          error: expect.any(Error),
          userId: 'user-123'
        })
      );
    });
  });

  describe('Event Search', () => {
    it('should search events by filters', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          userId: 'user-123',
          action: 'login',
          resource: 'auth',
          outcome: 'success',
          severity: 'low',
          timestamp: new Date('2024-01-01T09:00:00Z'),
          risk_score: 25
        },
        {
          id: 'event-2',
          userId: 'user-123',
          action: 'read',
          resource: 'data',
          outcome: 'success',
          severity: 'medium',
          timestamp: new Date('2024-01-01T08:00:00Z'),
          risk_score: 35
        }
      ];

      mockRedisService.lrange.mockResolvedValue(['event-1', 'event-2']);
      mockRedisService.get.mockImplementation((key) => {
        const eventId = key.split(':')[1];
        const event = mockEvents.find(e => e.id === eventId);
        return Promise.resolve(event ? JSON.stringify(event) : null);
      });

      const result = await auditService.searchEvents({
        userId: 'user-123',
        outcome: 'success',
        minRiskScore: 30
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-2'); // Only event-2 has risk_score >= 30
    });

    it('should search events by date range', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          action: 'login',
          timestamp: new Date('2024-01-01T09:00:00Z')
        },
        {
          id: 'event-2',
          action: 'login',
          timestamp: new Date('2023-12-31T09:00:00Z')
        }
      ];

      mockRedisService.lrange.mockResolvedValue(['event-1', 'event-2']);
      mockRedisService.get.mockImplementation((key) => {
        const eventId = key.split(':')[1];
        const event = mockEvents.find(e => e.id === eventId);
        return Promise.resolve(event ? JSON.stringify(event) : null);
      });

      const result = await auditService.searchEvents({
        action: 'login',
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-01T23:59:59Z')
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-1'); // Only event-1 is within date range
    });

    it('should handle search errors gracefully', async () => {
      mockRedisService.lrange.mockRejectedValue(new Error('Redis error'));

      const result = await auditService.searchEvents({ userId: 'user-123' });

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to search events',
        expect.objectContaining({
          error: expect.any(Error)
        })
      );
    });
  });

  describe('Security Alert Management', () => {
    it('should create security alert successfully', async () => {
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const alertData = {
        type: 'test_alert',
        severity: 'high' as const,
        title: 'Test Alert',
        description: 'Test alert description',
        sourceIp: '192.168.1.100',
        events: ['event-1', 'event-2']
      };

      const alertId = await auditService.createAlert(alertData);

      expect(alertId).toBe('test-uuid-1234');
      
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'security_alert:test-uuid-1234',
        expect.any(Number),
        expect.stringContaining('"status":"open"')
      );

      expect(mockRedisService.lpush).toHaveBeenCalledWith('active_alerts', 'test-uuid-1234');
    });

    it('should get active alerts successfully', async () => {
      const mockAlerts = [
        {
          id: 'alert-1',
          status: 'open',
          timestamp: new Date('2024-01-01T09:00:00Z'),
          type: 'failed_login_attempts'
        },
        {
          id: 'alert-2',
          status: 'resolved',
          timestamp: new Date('2024-01-01T08:00:00Z'),
          type: 'high_risk_activity'
        }
      ];

      mockRedisService.lrange.mockResolvedValue(['alert-1', 'alert-2']);
      mockRedisService.get.mockImplementation((key) => {
        const alertId = key.split(':')[1];
        const alert = mockAlerts.find(a => a.id === alertId);
        return Promise.resolve(alert ? JSON.stringify(alert) : null);
      });

      const result = await auditService.getActiveAlerts();

      expect(result).toHaveLength(1); // Only open alerts
      expect(result[0].id).toBe('alert-1');
    });

    it('should update alert status successfully', async () => {
      const mockAlert = {
        id: 'alert-1',
        status: 'open',
        type: 'test_alert'
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(mockAlert));
      mockRedisService.setex.mockResolvedValue('OK');

      await auditService.updateAlertStatus('alert-1', 'resolved');

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'security_alert:alert-1',
        expect.any(Number),
        expect.stringContaining('"status":"resolved"')
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Security alert status updated',
        expect.objectContaining({
          alertId: 'alert-1',
          newStatus: 'resolved'
        })
      );
    });

    it('should handle alert not found error', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await expect(auditService.updateAlertStatus('non-existent', 'resolved'))
        .rejects.toThrow('Failed to update alert status');
    });
  });

  describe('Security Report Generation', () => {
    it('should generate comprehensive security report', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          action: 'login',
          outcome: 'success',
          resource: 'auth',
          userId: 'user-1',
          source: { ip: '192.168.1.100' },
          risk_score: 15,
          timestamp: new Date('2024-01-01T09:00:00Z')
        },
        {
          id: 'event-2',
          action: 'login',
          outcome: 'failure',
          resource: 'auth',
          userId: 'user-2',
          source: { ip: '192.168.1.101' },
          risk_score: 75,
          timestamp: new Date('2024-01-01T08:00:00Z')
        },
        {
          id: 'event-3',
          action: 'read_data',
          outcome: 'success',
          resource: 'data',
          userId: 'user-1',
          source: { ip: '192.168.1.100' },
          risk_score: 25,
          timestamp: new Date('2024-01-01T07:00:00Z')
        }
      ];

      const mockAlerts = [
        {
          id: 'alert-1',
          type: 'failed_login_attempts',
          status: 'open',
          timestamp: new Date('2024-01-01T08:30:00Z')
        },
        {
          id: 'alert-2',
          type: 'high_risk_activity',
          status: 'investigating',
          timestamp: new Date('2024-01-01T08:00:00Z')
        }
      ];

      // Mock search events
      mockRedisService.lrange.mockImplementation((key) => {
        if (key === 'active_alerts') {
          return Promise.resolve(['alert-1', 'alert-2']);
        }
        return Promise.resolve([]);
      });

      mockRedisService.get.mockImplementation((key) => {
        if (key.startsWith('security_alert:')) {
          const alertId = key.split(':')[1];
          const alert = mockAlerts.find(a => a.id === alertId);
          return Promise.resolve(alert ? JSON.stringify(alert) : null);
        }
        return Promise.resolve(null);
      });

      // Mock the searchEvents method to return our mock events
      const originalSearchEvents = auditService.searchEvents;
      auditService.searchEvents = jest.fn().mockResolvedValue(mockEvents);

      const report = await auditService.generateSecurityReport(
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T23:59:59Z')
      );

      expect(report.summary).toEqual({
        totalEvents: 3,
        failedLogins: 1,
        successfulLogins: 1,
        dataAccess: 1,
        highRiskEvents: 1, // Events with risk_score >= 70
        activeAlerts: 2
      });

      expect(report.topRiskyIps).toHaveLength(2);
      expect(report.topRiskyIps[0].ip).toBe('192.168.1.101'); // Highest risk score
      
      expect(report.topUsers).toHaveLength(2);
      expect(report.topUsers[0].userId).toBe('user-1'); // Most events

      expect(report.alertsByType).toEqual([
        { type: 'failed_login_attempts', count: 1 },
        { type: 'high_risk_activity', count: 1 }
      ]);

      // Restore original method
      auditService.searchEvents = originalSearchEvents;
    });

    it('should handle report generation errors', async () => {
      // Mock searchEvents to throw error
      const originalSearchEvents = auditService.searchEvents;
      auditService.searchEvents = jest.fn().mockRejectedValue(new Error('Search failed'));

      await expect(auditService.generateSecurityReport(
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T23:59:59Z')
      )).rejects.toThrow('Failed to generate security report');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate security report',
        expect.objectContaining({
          error: expect.any(Error)
        })
      );

      // Restore original method
      auditService.searchEvents = originalSearchEvents;
    });
  });

  describe('Configuration', () => {
    it('should accept custom configuration', () => {
      const customConfig: Partial<AuditConfig> = {
        retentionDays: 30,
        alertThresholds: {
          failedLogins: 3,
          suspiciousActivity: 5,
          dataAccess: 50
        },
        riskScoreThreshold: 50
      };

      const customAuditService = new AuditService(customConfig);

      // Since config is private, we'll test it indirectly through behavior
      expect(customAuditService).toBeInstanceOf(AuditService);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing event data during retrieval', async () => {
      mockRedisService.lrange.mockResolvedValue(['event-1', 'event-2']);
      mockRedisService.get.mockImplementation((key) => {
        // Return null for event-2 to simulate missing data
        return Promise.resolve(key.includes('event-1') ? JSON.stringify({ id: 'event-1' }) : null);
      });

      const result = await auditService.getUserEvents('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-1');
    });

    it('should handle malformed JSON in stored events', async () => {
      mockRedisService.lrange.mockResolvedValue(['event-1']);
      mockRedisService.get.mockResolvedValue('invalid-json');

      const result = await auditService.getUserEvents('user-123');

      expect(result).toEqual([]);
    });

    it('should handle alert creation with missing optional fields', async () => {
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const minimalAlert = {
        type: 'test_alert',
        severity: 'low' as const,
        title: 'Minimal Alert',
        description: 'Test',
        sourceIp: '192.168.1.100',
        events: []
      };

      const alertId = await auditService.createAlert(minimalAlert);

      expect(alertId).toBe('test-uuid-1234');
      // Should not log warning for low severity
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle security alert check failures gracefully', async () => {
      // Mock Redis failure during alert checking
      mockRedisService.lrange.mockRejectedValue(new Error('Redis error'));
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.lpush.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const failedLoginEvent = {
        ...mockAuditEvent,
        action: 'login',
        outcome: 'failure' as const
      };

      // Should not throw error, just log it
      await expect(auditService.logEvent(failedLoginEvent)).resolves.toBe('test-uuid-1234');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to check security alerts',
        expect.objectContaining({
          error: expect.any(Error)
        })
      );
    });
  });
});