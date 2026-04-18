import http from 'http';
import { app } from './app';
import { config } from './config';
import { setupWebSocketServer } from './ws/realtime';
import pino from 'pino';

const logger = pino({
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

const server = http.createServer(app);

// Attach WebSocket server for real-time events
setupWebSocketServer(server);

server.listen(config.port, () => {
  logger.info(`Conversation Service started on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
