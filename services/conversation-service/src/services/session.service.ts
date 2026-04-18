import { config } from '../config';

/**
 * Session management service backed by Redis.
 *
 * Manages active conversation sessions with TTL-based expiry.
 * Stub implementation - uses in-memory Map for development.
 */

interface Session {
  sessionId: string;
  conversationId: string;
  agentId: string;
  tenantId: string;
  contactId: string;
  channel: 'voice' | 'chat' | 'sms' | 'whatsapp';
  state: Record<string, unknown>;
  createdAt: string;
  lastActivityAt: string;
}

// In-memory store for development; replace with Redis in production
const sessions = new Map<string, Session>();

export class SessionService {
  async create(data: Omit<Session, 'createdAt' | 'lastActivityAt'>): Promise<Session> {
    const session: Session = {
      ...data,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    sessions.set(data.sessionId, session);

    // TODO: In production, store in Redis with TTL
    // await redis.setex(`session:${data.sessionId}`, config.sessionTtlSeconds, JSON.stringify(session));

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    // TODO: In production, fetch from Redis
    // const data = await redis.get(`session:${sessionId}`);
    return sessions.get(sessionId) || null;
  }

  async update(sessionId: string, state: Record<string, unknown>): Promise<Session | null> {
    const session = sessions.get(sessionId);
    if (!session) return null;

    session.state = { ...session.state, ...state };
    session.lastActivityAt = new Date().toISOString();
    sessions.set(sessionId, session);

    return session;
  }

  async delete(sessionId: string): Promise<boolean> {
    return sessions.delete(sessionId);
  }

  async getByConversation(conversationId: string): Promise<Session | null> {
    for (const session of sessions.values()) {
      if (session.conversationId === conversationId) {
        return session;
      }
    }
    return null;
  }
}

export const sessionService = new SessionService();
