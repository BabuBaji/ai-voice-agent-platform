import { app } from './app';
import { config } from './config';
import { startConsumer } from './consumers/workflow.consumer';
import pino from 'pino';

const logger = pino({
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

const server = app.listen(config.port, () => {
  logger.info(`Notification Service started on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});

// Start RabbitMQ consumer (non-blocking)
startConsumer().catch((err) => {
  logger.warn({ err: err.message }, 'Failed to start RabbitMQ consumer - notifications from workflows will be unavailable');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
