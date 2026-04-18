import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export function setupWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/media-stream' });

  wss.on('connection', (ws: WebSocket, req) => {
    const callId = new URL(req.url || '', 'http://localhost').searchParams.get('callId');
    logger.info({ callId }, 'Media stream WebSocket connected');

    ws.on('message', (data: Buffer) => {
      // TODO: Process incoming audio data
      // - Forward to STT service for transcription
      // - Buffer for recording if enabled
      logger.debug({ callId, size: data.length }, 'Received media data');
    });

    ws.on('close', (code, reason) => {
      logger.info({ callId, code, reason: reason.toString() }, 'Media stream WebSocket closed');
    });

    ws.on('error', (err) => {
      logger.error({ callId, err: err.message }, 'Media stream WebSocket error');
    });

    // Send initial connection acknowledgment
    ws.send(JSON.stringify({ event: 'connected', callId }));
  });

  logger.info('WebSocket media stream server attached');
  return wss;
}
