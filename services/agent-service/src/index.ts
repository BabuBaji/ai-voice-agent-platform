import { Pool } from 'pg';
import { app } from './app';
import { config } from './config';
import { initDatabase } from './db/init';
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

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Agent Service started on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(
        { elevenlabs: process.env.ELEVENLABS_API_KEY ? `loaded (${process.env.ELEVENLABS_API_KEY.slice(0, 10)}...)` : 'MISSING' },
        'ElevenLabs key status',
      );
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
    logger.error({ err }, 'Failed to start agent service');
    process.exit(1);
  }
}

start();
