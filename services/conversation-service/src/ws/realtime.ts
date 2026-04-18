import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

interface ConnectedClient {
  ws: WebSocket;
  tenantId: string;
  userId: string;
  subscribedConversations: Set<string>;
}

const clients = new Map<string, ConnectedClient>();

export function setupWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const tenantId = url.searchParams.get('tenantId') || 'unknown';
    const userId = url.searchParams.get('userId') || 'unknown';
    const clientId = `${tenantId}:${userId}:${Date.now()}`;

    clients.set(clientId, {
      ws,
      tenantId,
      userId,
      subscribedConversations: new Set(),
    });

    logger.info({ clientId, tenantId, userId }, 'WebSocket client connected');

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(clientId, message);
      } catch (err) {
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      logger.info({ clientId }, 'WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ clientId, err: err.message }, 'WebSocket error');
    });

    // Send connection acknowledgment
    ws.send(JSON.stringify({ event: 'connected', clientId }));
  });

  logger.info('WebSocket real-time event server attached');
  return wss;
}

function handleClientMessage(clientId: string, message: { event: string; data?: any }): void {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.event) {
    case 'subscribe':
      if (message.data?.conversationId) {
        client.subscribedConversations.add(message.data.conversationId);
        client.ws.send(JSON.stringify({
          event: 'subscribed',
          data: { conversationId: message.data.conversationId },
        }));
      }
      break;

    case 'unsubscribe':
      if (message.data?.conversationId) {
        client.subscribedConversations.delete(message.data.conversationId);
        client.ws.send(JSON.stringify({
          event: 'unsubscribed',
          data: { conversationId: message.data.conversationId },
        }));
      }
      break;

    default:
      client.ws.send(JSON.stringify({ event: 'error', message: `Unknown event: ${message.event}` }));
  }
}

/**
 * Broadcast an event to all clients subscribed to a conversation.
 */
export function broadcastToConversation(conversationId: string, event: string, data: unknown): void {
  for (const [, client] of clients) {
    if (client.subscribedConversations.has(conversationId) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ event, data }));
    }
  }
}
