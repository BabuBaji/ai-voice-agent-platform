import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initFollowupFeatureTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const tables = [
      `CREATE TABLE IF NOT EXISTS followup_sequences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
        name VARCHAR(100) NOT NULL DEFAULT 'Default Admissions', is_active BOOLEAN DEFAULT TRUE,
        steps JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS lead_score_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, lead_id UUID NOT NULL,
        previous_score INTEGER, new_score INTEGER, event VARCHAR(50) NOT NULL,
        source VARCHAR(50) DEFAULT 'auto', created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS team_notification_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, event VARCHAR(50) NOT NULL,
        lead_id UUID, channel VARCHAR(20) DEFAULT 'email', recipient VARCHAR(200),
        details TEXT, sent_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS holiday_calendar (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
        holiday_date DATE NOT NULL, name VARCHAR(100), created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, holiday_date))`,
    ];
    for (const sql of tables) await client.query(sql);

    // Add columns to existing counselors table if needed (table may already exist from postCallLead module)
    const counselorAlters = [
      `ALTER TABLE counselors ADD COLUMN specialization VARCHAR(100)`,
      `ALTER TABLE counselors ADD COLUMN max_visits_per_day INTEGER DEFAULT 8`,
    ];
    for (const sql of counselorAlters) {
      try { await client.query(sql); } catch { /* column already exists */ }
    }

    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_followup_sequences_tenant ON followup_sequences(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_lead_score_history_lead ON lead_score_history(lead_id)`,
    ];
    for (const sql of indexes) await client.query(sql);

    const alters = [
      `ALTER TABLE followup_tasks ADD COLUMN preferred_channel VARCHAR(20) DEFAULT 'call'`,
      `ALTER TABLE followup_tasks ADD COLUMN sequence_id UUID`,
      `ALTER TABLE followup_tasks ADD COLUMN sequence_step INTEGER DEFAULT 0`,
    ];
    for (const sql of alters) {
      try { await client.query(sql); } catch { /* column already exists */ }
    }

    logger.info('Follow-up feature tables initialized (sequences, scores, notifications, holidays, counselors)');
  } finally {
    client.release();
  }
}
