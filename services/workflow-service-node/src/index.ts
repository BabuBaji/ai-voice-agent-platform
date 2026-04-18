import pino from 'pino';
import { config } from './config';
import { initDatabase } from './db/init';
import { startEventConsumer, stopEventConsumer } from './consumers/event-consumer';
import app from './app';

const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

async function main() {
  logger.info('Initializing Workflow Service...');

  // 1. Initialize database tables
  try {
    await initDatabase();
    logger.info('Database initialized');
  } catch (err) {
    logger.error(err, 'Failed to initialize database');
    process.exit(1);
  }

  // 2. Start RabbitMQ consumer (non-blocking — service works without MQ)
  try {
    await startEventConsumer();
    logger.info('RabbitMQ event consumer started');
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'Failed to start RabbitMQ consumer — event-driven workflows will be unavailable');
  }

  // 3. Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`Workflow Service listening on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    await stopEventConsumer();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal(err, 'Fatal error');
  process.exit(1);
});
