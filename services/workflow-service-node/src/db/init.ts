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

      CREATE TABLE IF NOT EXISTS workflows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_active ON workflows(tenant_id, is_active);

      CREATE TABLE IF NOT EXISTS triggers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        conditions JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_triggers_workflow ON triggers(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_triggers_type ON triggers(type);

      CREATE TABLE IF NOT EXISTS actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        config JSONB DEFAULT '{}',
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_actions_workflow ON actions(workflow_id);

      CREATE TABLE IF NOT EXISTS workflow_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id),
        tenant_id UUID NOT NULL,
        triggered_by VARCHAR(255),
        status VARCHAR(20) DEFAULT 'PENDING',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        result JSONB DEFAULT '{}',
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_executions_workflow ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_executions_tenant ON workflow_executions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_executions_status ON workflow_executions(status);
    `);

    await client.query('COMMIT');
    logger.info('Workflow database tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err, 'Failed to initialize workflow database');
    throw err;
  } finally {
    client.release();
  }
}
