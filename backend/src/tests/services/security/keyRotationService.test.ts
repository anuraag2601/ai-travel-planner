import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { KeyRotationService, ApiKey, KeyRotationConfig } from '../../../services/security/keyRotationService.js';
import crypto from 'crypto';

// Mock dependencies
const mockRedisService = {
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([])
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
  v4: jest.fn(() => 'mock-key-id-123')
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => Buffer.from('mock-random-bytes-32-characters-long')),
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mock-hash-value')
  }))
}));

describe('KeyRotationService', () => {
  let keyRotationService: KeyRotationService;
  let mockConfig: Partial<KeyRotationConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      rotationIntervalDays: 15,
      keyExpiryDays: 45,
      maxActiveKeys: 3,
      gracePeriodDays: 5
    };
    keyRotationService = new KeyRotationService(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('should generate a new API key successfully', async () => {
      const result = await keyRotationService.generateApiKey(
        'test-key',
        'user123',
        ['read', 'write'],
        30
      );

      expect(result.id).toBe('mock-key-id-123');
      expect(result.key).toBe('tp_bW9jay1yYW5kb20tYnl0ZXMtMzItY2hhcmFjdGVycy1sb25n');
      expect(result.name).toBe('test-key');
      expect(result.userId).toBe('user123');
      expect(result.permissions).toEqual(['read', 'write']);
      expect(result.isActive).toBe(true);
      expect(result.metadata).toEqual({
        version: '1.0',
        source: 'key-rotation-service'
      });

      // Check Redis storage calls
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'api_key:mock-key-id-123',
        expect.any(Number),
        expect.stringContaining('"key":"mock-hash-value"')
      );
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'api_key_hash:mock-hash-value',
        expect.any(Number),
        'mock-key-id-123'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'API key generated for test-key',
        expect.objectContaining({
          keyId: 'mock-key-id-123',
          userId: 'user123',
          permissions: ['read', 'write']
        })
      );
    });

    it('should use default expiry days when not specified', async () => {
      const result = await keyRotationService.generateApiKey('test-key');

      expect(result.expiresAt).toBeDefined();
      // Should use config.keyExpiryDays (45 days)
      const expectedExpiry = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
      const actualExpiry = new Date(result.expiresAt!);
      const timeDiff = Math.abs(actualExpiry.getTime() - expectedExpiry.getTime());
      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });

    it('should use default permissions when not specified', async () => {
      const result = await keyRotationService.generateApiKey('test-key');

      expect(result.permissions).toEqual(['read']);
    });

    it('should handle key generation errors', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis error'));

      await expect(keyRotationService.generateApiKey('test-key'))
        .rejects.toThrow('Failed to generate API key');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate API key',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('should enforce max active keys limit', async () => {
      const getUserKeysSpy = jest.spyOn(keyRotationService, 'getUserKeys');
      const deactivateKeySpy = jest.spyOn(keyRotationService, 'deactivateKey');

      // Mock 4 existing active keys (exceeding max of 3)
      const mockActiveKeys = Array.from({ length: 4 }, (_, i) => ({
        id: `key${i}`,
        isActive: true,
        createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000) // Different ages
      }));

      getUserKeysSpy.mockResolvedValue(mockActiveKeys as ApiKey[]);
      deactivateKeySpy.mockResolvedValue();

      await keyRotationService.generateApiKey('test-key', 'user123');

      // Should deactivate the oldest key (key3)
      expect(deactivateKeySpy).toHaveBeenCalledWith('key3');

      getUserKeysSpy.mockRestore();
      deactivateKeySpy.mockRestore();
    });
  });

  describe('validateApiKey', () => {
    const mockStoredKey = {
      id: 'key123',
      key: 'mock-hash-value',
      name: 'test-key',
      isActive: true,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
      permissions: ['read']
    };

    it('should validate active, non-expired API key', async () => {
      mockRedisService.get
        .mockResolvedValueOnce('key123') // Hash lookup
        .mockResolvedValueOnce(JSON.stringify(mockStoredKey)); // Key data

      const result = await keyRotationService.validateApiKey('tp_test-key');

      expect(result).toBeDefined();
      expect(result!.id).toBe('key123');
      expect(result!.key).toBe('tp_test-key'); // Should return original key, not hash
      expect(result!.lastUsedAt).toBeDefined();

      // Should update lastUsedAt timestamp
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'api_key:key123',
        expect.any(Number),
        expect.stringContaining('"lastUsedAt"')
      );
    });

    it('should return null for non-existent key hash', async () => {
      mockRedisService.get.mockResolvedValueOnce(null);

      const result = await keyRotationService.validateApiKey('invalid-key');

      expect(result).toBeNull();
    });

    it('should return null for missing key data', async () => {
      mockRedisService.get
        .mockResolvedValueOnce('key123')
        .mockResolvedValueOnce(null);

      const result = await keyRotationService.validateApiKey('tp_test-key');

      expect(result).toBeNull();
    });

    it('should return null for inactive key', async () => {
      const inactiveKey = { ...mockStoredKey, isActive: false };
      mockRedisService.get
        .mockResolvedValueOnce('key123')
        .mockResolvedValueOnce(JSON.stringify(inactiveKey));

      const result = await keyRotationService.validateApiKey('tp_test-key');

      expect(result).toBeNull();
    });

    it('should deactivate and return null for expired key', async () => {
      const expiredKey = {
        ...mockStoredKey,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
      };
      mockRedisService.get
        .mockResolvedValueOnce('key123')
        .mockResolvedValueOnce(JSON.stringify(expiredKey));

      const deactivateKeySpy = jest.spyOn(keyRotationService, 'deactivateKey');
      deactivateKeySpy.mockResolvedValue();

      const result = await keyRotationService.validateApiKey('tp_test-key');

      expect(result).toBeNull();
      expect(deactivateKeySpy).toHaveBeenCalledWith('key123');

      deactivateKeySpy.mockRestore();
    });

    it('should handle validation errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await keyRotationService.validateApiKey('tp_test-key');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to validate API key',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('rotateUserKeys', () => {
    it('should rotate keys that need rotation', async () => {
      const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      const mockUserKeys = [
        {
          id: 'old-key',
          name: 'old-key',
          isActive: true,
          createdAt: oldDate,
          permissions: ['read', 'write']
        },
        {
          id: 'recent-key',
          name: 'recent-key',
          isActive: true,
          createdAt: recentDate,
          permissions: ['read']
        }
      ];

      const getUserKeysSpy = jest.spyOn(keyRotationService, 'getUserKeys');
      const generateApiKeySpy = jest.spyOn(keyRotationService, 'generateApiKey');
      const deactivateKeySpy = jest.spyOn(keyRotationService, 'deactivateKey');

      getUserKeysSpy.mockResolvedValue(mockUserKeys as ApiKey[]);
      generateApiKeySpy.mockResolvedValue({
        id: 'new-key',
        name: 'old-key (rotated)',
        permissions: ['read', 'write']
      } as ApiKey);
      deactivateKeySpy.mockResolvedValue();

      // Mock setTimeout to execute immediately for testing
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((callback: any) => callback()) as any;

      const result = await keyRotationService.rotateUserKeys('user123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new-key');
      expect(generateApiKeySpy).toHaveBeenCalledWith(
        'old-key (rotated)',
        'user123',
        ['read', 'write'],
        45 // keyExpiryDays from config
      );

      // Restore setTimeout
      global.setTimeout = originalSetTimeout;

      getUserKeysSpy.mockRestore();
      generateApiKeySpy.mockRestore();
      deactivateKeySpy.mockRestore();
    });

    it('should handle rotation errors', async () => {
      const getUserKeysSpy = jest.spyOn(keyRotationService, 'getUserKeys');
      getUserKeysSpy.mockRejectedValue(new Error('Failed to get keys'));

      await expect(keyRotationService.rotateUserKeys('user123'))
        .rejects.toThrow('Failed to rotate API keys');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to rotate user keys',
        expect.objectContaining({ error: expect.any(Error), userId: 'user123' })
      );

      getUserKeysSpy.mockRestore();
    });
  });

  describe('rotateAllKeys', () => {
    it('should rotate all keys that need rotation', async () => {
      const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      const mockKeyPaths = ['api_key:key1', 'api_key:key2'];
      const mockKeys = [
        {
          id: 'key1',
          userId: 'user1',
          isActive: true,
          createdAt: oldDate.toISOString()
        },
        {
          id: 'key2',
          userId: 'user2',
          isActive: true,
          createdAt: new Date().toISOString() // Recent key, shouldn't rotate
        }
      ];

      mockRedisService.keys.mockResolvedValue(mockKeyPaths);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockKeys[0]))
        .mockResolvedValueOnce(JSON.stringify(mockKeys[1]));

      const rotateUserKeysSpy = jest.spyOn(keyRotationService, 'rotateUserKeys');
      rotateUserKeysSpy.mockResolvedValue([]);

      await keyRotationService.rotateAllKeys();

      expect(rotateUserKeysSpy).toHaveBeenCalledTimes(1);
      expect(rotateUserKeysSpy).toHaveBeenCalledWith('user1');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduled key rotation completed',
        { rotatedCount: 1 }
      );

      rotateUserKeysSpy.mockRestore();
    });

    it('should handle rotation errors gracefully', async () => {
      mockRedisService.keys.mockRejectedValue(new Error('Redis error'));

      await keyRotationService.rotateAllKeys();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to rotate all keys',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('deactivateKey', () => {
    it('should deactivate a key successfully', async () => {
      const mockKeyData = {
        id: 'key123',
        key: 'hashed-key-value',
        userId: 'user123',
        isActive: true
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(mockKeyData));
      const removeFromUserKeysSpy = jest.spyOn(keyRotationService as any, 'removeFromUserKeys');
      removeFromUserKeysSpy.mockResolvedValue();

      await keyRotationService.deactivateKey('key123');

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'api_key:key123',
        300, // 5 minutes
        expect.stringContaining('"isActive":false')
      );
      expect(mockRedisService.del).toHaveBeenCalledWith('api_key_hash:hashed-key-value');
      expect(removeFromUserKeysSpy).toHaveBeenCalledWith('user123', 'key123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'API key deactivated',
        { keyId: 'key123', userId: 'user123' }
      );

      removeFromUserKeysSpy.mockRestore();
    });

    it('should handle missing key gracefully', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await keyRotationService.deactivateKey('nonexistent');

      expect(mockRedisService.setex).not.toHaveBeenCalled();
      expect(mockRedisService.del).not.toHaveBeenCalled();
    });

    it('should handle deactivation errors', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));

      await keyRotationService.deactivateKey('key123');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to deactivate API key',
        expect.objectContaining({ error: expect.any(Error), keyId: 'key123' })
      );
    });
  });

  describe('getUserKeys', () => {
    it('should return user keys successfully', async () => {
      const mockKeyIds = ['key1', 'key2'];
      const mockKeys = [
        { id: 'key1', name: 'key1', isActive: true },
        { id: 'key2', name: 'key2', isActive: false }
      ];

      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockKeyIds))
        .mockResolvedValueOnce(JSON.stringify(mockKeys[0]))
        .mockResolvedValueOnce(JSON.stringify(mockKeys[1]));

      const result = await keyRotationService.getUserKeys('user123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('key1');
      expect(result[1].id).toBe('key2');
    });

    it('should return empty array when user has no keys', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await keyRotationService.getUserKeys('user123');

      expect(result).toEqual([]);
    });

    it('should handle missing key data gracefully', async () => {
      const mockKeyIds = ['key1', 'key2'];
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(mockKeyIds))
        .mockResolvedValueOnce(JSON.stringify({ id: 'key1' }))
        .mockResolvedValueOnce(null); // Missing key2

      const result = await keyRotationService.getUserKeys('user123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('key1');
    });

    it('should handle errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await keyRotationService.getUserKeys('user123');

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get user keys',
        expect.objectContaining({ error: expect.any(Error), userId: 'user123' })
      );
    });
  });

  describe('getKeyStats', () => {
    it('should return key statistics', async () => {
      const mockStats = {
        requestCount: 100,
        lastUsed: '2023-01-01T10:00:00Z',
        errorCount: 5
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(mockStats));

      const result = await keyRotationService.getKeyStats('key123');

      expect(result).toEqual(mockStats);
      expect(mockRedisService.get).toHaveBeenCalledWith('key_stats:key123');
    });

    it('should return default stats when none exist', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await keyRotationService.getKeyStats('key123');

      expect(result).toEqual({
        requestCount: 0,
        lastUsed: null,
        errorCount: 0
      });
    });

    it('should handle stats retrieval errors', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await keyRotationService.getKeyStats('key123');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get key stats',
        expect.objectContaining({ error: expect.any(Error), keyId: 'key123' })
      );
    });
  });

  describe('updateKeyStats', () => {
    it('should update stats for successful request', async () => {
      const existingStats = {
        requestCount: 10,
        lastUsed: '2023-01-01T10:00:00Z',
        errorCount: 2
      };

      const getKeyStatsSpy = jest.spyOn(keyRotationService, 'getKeyStats');
      getKeyStatsSpy.mockResolvedValue(existingStats);

      await keyRotationService.updateKeyStats('key123', true);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'key_stats:key123',
        86400 * 30, // 30 days
        expect.stringContaining('"requestCount":11')
      );
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'key_stats:key123',
        86400 * 30,
        expect.stringContaining('"errorCount":2') // Should not increment
      );

      getKeyStatsSpy.mockRestore();
    });

    it('should update stats for failed request', async () => {
      const existingStats = {
        requestCount: 10,
        lastUsed: '2023-01-01T10:00:00Z',
        errorCount: 2
      };

      const getKeyStatsSpy = jest.spyOn(keyRotationService, 'getKeyStats');
      getKeyStatsSpy.mockResolvedValue(existingStats);

      await keyRotationService.updateKeyStats('key123', false);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'key_stats:key123',
        86400 * 30,
        expect.stringContaining('"errorCount":3') // Should increment
      );

      getKeyStatsSpy.mockRestore();
    });

    it('should handle stats update errors', async () => {
      const getKeyStatsSpy = jest.spyOn(keyRotationService, 'getKeyStats');
      getKeyStatsSpy.mockRejectedValue(new Error('Stats error'));

      await keyRotationService.updateKeyStats('key123');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to update key stats',
        expect.objectContaining({ error: expect.any(Error), keyId: 'key123' })
      );

      getKeyStatsSpy.mockRestore();
    });
  });

  describe('cleanupExpiredKeys', () => {
    it('should clean up expired keys', async () => {
      const expiredKey = {
        id: 'expired-key',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
      };
      const validKey = {
        id: 'valid-key',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Tomorrow
      };

      mockRedisService.keys.mockResolvedValue(['api_key:expired-key', 'api_key:valid-key']);
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify(expiredKey))
        .mockResolvedValueOnce(JSON.stringify(validKey));

      const deactivateKeySpy = jest.spyOn(keyRotationService, 'deactivateKey');
      deactivateKeySpy.mockResolvedValue();

      await keyRotationService.cleanupExpiredKeys();

      expect(deactivateKeySpy).toHaveBeenCalledTimes(1);
      expect(deactivateKeySpy).toHaveBeenCalledWith('expired-key');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up expired keys',
        { cleanedCount: 1 }
      );

      deactivateKeySpy.mockRestore();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockRedisService.keys.mockRejectedValue(new Error('Redis error'));

      await keyRotationService.cleanupExpiredKeys();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to cleanup expired keys',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('private methods', () => {
    describe('createSecureKey', () => {
      it('should create a secure key with proper format', () => {
        const secureKey = (keyRotationService as any).createSecureKey();
        
        expect(secureKey).toMatch(/^tp_/); // Should have prefix
        expect(secureKey.length).toBeGreaterThan(10); // Should be reasonably long
      });
    });

    describe('hashKey', () => {
      it('should hash keys consistently', () => {
        const key = 'test-key';
        const hash1 = (keyRotationService as any).hashKey(key);
        const hash2 = (keyRotationService as any).hashKey(key);
        
        expect(hash1).toBe(hash2);
        expect(hash1).toBe('mock-hash-value'); // From mocked crypto
      });
    });

    describe('shouldRotateKey', () => {
      it('should return true for old keys', () => {
        const oldKey = {
          createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
        };
        
        const shouldRotate = (keyRotationService as any).shouldRotateKey(oldKey);
        expect(shouldRotate).toBe(true);
      });

      it('should return false for recent keys', () => {
        const recentKey = {
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
        };
        
        const shouldRotate = (keyRotationService as any).shouldRotateKey(recentKey);
        expect(shouldRotate).toBe(false);
      });

      it('should return false for keys without createdAt', () => {
        const keyWithoutDate = {};
        
        const shouldRotate = (keyRotationService as any).shouldRotateKey(keyWithoutDate);
        expect(shouldRotate).toBe(false);
      });
    });
  });

  describe('configuration', () => {
    it('should use default configuration when none provided', () => {
      const defaultService = new KeyRotationService();
      expect(defaultService).toBeInstanceOf(KeyRotationService);
    });

    it('should merge custom configuration with defaults', () => {
      const customConfig = {
        rotationIntervalDays: 60,
        maxActiveKeys: 10
      };

      const customService = new KeyRotationService(customConfig);
      expect(customService).toBeInstanceOf(KeyRotationService);
    });
  });
});