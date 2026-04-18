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

      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(320),
        phone VARCHAR(50),
        company VARCHAR(255),
        source VARCHAR(100),
        status VARCHAR(50) NOT NULL DEFAULT 'NEW',
        score INT NOT NULL DEFAULT 0,
        assigned_to UUID,
        tags TEXT[] DEFAULT '{}',
        custom_fields JSONB DEFAULT '{}',
        last_contacted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(tenant_id, email);

      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(320),
        phone VARCHAR(50),
        company VARCHAR(255),
        job_title VARCHAR(255),
        custom_fields JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id);

      CREATE TABLE IF NOT EXISTS pipelines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pipelines_tenant ON pipelines(tenant_id);

      CREATE TABLE IF NOT EXISTS pipeline_stages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        position INT NOT NULL,
        color VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

      CREATE TABLE IF NOT EXISTS deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        title VARCHAR(500) NOT NULL,
        value DECIMAL(15,2) DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        expected_close_date DATE,
        assigned_to UUID,
        status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(tenant_id, pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
        deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        due_date TIMESTAMPTZ,
        priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        status VARCHAR(20) NOT NULL DEFAULT 'TODO',
        assigned_to UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);

      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        title VARCHAR(500) NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        duration_minutes INT NOT NULL DEFAULT 30,
        location TEXT,
        notes TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
        booked_by VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
        conversation_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id);

      CREATE TABLE IF NOT EXISTS notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID NOT NULL,
        content TEXT NOT NULL,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(tenant_id, entity_type, entity_id);
    `);

    await client.query('COMMIT');
    logger.info('Database tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err, 'Failed to initialize database');
    throw err;
  } finally {
    client.release();
  }
}

const DEFAULT_STAGES = [
  { name: 'New', position: 0, color: '#6B7280' },
  { name: 'Contacted', position: 1, color: '#3B82F6' },
  { name: 'Qualified', position: 2, color: '#8B5CF6' },
  { name: 'Proposal', position: 3, color: '#F59E0B' },
  { name: 'Negotiation', position: 4, color: '#EF4444' },
  { name: 'Won', position: 5, color: '#10B981' },
  { name: 'Lost', position: 6, color: '#374151' },
];

export async function ensureDefaultPipeline(tenantId: string): Promise<void> {
  const existing = await pool.query(
    'SELECT id FROM pipelines WHERE tenant_id = $1 AND is_default = true',
    [tenantId]
  );
  if (existing.rows.length > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pipelineRes = await client.query(
      'INSERT INTO pipelines (tenant_id, name, is_default) VALUES ($1, $2, true) RETURNING id',
      [tenantId, 'Sales Pipeline']
    );
    const pipelineId = pipelineRes.rows[0].id;

    for (const stage of DEFAULT_STAGES) {
      await client.query(
        'INSERT INTO pipeline_stages (pipeline_id, name, position, color) VALUES ($1, $2, $3, $4)',
        [pipelineId, stage.name, stage.position, stage.color]
      );
    }

    await client.query('COMMIT');
    logger.info({ tenantId }, 'Created default pipeline');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
