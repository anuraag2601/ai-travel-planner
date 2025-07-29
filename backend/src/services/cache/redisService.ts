import Redis from 'ioredis';
import { logger } from '../../utils/logger.js';

export class RedisService {
  private client: Redis;
  private isConnected: boolean = false;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connected successfully');
    });

    this.client.on('error', (error) => {
      this.isConnected = false;
      logger.error('Redis connection error:', error);
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      const result = await this.client.set(key, value);
      return result === 'OK';
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  async setex(key: string, seconds: number, value: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      const result = await this.client.setex(key, seconds, value);
      return result === 'OK';
    } catch (error) {
      logger.error(`Redis SETEX error for key ${key}:`, error);
      return false;
    }
  }

  async del(key: string): Promise<number> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      return await this.client.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  async lpush(key: string, value: string): Promise<number> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      return await this.client.lpush(key, value);
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      return await this.client.lrange(key, start, stop);
    } catch (error) {
      logger.error(`Redis LRANGE error for key ${key}:`, error);
      return [];
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      const result = await this.client.expire(key, seconds);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
      }
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      return [];
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      this.isConnected = false;
      logger.info('Redis disconnected');
    } catch (error) {
      logger.error('Redis disconnect error:', error);
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export const redisService = new RedisService();