import { app } from './app';
import { config } from './config';
import { initDatabase } from './db/init';
import { startConsumer, stopConsumer } from './consumers/workflow.consumer';
import pino from 'pino';

const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

async function main() {
  logger.info('Initializing Notification Service...');

  // 1. Initialize database tables
  try {
    await initDatabase();
    logger.info('Database initialized');
  } catch (err) {
    logger.error(err, 'Failed to initialize database');
    process.exit(1);
  }

  // 2. Start RabbitMQ consumer (non-blocking)
  startConsumer().catch((err) => {
    logger.warn({ err: err.message }, 'Failed to start RabbitMQ consumer - notifications from workflows will be unavailable');
  });

  // 3. Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`Notification Service started on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    await stopConsumer();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal(err, 'Fatal error');
  process.exit(1);
});
