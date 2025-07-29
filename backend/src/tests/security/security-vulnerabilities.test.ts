import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Import routes for security testing
import authRouter from '../../routes/auth.js';
import searchRouter from '../../routes/search.js';
import itinerariesRouter from '../../routes/itineraries.js';

// Mock services for security testing
const mockFirebaseService = {
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  verifyIdToken: jest.fn(),
};

const mockAuditService = {
  logEvent: jest.fn()
};

jest.mock('../../services/external/firebaseService.js', () => ({
  FirebaseService: jest.fn(() => mockFirebaseService)
}));

jest.mock('../../services/security/auditService.js', () => ({
  auditService: mockAuditService
}));

jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Security Vulnerability Tests (OWASP Top 10)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    
    // Configure security middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: false, limit: '10mb' }));
    
    // Add security headers middleware
    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      next();
    });
    
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/search', searchRouter);
    app.use('/api/v1/itineraries', itinerariesRouter);

    jest.clearAllMocks();
  });

  describe('A01:2021 – Broken Access Control', () => {
    it('should prevent unauthorized access to protected endpoints', async () => {
      // Test accessing protected endpoint without authentication
      const response = await request(app)
        .get('/api/v1/itineraries')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toMatch(/AUTH_/);
    });

    it('should prevent privilege escalation attacks', async () => {
      // Mock regular user token
      mockFirebaseService.verifyIdToken.mockResolvedValue({
        uid: 'regular-user',
        email: 'user@example.com',
        admin: false
      });

      // Attempt to access admin endpoint
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ action: 'delete', userId: 'another-user' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/insufficient privileges|forbidden/i);
    });

    it('should prevent direct object reference attacks', async () => {
      // Mock authenticated user
      mockFirebaseService.verifyIdToken.mockResolvedValue({
        uid: 'user1',
        email: 'user1@example.com'
      });

      // Attempt to access another user's itinerary
      const response = await request(app)
        .get('/api/v1/itineraries/user2-itinerary-123')
        .set('Authorization', 'Bearer user1-token')
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/access denied|forbidden/i);
    });

    it('should validate user ownership of resources', async () => {
      mockFirebaseService.verifyIdToken.mockResolvedValue({
        uid: 'user1',
        email: 'user1@example.com'
      });

      // Try to modify another user's itinerary
      const response = await request(app)
        .put('/api/v1/itineraries/other-user-itinerary')
        .set('Authorization', 'Bearer user1-token')
        .send({
          title: 'Modified by attacker',
          status: 'published'
        })
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('A02:2021 – Cryptographic Failures', () => {
    it('should enforce HTTPS in production', async () => {
      // Simulate production environment
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .get('/api/v1/auth/login')
        .set('X-Forwarded-Proto', 'http') // Simulate HTTP request
        .expect(301);

      // Should redirect to HTTPS
      expect(response.headers.location).toMatch(/^https:/);
    });

    it('should handle sensitive data securely', async () => {
      mockFirebaseService.createUser.mockResolvedValue({
        uid: 'user123',
        email: 'test@example.com'
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User'
        })
        .expect(201);

      // Password should not be in response
      const responseString = JSON.stringify(response.body);
      expect(responseString).not.toContain('SecurePassword123!');
      expect(responseString).not.toContain('password');
    });

    it('should use secure session management', async () => {
      mockFirebaseService.getUserByEmail.mockResolvedValue({
        uid: 'user123',
        email: 'test@example.com',
        emailVerified: true
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!'
        })
        .expect(200);

      // Check for secure cookie attributes (if using cookies)
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader) {
        expect(setCookieHeader[0]).toMatch(/HttpOnly/);
        expect(setCookieHeader[0]).toMatch(/Secure/);
        expect(setCookieHeader[0]).toMatch(/SameSite/);
      }
    });
  });

  describe('A03:2021 – Injection', () => {
    it('should prevent SQL injection in search parameters', async () => {
      const maliciousQueries = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "'; INSERT INTO users (email, password) VALUES ('hacker@evil.com', 'password'); --",
        "1'; EXEC xp_cmdshell('dir'); --"
      ];

      for (const maliciousQuery of maliciousQueries) {
        const response = await request(app)
          .get('/api/v1/search/flights')
          .query({
            origin: maliciousQuery,
            destination: 'CDG',
            departureDate: '2024-12-25'
          });

        // Should either sanitize input or return validation error
        expect(response.status).not.toBe(500);
        if (response.status !== 200) {
          expect(response.body.error.code).toMatch(/VALIDATION_ERROR/);
        }
      }
    });

    it('should prevent NoSQL injection attempts', async () => {
      const noSQLPayloads = [
        { "$ne": null },
        { "$gt": "" },
        { "$where": "this.email == 'admin@example.com'" },
        { "$regex": ".*" }
      ];

      for (const payload of noSQLPayloads) {
        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: payload,
            password: 'anypassword'
          });

        expect(response.status).not.toBe(200);
        expect(response.body.success).toBe(false);
      }
    });

    it('should prevent command injection in file operations', async () => {
      const commandInjectionPayloads = [
        '; ls -la',
        '& dir',
        '| cat /etc/passwd',
        '$(rm -rf /)',
        '`whoami`'
      ];

      for (const payload of commandInjectionPayloads) {
        const response = await request(app)
          .post('/api/v1/itineraries/export')
          .send({
            itineraryId: 'valid-id',
            filename: `itinerary${payload}.pdf`,
            format: 'pdf'
          });

        // Should reject malicious filenames
        expect(response.status).toBe(400);
        expect(response.body.error.code).toMatch(/VALIDATION_ERROR/);
      }
    });

    it('should sanitize user input in all endpoints', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '<img src="x" onerror="alert(\'XSS\')" />',
        '<svg onload="alert(\'XSS\')" />'
      ];

      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/v1/auth/register')
          .send({
            email: 'test@example.com',
            password: 'SecurePassword123!',
            firstName: payload,
            lastName: 'User'
          });

        if (response.status === 201) {
          // If registration succeeds, check that XSS payload was sanitized
          const responseString = JSON.stringify(response.body);
          expect(responseString).not.toContain('<script>');
          expect(responseString).not.toContain('javascript:');
          expect(responseString).not.toContain('onerror');
          expect(responseString).not.toContain('onload');
        }
      }
    });
  });

  describe('A04:2021 – Insecure Design', () => {
    it('should implement rate limiting', async () => {
      const requests = Array.from({ length: 100 }, () =>
        request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'wrongpassword'
          })
      );

      const responses = await Promise.allSettled(requests);
      const rateLimitedResponses = responses.filter(
        result => result.status === 'fulfilled' && 
        (result.value.status === 429 || result.value.status === 423)
      );

      // Should rate limit after multiple failed attempts
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should implement account lockout after failed attempts', async () => {
      mockFirebaseService.getUserByEmail.mockResolvedValue(null);

      // Simulate multiple failed login attempts
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'wrongpassword'
          });
      }

      // Next attempt should be locked out
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'correctpassword'
        });

      expect(response.status).toBe(423); // Locked
      expect(response.body.error.code).toMatch(/ACCOUNT_LOCKED/);
    });

    it('should validate business logic constraints', async () => {
      // Test invalid date ranges
      const response = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          returnDate: '2024-12-20' // Return before departure
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/return date.*after.*departure/i);
    });
  });

  describe('A05:2021 – Security Misconfiguration', () => {
    it('should not expose sensitive headers', async () => {
      const response = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25'
        });

      // Should not expose server technology
      expect(response.headers['server']).toBeUndefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
      
      // Should have security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    it('should not expose debug information in production', async () => {
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .get('/api/v1/nonexistent-endpoint')
        .expect(404);

      // Should not expose stack traces or debug info
      const responseString = JSON.stringify(response.body);
      expect(responseString).not.toMatch(/stack trace/i);
      expect(responseString).not.toMatch(/line \d+/);
      expect(responseString).not.toMatch(/\.js:\d+/);
    });

    it('should handle errors securely', async () => {
      // Force an internal error
      mockFirebaseService.createUser.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User'
        })
        .expect(500);

      // Should return generic error message, not detailed error
      expect(response.body.error.message).not.toContain('Database connection failed');
      expect(response.body.error.message).toMatch(/internal server error|service unavailable/i);
    });
  });

  describe('A06:2021 – Vulnerable and Outdated Components', () => {
    it('should use secure headers to prevent downgrade attacks', async () => {
      const response = await request(app)
        .get('/api/v1/auth/login')
        .expect(200);

      expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    });

    it('should validate Content-Type to prevent MIME sniffing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Content-Type', 'text/plain') // Wrong content type
        .send('not json')
        .expect(400);

      expect(response.body.error.code).toMatch(/VALIDATION_ERROR/);
    });
  });

  describe('A07:2021 – Identification and Authentication Failures', () => {
    it('should enforce strong password requirements', async () => {
      const weakPasswords = [
        '123456',
        'password',
        'qwerty',
        '12345678',
        'abc123',
        'password123'
      ];

      for (const weakPassword of weakPasswords) {
        const response = await request(app)
          .post('/api/v1/auth/register')
          .send({
            email: 'test@example.com',
            password: weakPassword,
            firstName: 'Test',
            lastName: 'User'
          });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toMatch(/VALIDATION_ERROR/);
        expect(response.body.error.message).toMatch(/password.*requirements/i);
      }
    });

    it('should prevent brute force attacks', async () => {
      mockFirebaseService.getUserByEmail.mockResolvedValue(null);

      const bruteForceAttempts = Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'target@example.com',
            password: `attempt${i}`
          })
      );

      const responses = await Promise.all(bruteForceAttempts);
      const blockedResponses = responses.filter(r => r.status === 429 || r.status === 423);

      // Should block brute force attempts
      expect(blockedResponses.length).toBeGreaterThan(0);
    });

    it('should validate session tokens properly', async () => {
      const invalidTokens = [
        'invalid.token.here',
        'expired.jwt.token',
        '',
        null,
        undefined,
        'Bearer malicious-token'
      ];

      for (const token of invalidTokens) {
        const response = await request(app)
          .get('/api/v1/itineraries')
          .set('Authorization', token ? `Bearer ${token}` : '');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
      }
    });

    it('should implement proper session timeout', async () => {
      // Mock expired token
      mockFirebaseService.verifyIdToken.mockRejectedValue(new Error('Token expired'));

      const response = await request(app)
        .get('/api/v1/itineraries')
        .set('Authorization', 'Bearer expired-token')
        .expect(401);

      expect(response.body.error.code).toMatch(/AUTH_003|TOKEN_EXPIRED/);
    });
  });

  describe('A08:2021 – Software and Data Integrity Failures', () => {
    it('should validate file uploads securely', async () => {
      const maliciousFiles = [
        { filename: 'test.exe', contentType: 'application/x-executable' },
        { filename: 'script.js', contentType: 'application/javascript' },
        { filename: 'image.php', contentType: 'application/x-php' },
        { filename: '../../../etc/passwd', contentType: 'text/plain' }
      ];

      for (const file of maliciousFiles) {
        const response = await request(app)
          .post('/api/v1/upload/avatar')
          .attach('file', Buffer.from('malicious content'), file)
          .expect(400);

        expect(response.body.error.code).toMatch(/VALIDATION_ERROR|FILE_TYPE_ERROR/);
      }
    });

    it('should validate data integrity in critical operations', async () => {
      // Test tampered itinerary data
      const tamperedItinerary = {
        id: 'valid-id',
        totalBudget: -1000, // Negative budget
        dailyItinerary: null, // Invalid structure
        checksum: 'invalid-checksum'
      };

      const response = await request(app)
        .put('/api/v1/itineraries/valid-id')
        .send(tamperedItinerary)
        .expect(400);

      expect(response.body.error.code).toMatch(/VALIDATION_ERROR|INTEGRITY_ERROR/);
    });
  });

  describe('A09:2021 – Security Logging and Monitoring Failures', () => {
    it('should log security events', async () => {
      // Clear previous mock calls
      mockAuditService.logEvent.mockClear();

      // Trigger security event (failed login)
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        });

      // Verify security event was logged
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'login',
          outcome: 'failure',
          severity: expect.stringMatching(/medium|high/),
          source: expect.objectContaining({
            ip: expect.any(String),
            method: 'POST',
            path: '/api/v1/auth/login'
          })
        })
      );
    });

    it('should detect and log suspicious activities', async () => {
      mockAuditService.logEvent.mockClear();

      // Simulate suspicious activity (rapid requests from same IP)
      const suspiciousRequests = Array.from({ length: 50 }, () =>
        request(app)
          .get('/api/v1/search/flights')
          .query({ origin: 'JFK', destination: 'CDG', departureDate: '2024-12-25' })
      );

      await Promise.all(suspiciousRequests);

      // Should log rate limiting or suspicious activity
      const auditCalls = mockAuditService.logEvent.mock.calls;
      const suspiciousActivityLogs = auditCalls.filter(call =>
        call[0].action.includes('rate_limit') || 
        call[0].metadata?.suspicious_activity === true
      );

      expect(suspiciousActivityLogs.length).toBeGreaterThan(0);
    });

    it('should not log sensitive information', async () => {
      mockAuditService.logEvent.mockClear();

      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User'
        });

      // Check all audit log calls
      const auditCalls = mockAuditService.logEvent.mock.calls;
      auditCalls.forEach(call => {
        const logData = JSON.stringify(call[0]);
        expect(logData).not.toContain('SecurePassword123!');
        expect(logData).not.toContain('password');
      });
    });
  });

  describe('A10:2021 – Server-Side Request Forgery (SSRF)', () => {
    it('should prevent SSRF in URL parameters', async () => {
      const ssrfPayloads = [
        'http://localhost:8080/admin',
        'http://127.0.0.1:22',
        'http://169.254.169.254/latest/meta-data/',
        'file:///etc/passwd',
        'ftp://internal.server.com/secrets'
      ];

      for (const payload of ssrfPayloads) {
        const response = await request(app)
          .post('/api/v1/external/webhook')
          .send({
            callbackUrl: payload,
            eventType: 'itinerary_generated'
          });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toMatch(/VALIDATION_ERROR|SSRF_DETECTED/);
      }
    });

    it('should validate external API URLs', async () => {
      const maliciousUrls = [
        'http://evil.com/malware.exe',
        'javascript:alert("XSS")',
        'data:text/html,<script>alert("XSS")</script>',
        'http://localhost:3306/mysql'
      ];

      for (const url of maliciousUrls) {
        const response = await request(app)
          .post('/api/v1/integrations/external-api')
          .send({
            apiUrl: url,
            method: 'GET'
          });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toMatch(/VALIDATION_ERROR|INVALID_URL/);
      }
    });
  });

  describe('Additional Security Tests', () => {
    it('should prevent timing attacks', async () => {
      const startValid = Date.now();
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'valid@example.com',
          password: 'validpassword'
        });
      const endValid = Date.now();
      const validTime = endValid - startValid;

      const startInvalid = Date.now();
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'invalid@example.com',
          password: 'invalidpassword'
        });
      const endInvalid = Date.now();
      const invalidTime = endInvalid - startInvalid;

      // Response times should be similar to prevent timing attacks
      const timeDifference = Math.abs(validTime - invalidTime);
      expect(timeDifference).toBeLessThan(100); // Less than 100ms difference
    });

    it('should implement proper CORS policy', async () => {
      const response = await request(app)
        .options('/api/v1/auth/login')
        .set('Origin', 'https://evil.com')
        .expect(200);

      // Should not allow requests from unauthorized origins
      expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.com');
    });

    it('should prevent clickjacking attacks', async () => {
      const response = await request(app)
        .get('/api/v1/auth/login');

      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });
});