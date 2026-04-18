import { Pool } from 'pg';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
});

pool.on('error', (err) => {
  logger.error(err, 'Unexpected pool error');
});

export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        type VARCHAR(20) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        body TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        sent_at TIMESTAMPTZ,
        error TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(tenant_id, type);

      CREATE TABLE IF NOT EXISTS notification_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL,
        subject VARCHAR(255),
        body TEXT NOT NULL,
        variables JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_templates_tenant ON notification_templates(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_templates_name ON notification_templates(tenant_id, name);
    `);

    await client.query('COMMIT');
    logger.info('Notification database tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err, 'Failed to initialize notification database');
    throw err;
  } finally {
    client.release();
  }
}
