import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class RedisService {
  private client: Redis;
  private isConnected = false;

  constructor() {
    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      
      // Connection retry configuration
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      
      // Reconnect on failure
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      },
    });

    this.setupEventHandlers();
    this.connect();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connection established');
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      this.isConnected = false;
      logger.error('Redis connection error:', error);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    this.client.on('end', () => {
      this.isConnected = false;
      logger.warn('Redis connection ended');
    });
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
    }
  }

  // Basic Redis operations
  async get(key: string): Promise<string | null> {
    try {
      const result = await this.client.get(key);
      logger.debug('Redis GET operation', { key, found: result !== null });
      return result;
    } catch (error) {
      logger.error('Redis GET error:', { key, error });
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      logger.debug('Redis SET operation', { key, ttl: ttlSeconds });
      return true;
    } catch (error) {
      logger.error('Redis SET error:', { key, error });
      return false;
    }
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<boolean> {
    try {
      await this.client.setex(key, ttlSeconds, value);
      logger.debug('Redis SETEX operation', { key, ttl: ttlSeconds });
      return true;
    } catch (error) {
      logger.error('Redis SETEX error:', { key, ttl: ttlSeconds, error });
      return false;
    }
  }

  async del(key: string | string[]): Promise<number> {
    try {
      const result = await this.client.del(key);
      logger.debug('Redis DEL operation', { key, deleted: result });
      return result;
    } catch (error) {
      logger.error('Redis DEL error:', { key, error });
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS error:', { key, error });
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      const result = await this.client.ttl(key);
      return result;
    } catch (error) {
      logger.error('Redis TTL error:', { key, error });
      return -1;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, ttlSeconds);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXPIRE error:', { key, ttl: ttlSeconds, error });
      return false;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      const result = await this.client.incr(key);
      logger.debug('Redis INCR operation', { key, value: result });
      return result;
    } catch (error) {
      logger.error('Redis INCR error:', { key, error });
      return 0;
    }
  }

  async decr(key: string): Promise<number> {
    try {
      const result = await this.client.decr(key);
      logger.debug('Redis DECR operation', { key, value: result });
      return result;
    } catch (error) {
      logger.error('Redis DECR error:', { key, error });
      return 0;
    }
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    try {
      const result = await this.client.hget(key, field);
      return result;
    } catch (error) {
      logger.error('Redis HGET error:', { key, field, error });
      return null;
    }
  }

  async hset(key: string, field: string, value: string): Promise<boolean> {
    try {
      await this.client.hset(key, field, value);
      return true;
    } catch (error) {
      logger.error('Redis HSET error:', { key, field, error });
      return false;
    }
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    try {
      const result = await this.client.hmget(key, ...fields);
      return result;
    } catch (error) {
      logger.error('Redis HMGET error:', { key, fields, error });
      return [];
    }
  }

  async hmset(key: string, hash: Record<string, string>): Promise<boolean> {
    try {
      await this.client.hmset(key, hash);
      return true;
    } catch (error) {
      logger.error('Redis HMSET error:', { key, error });
      return false;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      const result = await this.client.hgetall(key);
      return result;
    } catch (error) {
      logger.error('Redis HGETALL error:', { key, error });
      return {};
    }
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    try {
      const result = await this.client.hdel(key, ...fields);
      return result;
    } catch (error) {
      logger.error('Redis HDEL error:', { key, fields, error });
      return 0;
    }
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      const result = await this.client.lpush(key, ...values);
      return result;
    } catch (error) {
      logger.error('Redis LPUSH error:', { key, error });
      return 0;
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      const result = await this.client.rpush(key, ...values);
      return result;
    } catch (error) {
      logger.error('Redis RPUSH error:', { key, error });
      return 0;
    }
  }

  async lpop(key: string): Promise<string | null> {
    try {
      const result = await this.client.lpop(key);
      return result;
    } catch (error) {
      logger.error('Redis LPOP error:', { key, error });
      return null;
    }
  }

  async rpop(key: string): Promise<string | null> {
    try {
      const result = await this.client.rpop(key);
      return result;
    } catch (error) {
      logger.error('Redis RPOP error:', { key, error });
      return null;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      const result = await this.client.lrange(key, start, stop);
      return result;
    } catch (error) {
      logger.error('Redis LRANGE error:', { key, start, stop, error });
      return [];
    }
  }

  async llen(key: string): Promise<number> {
    try {
      const result = await this.client.llen(key);
      return result;
    } catch (error) {
      logger.error('Redis LLEN error:', { key, error });
      return 0;
    }
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      const result = await this.client.sadd(key, ...members);
      return result;
    } catch (error) {
      logger.error('Redis SADD error:', { key, error });
      return 0;
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    try {
      const result = await this.client.srem(key, ...members);
      return result;
    } catch (error) {
      logger.error('Redis SREM error:', { key, error });
      return 0;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      const result = await this.client.smembers(key);
      return result;
    } catch (error) {
      logger.error('Redis SMEMBERS error:', { key, error });
      return [];
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.client.sismember(key, member);
      return result === 1;
    } catch (error) {
      logger.error('Redis SISMEMBER error:', { key, member, error });
      return false;
    }
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    try {
      const result = await this.client.publish(channel, message);
      logger.debug('Redis PUBLISH operation', { channel, subscribers: result });
      return result;
    } catch (error) {
      logger.error('Redis PUBLISH error:', { channel, error });
      return 0;
    }
  }

  // Pattern matching
  async keys(pattern: string): Promise<string[]> {
    try {
      const result = await this.client.keys(pattern);
      return result;
    } catch (error) {
      logger.error('Redis KEYS error:', { pattern, error });
      return [];
    }
  }

  // Scan for better performance than keys
  async scan(cursor: number, pattern?: string, count?: number): Promise<[string, string[]]> {
    try {
      const args: any[] = [cursor];
      if (pattern) {
        args.push('MATCH', pattern);
      }
      if (count) {
        args.push('COUNT', count);
      }
      
      const result = await this.client.scan(...args);
      return result;
    } catch (error) {
      logger.error('Redis SCAN error:', { cursor, pattern, count, error });
      return ['0', []];
    }
  }

  // Utility methods
  async flushall(): Promise<boolean> {
    try {
      await this.client.flushall();
      logger.warn('Redis FLUSHALL executed - all data cleared');
      return true;
    } catch (error) {
      logger.error('Redis FLUSHALL error:', error);
      return false;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis PING error:', error);
      return false;
    }
  }

  // Connection management
  isHealthy(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      logger.info('Redis client disconnected gracefully');
    } catch (error) {
      logger.error('Error disconnecting Redis client:', error);
      this.client.disconnect();
    }
  }

  // Cache helper methods
  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error('Redis getJSON error:', { key, error });
      return null;
    }
  }

  async setJSON<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    try {
      const jsonString = JSON.stringify(value);
      return await this.set(key, jsonString, ttlSeconds);
    } catch (error) {
      logger.error('Redis setJSON error:', { key, error });
      return false;
    }
  }

  async remember<T>(
    key: string,
    ttlSeconds: number,
    fetchFunction: () => Promise<T>
  ): Promise<T | null> {
    try {
      // Try to get from cache first
      const cached = await this.getJSON<T>(key);
      if (cached !== null) {
        logger.debug('Cache hit', { key });
        return cached;
      }

      // Cache miss - fetch data
      logger.debug('Cache miss', { key });
      const data = await fetchFunction();
      
      // Store in cache
      await this.setJSON(key, data, ttlSeconds);
      
      return data;
    } catch (error) {
      logger.error('Redis remember error:', { key, error });
      
      // Fallback to direct function call
      try {
        return await fetchFunction();
      } catch (fetchError) {
        logger.error('Fallback function error:', { key, error: fetchError });
        return null;
      }
    }
  }
}

export default RedisService;