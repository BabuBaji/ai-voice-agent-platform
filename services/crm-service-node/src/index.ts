import pino from 'pino';
import { config } from './config';
import { initDatabase } from './db/init';
import app from './app';

const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

async function main() {
  logger.info('Initializing CRM service...');

  try {
    await initDatabase();
    logger.info('Database initialized');
  } catch (err) {
    logger.error(err, 'Failed to initialize database');
    process.exit(1);
  }

  app.listen(config.port, () => {
    logger.info(`CRM service listening on port ${config.port}`);
  });
}

main().catch((err) => {
  logger.fatal(err, 'Fatal error');
  process.exit(1);
});
