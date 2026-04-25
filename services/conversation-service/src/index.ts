import http from 'http';
import { Pool } from 'pg';
import { app } from './app';
import { config } from './config';
import { initDatabase } from './db/init';
import { initWebCallTables } from './db/webCallInit';
import { initSupportTables } from './db/supportInit';
import { initContactTables } from './db/contactInit';
import { setupWebSocketServer } from './ws/realtime';
import { startRetentionSweeper } from './services/privacy';
import { startStaleSweeper } from './services/staleSweeper';
import pino from 'pino';

const logger = pino({
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

async function start(): Promise<void> {
  try {
    // Test database connection
    const client = await pool.connect();
    logger.info('Connected to PostgreSQL');
    client.release();

    // Initialize tables
    await initDatabase(pool);
    await initWebCallTables(pool);
    await initSupportTables(pool);
    await initContactTables(pool);

    const server = http.createServer(app);

    // Attach WebSocket server for real-time events
    setupWebSocketServer(server);

    server.listen(config.port, () => {
      logger.info(`Conversation Service started on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });

    // GDPR retention sweeper — runs every 6h, deletes conversations older
    // than each tenant's data_retention_days setting.
    if (process.env.RETENTION_SWEEPER !== 'off') {
      startRetentionSweeper();
    }

    // Stale conversation sweeper — flips ACTIVE rows older than the threshold
    // (default 60 min, no recent messages) to FAILED so they stop polluting
    // the call log.
    startStaleSweeper();

    const shutdown = async () => {
      logger.info('Shutting down...');
      server.close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    logger.error({ err }, 'Failed to start conversation service');
    process.exit(1);
  }
}

start();
