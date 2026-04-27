import { Pool } from 'pg';
import { config } from './config';
import { createApp } from './app';
import { initDatabase } from './db/init';
import { startRenewalCron } from './services/billing/renewalCron';
import { startAnomalyCron } from './services/superAdmin/anomalyDetector';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });

  // Verify database connectivity
  try {
    const client = await pool.connect();
    logger.info('Connected to PostgreSQL');
    client.release();
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to PostgreSQL');
    process.exit(1);
  }

  // Create tables and seed data
  await initDatabase(pool);
  logger.info('Database initialized');

  const app = createApp(pool);

  app.listen(config.port, () => {
    logger.info(`Identity service listening on port ${config.port}`);
  });

  startRenewalCron(pool);
  startAnomalyCron(pool);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error during startup', err);
  process.exit(1);
});
