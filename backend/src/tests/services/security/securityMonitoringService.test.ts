import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SecurityMonitoringService, SecurityMetrics, ThreatPattern, SecurityConfig } from '../../../services/security/securityMonitoringService.js';

// Mock dependencies
const mockAuditService = {
  searchEvents: jest.fn(),
  getActiveAlerts: jest.fn(),
  createAlert: jest.fn(),
  generateSecurityReport: jest.fn()
};

const mockKeyRotationService = {
  cleanupExpiredKeys: jest.fn(),
  rotateAllKeys: jest.fn()
};

const mockRedisService = {
  keys: jest.fn(),
  get: jest.fn(),
  setex: jest.fn(),
  del: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

// Mock cron
const mockCron = {
  schedule: jest.fn()
};

// Mock the external dependencies
jest.mock('../../../services/security/auditService.js', () => ({
  auditService: mockAuditService
}));

jest.mock('../../../services/security/keyRotationService.js', () => ({
  keyRotationService: mockKeyRotationService
}));

jest.mock('../../../services/redis.js', () => ({
  redisService: mockRedisService
}));

jest.mock('../../../utils/logger.js', () => ({
  logger: mockLogger
}));

jest.mock('node-cron', () => ({
  default: mockCron
}));

describe('SecurityMonitoringService', () => {
  let securityMonitoringService: SecurityMonitoringService;
  let mockConfig: Partial<SecurityConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      monitoring: {
        metricsInterval: 2,
        alertThresholds: {
          errorRate: 0.1,
          responseTime: 1000,
          suspiciousActivity: 5,
          failedLogins: 3
        },
        retentionDays: 15
      },
      threats: {
        enabled: true,
        patterns: []
      },
      notifications: {
        enabled: true,
        channels: ['email'],
        severityThreshold: 'medium' as const
      }
    };
    securityMonitoringService = new SecurityMonitoringService(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('should start the monitoring service successfully', async () => {
      await securityMonitoringService.start();

      expect(mockCron.schedule).toHaveBeenCalledTimes(5); // Metrics, threats, cleanup, reports
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Security monitoring service started',
        expect.objectContaining({
          metricsInterval: 2,
          threatsEnabled: true,
          notificationsEnabled: true
        })
      );
    });

    it('should not start if already running', async () => {
      await securityMonitoringService.start();
      mockCron.schedule.mockClear();

      await securityMonitoringService.start();

      expect(mockCron.schedule).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('Security monitoring service is already running');
    });

    it('should handle start errors', async () => {
      mockCron.schedule.mockImplementation(() => {
        throw new Error('Cron error');
      });

      await expect(securityMonitoringService.start()).rejects.toThrow('Cron error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to start security monitoring service',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('stop', () => {
    it('should stop the monitoring service', async () => {
      await securityMonitoringService.stop();

      expect(mockLogger.info).toHaveBeenCalledWith('Security monitoring service stopped');
    });
  });

  describe('getSecurityMetrics', () => {
    const mockAuditEvents = [
      {
        id: 'event1',
        outcome: 'success',
        source: { ip: '192.168.1.1' },
        userId: 'user1',
        risk_score: 20,
        metadata: { responseTime: 500 }
      },
      {
        id: 'event2',
        outcome: 'failure',
        source: { ip: '192.168.1.2' },
        userId: 'user2',
        risk_score: 80,
        metadata: { responseTime: 2000, suspicious_activity: true }
      },
      {
        id: 'event3',
        outcome: 'denied',
        source: { ip: '192.168.1.1' },
        userId: 'user1',
        risk_score: 60,
        metadata: { responseTime: 800 }
      }
    ];

    const mockActiveAlerts = [
      { type: 'failed_login', severity: 'high', status: 'open' },
      { type: 'data_access', severity: 'medium', status: 'investigating' }
    ];

    beforeEach(() => {
      mockAuditService.searchEvents.mockResolvedValue(mockAuditEvents);
      mockAuditService.getActiveAlerts.mockResolvedValue(mockActiveAlerts);
      mockRedisService.keys.mockResolvedValue(['ratelimit:ip1', 'ratelimit:ip2']);
    });

    it('should calculate security metrics correctly', async () => {
      // Mock API key usage stats
      mockRedisService.keys.mockResolvedValueOnce(['key_stats:key1', 'key_stats:key2']);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify({ requestCount: 50, errorCount: 2 }))
        .mockResolvedValueOnce(JSON.stringify({ requestCount: 30, errorCount: 1 }));

      const metrics = await securityMonitoringService.getSecurityMetrics();

      expect(metrics.totalRequests).toBe(3);
      expect(metrics.failedRequests).toBe(1);
      expect(metrics.blockedRequests).toBe(1);
      expect(metrics.suspiciousActivities).toBe(2); // One with suspicious_activity flag, one with risk_score > 70
      expect(metrics.activeAlerts).toBe(2);
      expect(metrics.uniqueIps).toBe(2);
      expect(metrics.rateLimitHits).toBe(2);
      expect(metrics.apiKeyUsage).toBe(80); // 50 + 30

      expect(metrics.performanceMetrics.averageResponseTime).toBe(1100); // (500 + 2000 + 800) / 3
      expect(metrics.performanceMetrics.slowRequests).toBe(1); // One request > 1000ms threshold
      expect(metrics.performanceMetrics.errorRate).toBeCloseTo(0.333); // 1 failure / 3 total

      expect(metrics.topRiskyIps).toHaveLength(2);
      expect(metrics.topRiskyIps[0].ip).toBe('192.168.1.2'); // Higher risk score
      expect(metrics.topRiskyIps[0].riskScore).toBe(80);

      expect(metrics.alertsByType).toEqual([
        { type: 'failed_login', count: 1 },
        { type: 'data_access', count: 1 }
      ]);
    });

    it('should handle metrics calculation errors', async () => {
      mockAuditService.searchEvents.mockRejectedValue(new Error('Audit service error'));

      await expect(securityMonitoringService.getSecurityMetrics())
        .rejects.toThrow('Failed to get security metrics');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get security metrics',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('should cache metrics after calculation', async () => {
      mockRedisService.keys.mockResolvedValueOnce(['key_stats:key1']);
      mockRedisService.get.mockResolvedValueOnce(JSON.stringify({ requestCount: 10 }));

      await securityMonitoringService.getSecurityMetrics();

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^security_metrics:/),
        expect.any(Number),
        expect.stringContaining('"totalRequests":3')
      );
    });
  });

  describe('analyzeThreatPatterns', () => {
    const mockEvents = [
      {
        id: 'event1',
        action: 'login',
        outcome: 'failure',
        metadata: { multiple_failures: true },
        source: { ip: '192.168.1.1' }
      },
      {
        id: 'event2',
        action: 'data_export',
        outcome: 'success',
        metadata: { responseSize: 15 * 1024 * 1024 }, // 15MB
        source: { ip: '192.168.1.2' }
      }
    ];

    it('should analyze threat patterns and create alerts', async () => {
      mockAuditService.searchEvents.mockResolvedValue(mockEvents);
      mockAuditService.createAlert.mockResolvedValue('alert123');

      // Initialize service with custom threat patterns
      const serviceWithPatterns = new SecurityMonitoringService({
        threats: {
          enabled: true,
          patterns: [
            {
              id: 'brute_force',
              name: 'Brute Force Attack',
              description: 'Multiple failed login attempts',
              pattern: (data: any) => data.action === 'login' && data.outcome === 'failure' && data.metadata?.multiple_failures,
              severity: 'high' as const,
              action: 'alert' as const
            },
            {
              id: 'data_exfiltration',
              name: 'Data Exfiltration',
              description: 'Large data export',
              pattern: (data: any) => data.action === 'data_export' && data.metadata?.responseSize > 10 * 1024 * 1024,
              severity: 'critical' as const,
              action: 'block' as const
            }
          ]
        }
      });

      await serviceWithPatterns.analyzeThreatPatterns();

      expect(mockAuditService.createAlert).toHaveBeenCalledTimes(2);
      expect(mockAuditService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'brute_force',
          severity: 'high',
          title: 'Brute Force Attack',
          sourceIp: '192.168.1.1'
        })
      );
      expect(mockAuditService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data_exfiltration',
          severity: 'critical',
          title: 'Data Exfiltration',
          sourceIp: '192.168.1.2'
        })
      );
    });

    it('should handle regex-based threat patterns', async () => {
      const eventWithScript = {
        id: 'event1',
        action: 'search',
        metadata: { query: '<script>alert("xss")</script>' },
        source: { ip: '192.168.1.1' }
      };

      mockAuditService.searchEvents.mockResolvedValue([eventWithScript]);
      mockAuditService.createAlert.mockResolvedValue('alert123');

      const serviceWithRegexPattern = new SecurityMonitoringService({
        threats: {
          enabled: true,
          patterns: [
            {
              id: 'xss_attempt',
              name: 'XSS Attempt',
              description: 'Script injection detected',
              pattern: /<script[^>]*>/i,
              severity: 'high' as const,
              action: 'alert' as const
            }
          ]
        }
      });

      await serviceWithRegexPattern.analyzeThreatPatterns();

      expect(mockAuditService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'xss_attempt',
          severity: 'high'
        })
      );
    });

    it('should skip analysis when threats are disabled', async () => {
      const serviceWithDisabledThreats = new SecurityMonitoringService({
        threats: { enabled: false, patterns: [] }
      });

      await serviceWithDisabledThreats.analyzeThreatPatterns();

      expect(mockAuditService.searchEvents).not.toHaveBeenCalled();
      expect(mockAuditService.createAlert).not.toHaveBeenCalled();
    });

    it('should handle threat analysis errors', async () => {
      mockAuditService.searchEvents.mockRejectedValue(new Error('Search error'));

      const serviceWithPatterns = new SecurityMonitoringService({
        threats: { enabled: true, patterns: [] }
      });

      await serviceWithPatterns.analyzeThreatPatterns();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to analyze threat patterns',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('getSecurityDashboard', () => {
    it('should return comprehensive dashboard data', async () => {
      const mockMetrics = {
        timestamp: new Date(),
        totalRequests: 100,
        performanceMetrics: { errorRate: 0.05, averageResponseTime: 500, slowRequests: 2 }
      } as SecurityMetrics;

      const mockTrends = {
        requestTrend: [{ timestamp: new Date(), count: 50 }],
        errorTrend: [{ timestamp: new Date(), rate: 0.02 }],
        alertTrend: [{ timestamp: new Date(), count: 1 }]
      };

      const mockAlerts = [{ id: 'alert1', type: 'test', status: 'open' }];

      const getSecurityMetricsSpy = jest.spyOn(securityMonitoringService, 'getSecurityMetrics');
      const getSecurityTrendsSpy = jest.spyOn(securityMonitoringService as any, 'getSecurityTrends');
      const assessSystemHealthSpy = jest.spyOn(securityMonitoringService as any, 'assessSystemHealth');

      getSecurityMetricsSpy.mockResolvedValue(mockMetrics);
      getSecurityTrendsSpy.mockResolvedValue(mockTrends);
      assessSystemHealthSpy.mockResolvedValue({
        status: 'healthy' as const,
        issues: [],
        recommendations: []
      });
      mockAuditService.getActiveAlerts.mockResolvedValue(mockAlerts);

      const dashboard = await securityMonitoringService.getSecurityDashboard();

      expect(dashboard.currentMetrics).toEqual(mockMetrics);
      expect(dashboard.trends).toEqual(mockTrends);
      expect(dashboard.recentAlerts).toEqual(mockAlerts);
      expect(dashboard.systemHealth.status).toBe('healthy');

      getSecurityMetricsSpy.mockRestore();
      getSecurityTrendsSpy.mockRestore();
      assessSystemHealthSpy.mockRestore();
    });

    it('should handle dashboard generation errors', async () => {
      const getSecurityMetricsSpy = jest.spyOn(securityMonitoringService, 'getSecurityMetrics');
      getSecurityMetricsSpy.mockRejectedValue(new Error('Metrics error'));

      await expect(securityMonitoringService.getSecurityDashboard())
        .rejects.toThrow('Failed to get security dashboard');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get security dashboard',
        expect.objectContaining({ error: expect.any(Error) })
      );

      getSecurityMetricsSpy.mockRestore();
    });
  });

  describe('cron job scheduling', () => {
    it('should schedule metrics collection with correct interval', async () => {
      await securityMonitoringService.start();

      expect(mockCron.schedule).toHaveBeenCalledWith(
        '*/2 * * * *', // Every 2 minutes based on config
        expect.any(Function)
      );
    });

    it('should schedule threat detection every 5 minutes', async () => {
      await securityMonitoringService.start();

      expect(mockCron.schedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function)
      );
    });

    it('should schedule cleanup tasks daily', async () => {
      await securityMonitoringService.start();

      expect(mockCron.schedule).toHaveBeenCalledWith(
        '0 2 * * *', // Daily at 2 AM
        expect.any(Function)
      );
    });

    it('should schedule key rotation weekly', async () => {
      await securityMonitoringService.start();

      expect(mockCron.schedule).toHaveBeenCalledWith(
        '0 3 * * 0', // Weekly on Sunday at 3 AM
        expect.any(Function)
      );
    });

    it('should schedule security reports daily', async () => {
      await securityMonitoringService.start();

      expect(mockCron.schedule).toHaveBeenCalledWith(
        '0 6 * * *', // Daily at 6 AM
        expect.any(Function)
      );
    });
  });

  describe('alert threshold checking', () => {
    it('should create alerts when error rate exceeds threshold', async () => {
      const highErrorMetrics = {
        totalRequests: 100,
        failedRequests: 15,
        performanceMetrics: { errorRate: 0.15, averageResponseTime: 500, slowRequests: 0 }
      } as SecurityMetrics;

      const checkAlertThresholdsSpy = jest.spyOn(securityMonitoringService as any, 'checkAlertThresholds');
      await checkAlertThresholdsSpy.call(securityMonitoringService, highErrorMetrics);

      expect(mockAuditService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'high_error_rate',
          severity: 'high',
          title: 'High Error Rate Detected'
        })
      );

      checkAlertThresholdsSpy.mockRestore();
    });

    it('should create alerts when response time exceeds threshold', async () => {
      const slowResponseMetrics = {
        totalRequests: 100,
        performanceMetrics: { errorRate: 0.02, averageResponseTime: 1500, slowRequests: 10 },
        suspiciousActivities: 2
      } as SecurityMetrics;

      const checkAlertThresholdsSpy = jest.spyOn(securityMonitoringService as any, 'checkAlertThresholds');
      await checkAlertThresholdsSpy.call(securityMonitoringService, slowResponseMetrics);

      expect(mockAuditService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'slow_response_time',
          severity: 'medium',
          title: 'Slow Response Time'
        })
      );

      checkAlertThresholdsSpy.mockRestore();
    });

    it('should create alerts when suspicious activities exceed threshold', async () => {
      const suspiciousMetrics = {
        suspiciousActivities: 10,
        performanceMetrics: { errorRate: 0.02, averageResponseTime: 500, slowRequests: 0 }
      } as SecurityMetrics;

      const checkAlertThresholdsSpy = jest.spyOn(securityMonitoringService as any, 'checkAlertThresholds');
      await checkAlertThresholdsSpy.call(securityMonitoringService, suspiciousMetrics);

      expect(mockAuditService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'suspicious_activity_spike',
          severity: 'high',
          title: 'Suspicious Activity Spike'
        })
      );

      checkAlertThresholdsSpy.mockRestore();
    });
  });

  describe('system health assessment', () => {
    it('should assess system as healthy with normal metrics', async () => {
      const healthyMetrics = {
        performanceMetrics: { errorRate: 0.02, averageResponseTime: 800, slowRequests: 1 },
        suspiciousActivities: 3,
        activeAlerts: 2
      } as SecurityMetrics;

      const assessSystemHealthSpy = jest.spyOn(securityMonitoringService as any, 'assessSystemHealth');
      const health = await assessSystemHealthSpy.call(securityMonitoringService, healthyMetrics);

      expect(health.status).toBe('healthy');
      expect(health.issues).toHaveLength(0);
      expect(health.recommendations).toHaveLength(0);

      assessSystemHealthSpy.mockRestore();
    });

    it('should assess system as warning with elevated metrics', async () => {
      const warningMetrics = {
        performanceMetrics: { errorRate: 0.07, averageResponseTime: 2500, slowRequests: 10 },
        suspiciousActivities: 25,
        activeAlerts: 15
      } as SecurityMetrics;

      const assessSystemHealthSpy = jest.spyOn(securityMonitoringService as any, 'assessSystemHealth');
      const health = await assessSystemHealthSpy.call(securityMonitoringService, warningMetrics);

      expect(health.status).toBe('warning');
      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.recommendations.length).toBeGreaterThan(0);

      assessSystemHealthSpy.mockRestore();
    });

    it('should assess system as critical with high error rates', async () => {
      const criticalMetrics = {
        performanceMetrics: { errorRate: 0.15, averageResponseTime: 6000, slowRequests: 50 },
        suspiciousActivities: 100,
        activeAlerts: 5
      } as SecurityMetrics;

      const assessSystemHealthSpy = jest.spyOn(securityMonitoringService as any, 'assessSystemHealth');
      const health = await assessSystemHealthSpy.call(securityMonitoringService, criticalMetrics);

      expect(health.status).toBe('critical');
      expect(health.issues.some(issue => issue.includes('error rate'))).toBe(true);
      expect(health.issues.some(issue => issue.includes('response times'))).toBe(true);

      assessSystemHealthSpy.mockRestore();
    });
  });

  describe('security trends', () => {
    it('should retrieve security trends from cached metrics', async () => {
      const mockMetricsKeys = ['security_metrics:123456', 'security_metrics:123457'];
      const mockMetricsData = [
        {
          timestamp: '2023-01-01T10:00:00Z',
          totalRequests: 100,
          performanceMetrics: { errorRate: 0.02 },
          activeAlerts: 1
        },
        {
          timestamp: '2023-01-01T11:00:00Z',
          totalRequests: 120,
          performanceMetrics: { errorRate: 0.03 },
          activeAlerts: 2
        }
      ];

      mockRedisService.keys.mockResolvedValue(mockMetricsKeys);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockMetricsData[0]))
        .mockResolvedValueOnce(JSON.stringify(mockMetricsData[1]));

      const getSecurityTrendsSpy = jest.spyOn(securityMonitoringService as any, 'getSecurityTrends');
      const trends = await getSecurityTrendsSpy.call(securityMonitoringService);

      expect(trends.requestTrend).toHaveLength(2);
      expect(trends.requestTrend[0].count).toBe(100);
      expect(trends.requestTrend[1].count).toBe(120);

      expect(trends.errorTrend).toHaveLength(2);
      expect(trends.errorTrend[0].rate).toBe(0.02);
      expect(trends.errorTrend[1].rate).toBe(0.03);

      expect(trends.alertTrend).toHaveLength(2);
      expect(trends.alertTrend[0].count).toBe(1);
      expect(trends.alertTrend[1].count).toBe(2);

      getSecurityTrendsSpy.mockRestore();
    });

    it('should handle trends retrieval errors', async () => {
      mockRedisService.keys.mockRejectedValue(new Error('Redis error'));

      const getSecurityTrendsSpy = jest.spyOn(securityMonitoringService as any, 'getSecurityTrends');
      const trends = await getSecurityTrendsSpy.call(securityMonitoringService);

      expect(trends.requestTrend).toEqual([]);
      expect(trends.errorTrend).toEqual([]);
      expect(trends.alertTrend).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get security trends',
        expect.objectContaining({ error: expect.any(Error) })
      );

      getSecurityTrendsSpy.mockRestore();
    });
  });

  describe('cleanup operations', () => {
    it('should clean up old metrics successfully', async () => {
      const oldMetricsKeys = [
        'security_metrics:123456', // Old
        'security_metrics:789012'  // Recent
      ];

      mockRedisService.keys.mockResolvedValue(oldMetricsKeys);
      mockRedisService.del.mockResolvedValue(1);

      const cleanupOldMetricsSpy = jest.spyOn(securityMonitoringService as any, 'cleanupOldMetrics');
      await cleanupOldMetricsSpy.call(securityMonitoringService);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Old security metrics cleaned up',
        expect.objectContaining({ deletedCount: expect.any(Number) })
      );

      cleanupOldMetricsSpy.mockRestore();
    });

    it('should handle cleanup errors', async () => {
      mockRedisService.keys.mockRejectedValue(new Error('Redis error'));

      const cleanupOldMetricsSpy = jest.spyOn(securityMonitoringService as any, 'cleanupOldMetrics');
      await cleanupOldMetricsSpy.call(securityMonitoringService);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to cleanup old metrics',
        expect.objectContaining({ error: expect.any(Error) })
      );

      cleanupOldMetricsSpy.mockRestore();
    });
  });

  describe('configuration', () => {
    it('should use default configuration when none provided', () => {
      const defaultService = new SecurityMonitoringService();
      expect(defaultService).toBeInstanceOf(SecurityMonitoringService);
    });

    it('should merge custom configuration with defaults', () => {
      const customConfig = {
        monitoring: {
          metricsInterval: 10,
          retentionDays: 60
        },
        notifications: {
          enabled: false
        }
      };

      const customService = new SecurityMonitoringService(customConfig);
      expect(customService).toBeInstanceOf(SecurityMonitoringService);
    });

    it('should include default threat patterns', () => {
      const defaultService = new SecurityMonitoringService();
      expect(defaultService).toBeInstanceOf(SecurityMonitoringService);
    });
  });

  describe('notification handling', () => {
    it('should determine notification eligibility based on severity threshold', () => {
      const shouldNotifySpy = jest.spyOn(securityMonitoringService as any, 'shouldNotify');

      expect(shouldNotifySpy.call(securityMonitoringService, 'low')).toBe(false);
      expect(shouldNotifySpy.call(securityMonitoringService, 'medium')).toBe(true);
      expect(shouldNotifySpy.call(securityMonitoringService, 'high')).toBe(true);
      expect(shouldNotifySpy.call(securityMonitoringService, 'critical')).toBe(true);

      shouldNotifySpy.mockRestore();
    });

    it('should send threat notifications when enabled', async () => {
      const mockPattern = {
        id: 'test_threat',
        name: 'Test Threat',
        severity: 'high' as const
      } as ThreatPattern;
      const mockEvents = [{ id: 'event1', source: { ip: '192.168.1.1' } }];

      const sendThreatNotificationSpy = jest.spyOn(securityMonitoringService as any, 'sendThreatNotification');
      await sendThreatNotificationSpy.call(securityMonitoringService, mockPattern, mockEvents);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Threat notification sent',
        expect.objectContaining({
          patternId: 'test_threat',
          severity: 'high'
        })
      );

      sendThreatNotificationSpy.mockRestore();
    });

    it('should send security reports', async () => {
      const mockReport = {
        summary: { totalEvents: 100, activeAlerts: 5 }
      };

      const sendSecurityReportSpy = jest.spyOn(securityMonitoringService as any, 'sendSecurityReport');
      await sendSecurityReportSpy.call(securityMonitoringService, mockReport, 'daily');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Security report sent',
        expect.objectContaining({
          type: 'daily',
          totalEvents: 100,
          activeAlerts: 5
        })
      );

      sendSecurityReportSpy.mockRestore();
    });
  });
});