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
    `);
    logger.info('Conversation service database tables initialized');
  } finally {
    client.release();
  }
}
