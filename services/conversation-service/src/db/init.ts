import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        channel VARCHAR(20) NOT NULL DEFAULT 'PHONE',
        status VARCHAR(20) DEFAULT 'ACTIVE',
        caller_number VARCHAR(20),
        called_number VARCHAR(20),
        lead_id UUID,
        call_sid VARCHAR(255),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        recording_url TEXT,
        summary TEXT,
        sentiment VARCHAR(20),
        outcome VARCHAR(50),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_conv_tenant ON conversations(tenant_id);

      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS language VARCHAR(10);
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS analysis JSONB;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS interest_level INTEGER;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS topics JSONB;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_ups JSONB;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS key_points JSONB;

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        audio_url TEXT,
        tool_calls JSONB,
        tool_result JSONB,
        tokens_used INTEGER,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);

      -- CRM lead retry queue. When the analyzer tries to POST a lead to
      -- crm-service and the call fails (network, 5xx, rate limit), we
      -- enqueue the payload here and a background sweeper retries with
      -- exponential backoff. Without this, calls that ended while CRM was
      -- down lost their leads forever — now they survive a CRM outage.
      --
      -- status:
      --   PENDING  → waiting for next attempt (or first attempt)
      --   SUCCESS  → posted; row kept for audit, eventually GC'd
      --   FAILED   → exceeded max_attempts; needs human attention
      CREATE TABLE IF NOT EXISTS crm_lead_retry_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        conversation_id UUID,
        payload JSONB NOT NULL,
        kind VARCHAR(20) NOT NULL DEFAULT 'lead',  -- 'lead' or 'appointment'
        related_lead_id UUID,                      -- for appointment kind
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 8,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error TEXT,
        last_status_code INTEGER,
        crm_response_lead_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        succeeded_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_crm_retry_status_next
        ON crm_lead_retry_queue (status, next_attempt_at)
        WHERE status = 'PENDING';
      CREATE INDEX IF NOT EXISTS idx_crm_retry_conv
        ON crm_lead_retry_queue (conversation_id);
    `);
    logger.info('Conversation service database tables initialized');
  } finally {
    client.release();
  }
}
