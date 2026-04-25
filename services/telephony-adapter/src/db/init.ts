import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        conversation_id UUID,
        direction VARCHAR(10) NOT NULL DEFAULT 'INBOUND',
        status VARCHAR(20) DEFAULT 'RINGING',
        outcome VARCHAR(50),
        caller_number VARCHAR(20),
        called_number VARCHAR(20),
        provider VARCHAR(20) NOT NULL,
        provider_call_sid VARCHAR(255),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        recording_url TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      -- Must be UNIQUE for the ON CONFLICT upsert in the voice webhook to
      -- work. Added as ALTER ... IF NOT EXISTS so existing deployments
      -- upgrade cleanly without a manual migration.
      DO $upsert$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'calls_provider_call_sid_uk'
        ) THEN
          -- Clean up duplicates first (pre-existing rows may violate UNIQUE)
          DELETE FROM calls a USING calls b
           WHERE a.ctid < b.ctid AND a.provider_call_sid = b.provider_call_sid AND a.provider_call_sid IS NOT NULL;
          ALTER TABLE calls ADD CONSTRAINT calls_provider_call_sid_uk UNIQUE (provider_call_sid);
        END IF;
      END
      $upsert$;

      CREATE TABLE IF NOT EXISTS phone_numbers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID,
        phone_number VARCHAR(20) NOT NULL,
        provider VARCHAR(20) NOT NULL,
        provider_sid VARCHAR(255),
        capabilities JSONB DEFAULT '{"voice": true, "sms": false}',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        from_number VARCHAR(20) NOT NULL,
        provider VARCHAR(20) NOT NULL DEFAULT 'plivo',
        concurrency INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        retry_delay_seconds INTEGER NOT NULL DEFAULT 900,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        schedule_start_at TIMESTAMPTZ,
        last_run_at TIMESTAMPTZ,
        total_targets INTEGER NOT NULL DEFAULT 0,
        completed_targets INTEGER NOT NULL DEFAULT 0,
        failed_targets INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

      CREATE TABLE IF NOT EXISTS campaign_targets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        phone_number VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        variables JSONB DEFAULT '{}',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        next_attempt_after TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        outcome VARCHAR(50),
        provider_call_sid VARCHAR(255),
        conversation_id UUID,
        last_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_targets_campaign ON campaign_targets(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_targets_status ON campaign_targets(campaign_id, status);
    `);
    logger.info('Telephony adapter database tables initialized');
  } finally {
    client.release();
  }
}
