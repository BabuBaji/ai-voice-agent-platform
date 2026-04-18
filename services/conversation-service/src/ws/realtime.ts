import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import { config } from '../config';
import { pool } from '../index';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

// Map of conversationId -> Set of WebSocket connections
const subscriptions = new Map<string, Set<WebSocket>>();

// Map of WebSocket -> client metadata
const clientMeta = new Map<WebSocket, { tenantId: string; subscribedConversations: Set<string> }>();

export function setupWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.send(JSON.stringify({ type: 'error', message: 'Authentication required: ?token=JWT' }));
      ws.close(4001, 'Authentication required');
      return;
    }

    let tenantId: string;
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { tenantId: string; [key: string]: any };
      tenantId = decoded.tenantId;
      if (!tenantId) {
        throw new Error('tenantId not found in token');
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
      ws.close(4001, 'Invalid token');
      return;
    }

    const meta = { tenantId, subscribedConversations: new Set<string>() };
    clientMeta.set(ws, meta);

    logger.info({ tenantId }, 'WebSocket client connected');
    ws.send(JSON.stringify({ type: 'connected', tenantId }));

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleClientMessage(ws, meta, message);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      // Clean up subscriptions
      for (const convId of meta.subscribedConversations) {
        const subs = subscriptions.get(convId);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) {
            subscriptions.delete(convId);
          }
        }
      }
      clientMeta.delete(ws);
      logger.info({ tenantId }, 'WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ tenantId, err: err.message }, 'WebSocket error');
    });
  });

  logger.info('WebSocket real-time event server attached');
  return wss;
}

async function handleClientMessage(
  ws: WebSocket,
  meta: { tenantId: string; subscribedConversations: Set<string> },
  message: { type: string; conversationId?: string; content?: string }
): Promise<void> {
  switch (message.type) {
    case 'subscribe': {
      if (!message.conversationId) {
        ws.send(JSON.stringify({ type: 'error', message: 'conversationId required' }));
        return;
      }

      // Verify conversation belongs to tenant
      const convCheck = await pool.query(
        'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
        [message.conversationId, meta.tenantId]
      );
      if (convCheck.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found or access denied' }));
        return;
      }

      meta.subscribedConversations.add(message.conversationId);
      if (!subscriptions.has(message.conversationId)) {
        subscriptions.set(message.conversationId, new Set());
      }
      subscriptions.get(message.conversationId)!.add(ws);

      ws.send(JSON.stringify({ type: 'subscribed', conversationId: message.conversationId }));
      break;
    }

    case 'unsubscribe': {
      if (!message.conversationId) {
        ws.send(JSON.stringify({ type: 'error', message: 'conversationId required' }));
        return;
      }

      meta.subscribedConversations.delete(message.conversationId);
      const subs = subscriptions.get(message.conversationId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          subscriptions.delete(message.conversationId);
        }
      }

      ws.send(JSON.stringify({ type: 'unsubscribed', conversationId: message.conversationId }));
      break;
    }

    case 'send_message': {
      if (!message.conversationId || !message.content) {
        ws.send(JSON.stringify({ type: 'error', message: 'conversationId and content required' }));
        return;
      }

      // Verify conversation belongs to tenant
      const convCheck = await pool.query(
        'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
        [message.conversationId, meta.tenantId]
      );
      if (convCheck.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found or access denied' }));
        return;
      }

      // Insert message into database
      const result = await pool.query(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, 'user', $2) RETURNING *`,
        [message.conversationId, message.content]
      );

      const newMessage = result.rows[0];

      // Broadcast to all subscribers
      broadcastToConversation(message.conversationId, 'new_message', newMessage);
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
  }
}

/**
 * Broadcast an event to all clients subscribed to a conversation.
 */
export function broadcastToConversation(conversationId: string, event: string, data: unknown): void {
  const subs = subscriptions.get(conversationId);
  if (!subs) return;

  const payload = JSON.stringify({ type: event, data });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}
