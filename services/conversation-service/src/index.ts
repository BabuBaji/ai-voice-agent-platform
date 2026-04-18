import http from 'http';
import { Pool } from 'pg';
import { app } from './app';
import { config } from './config';
import { initDatabase } from './db/init';
import { setupWebSocketServer } from './ws/realtime';
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

    const server = http.createServer(app);

    // Attach WebSocket server for real-time events
    setupWebSocketServer(server);

    server.listen(config.port, () => {
      logger.info(`Conversation Service started on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });

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
