import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

let redis: Redis;

try {
  redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 5) {
        logger.warn('Redis connection failed after 5 retries, session service will be unavailable');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('connect', () => {
    logger.info('Redis connected for session management');
  });

  redis.on('error', (err) => {
    logger.error({ err: err.message }, 'Redis connection error');
  });

  // Attempt connection but don't crash if it fails
  redis.connect().catch(() => {
    logger.warn('Redis not available, session service will use fallback');
  });
} catch (err) {
  logger.warn('Failed to initialize Redis client');
  redis = null as any;
}

const SESSION_PREFIX = 'session:';
const TTL = config.sessionTtlSeconds;

export class SessionService {
  async createSession(conversationId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const session = {
      conversationId,
      ...data,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    if (redis && redis.status === 'ready') {
      await redis.setex(`${SESSION_PREFIX}${conversationId}`, TTL, JSON.stringify(session));
    } else {
      logger.warn('Redis not available, session not persisted');
    }

    return session;
  }

  async getSession(conversationId: string): Promise<Record<string, unknown> | null> {
    if (!redis || redis.status !== 'ready') {
      return null;
    }

    const data = await redis.get(`${SESSION_PREFIX}${conversationId}`);
    if (!data) return null;

    return JSON.parse(data);
  }

  async updateSession(conversationId: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!redis || redis.status !== 'ready') {
      return null;
    }

    const existing = await this.getSession(conversationId);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...data,
      lastActivityAt: new Date().toISOString(),
    };

    await redis.setex(`${SESSION_PREFIX}${conversationId}`, TTL, JSON.stringify(updated));
    return updated;
  }

  async deleteSession(conversationId: string): Promise<boolean> {
    if (!redis || redis.status !== 'ready') {
      return false;
    }

    const result = await redis.del(`${SESSION_PREFIX}${conversationId}`);
    return result > 0;
  }
}

export const sessionService = new SessionService();
