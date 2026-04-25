import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'DRAFT',
        direction VARCHAR(10) DEFAULT 'INBOUND',
        system_prompt TEXT NOT NULL,
        llm_provider VARCHAR(50) DEFAULT 'openai',
        llm_model VARCHAR(100) DEFAULT 'gpt-4o',
        temperature DECIMAL(3,2) DEFAULT 0.7,
        max_tokens INTEGER DEFAULT 4096,
        tools_config JSONB DEFAULT '[]',
        knowledge_base_ids UUID[] DEFAULT '{}',
        greeting_message TEXT,
        welcome_dynamic BOOLEAN DEFAULT TRUE,
        welcome_interruptible BOOLEAN DEFAULT FALSE,
        voice_config JSONB DEFAULT '{}',
        stt_config JSONB DEFAULT '{}',
        post_call_config JSONB DEFAULT '{}',
        integrations_config JSONB DEFAULT '{}',
        call_config JSONB DEFAULT '{}',
        cost_per_min DECIMAL(6,3) DEFAULT 0.115,
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE agents ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'INBOUND';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS welcome_dynamic BOOLEAN DEFAULT TRUE;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS welcome_interruptible BOOLEAN DEFAULT FALSE;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS stt_config JSONB DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS post_call_config JSONB DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS integrations_config JSONB DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS call_config JSONB DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS cost_per_min DECIMAL(6,3) DEFAULT 0.115;

      CREATE TABLE IF NOT EXISTS prompt_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        variables JSONB DEFAULT '[]',
        version INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS phone_number_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID REFERENCES agents(id),
        phone_number VARCHAR(20) NOT NULL,
        provider VARCHAR(20) NOT NULL,
        provider_sid VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cloned_voices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        gender VARCHAR(20),
        language VARCHAR(20),
        description TEXT,
        provider VARCHAR(30) NOT NULL DEFAULT 'elevenlabs',
        provider_voice_id VARCHAR(255),
        sample_audio BYTEA,
        sample_mime VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'ready',
        error_message TEXT,
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_cloned_voices_tenant ON cloned_voices(tenant_id);
    `);
    logger.info('Agent service database tables initialized');
  } finally {
    client.release();
  }
}
