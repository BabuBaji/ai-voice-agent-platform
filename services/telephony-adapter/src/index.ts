import http from 'http';
import { Pool } from 'pg';
import { app } from './app';
import { config } from './config';
import { initDatabase } from './db/init';
import { setupWebSocketServer } from './ws/mediaStream';
import { setupPlivoAudioStream } from './ws/plivoAudioStream';
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

    // Attach WebSocket servers for media streaming. We use a SINGLE
    // `upgrade` listener that routes by path — multiple `ws` servers
    // attached directly to the same http.Server fight over upgrades
    // and the non-matching one aborts the handshake with HTTP 400.
    // - /media-stream: Twilio Media Streams
    // - /plivo/audio:  Plivo AudioStream (Deepgram STT/TTS in-process)
    const mediaWss = setupWebSocketServer(server);
    const plivoWss = setupPlivoAudioStream(server);

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '', 'http://localhost');
      const pathname = url.pathname;
      if (pathname === '/media-stream') {
        mediaWss.handleUpgrade(req, socket as any, head, (ws) => mediaWss.emit('connection', ws, req));
      } else if (pathname === '/plivo/audio') {
        plivoWss.handleUpgrade(req, socket as any, head, (ws) => plivoWss.emit('connection', ws, req));
      } else {
        logger.warn({ pathname }, 'WS upgrade for unknown path — rejecting');
        socket.destroy();
      }
    });

    server.listen(config.port, () => {
      logger.info(`Telephony Adapter started on port ${config.port}`);
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
    logger.error({ err }, 'Failed to start telephony adapter');
    process.exit(1);
  }
}

start();
