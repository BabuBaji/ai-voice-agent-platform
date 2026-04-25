import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initWebCallTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS web_call_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        user_id UUID,
        agent_id UUID NOT NULL,
        conversation_id UUID,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        primary_language VARCHAR(10) NOT NULL DEFAULT 'en-IN',
        auto_detect_language BOOLEAN DEFAULT false,
        mixed_language_allowed BOOLEAN DEFAULT false,
        voice_provider VARCHAR(30),
        voice_name VARCHAR(80),
        voice_gender VARCHAR(10),
        voice_accent VARCHAR(30),
        voice_speed NUMERIC(3,2) DEFAULT 1.0,
        voice_tone VARCHAR(30),
        recording_enabled BOOLEAN DEFAULT true,
        transcript_enabled BOOLEAN DEFAULT true,
        recording_url TEXT,
        transcript_status VARCHAR(20) DEFAULT 'PENDING',
        analysis_status VARCHAR(20) DEFAULT 'PENDING',
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        end_reason VARCHAR(50),
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_web_call_tenant ON web_call_sessions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_web_call_agent ON web_call_sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_web_call_status ON web_call_sessions(status);

      CREATE TABLE IF NOT EXISTS web_call_transcripts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        call_id UUID NOT NULL REFERENCES web_call_sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        speaker VARCHAR(10) NOT NULL,
        text TEXT NOT NULL,
        language VARCHAR(10),
        confidence NUMERIC(4,3),
        started_at_ms INTEGER,
        ended_at_ms INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_web_call_transcript_call ON web_call_transcripts(call_id, sequence);

      CREATE TABLE IF NOT EXISTS web_call_recordings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        call_id UUID NOT NULL REFERENCES web_call_sessions(id) ON DELETE CASCADE,
        kind VARCHAR(20) NOT NULL,
        file_path TEXT,
        public_url TEXT,
        mime_type VARCHAR(60),
        size_bytes BIGINT,
        duration_seconds INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_web_call_recording_call ON web_call_recordings(call_id);

      CREATE TABLE IF NOT EXISTS web_call_analysis (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        call_id UUID NOT NULL UNIQUE REFERENCES web_call_sessions(id) ON DELETE CASCADE,
        summary TEXT,
        detailed_summary TEXT,
        customer_intent TEXT,
        sentiment VARCHAR(20),
        interest_level VARCHAR(20),
        lead_score INTEGER,
        objections JSONB DEFAULT '[]',
        extracted_fields JSONB DEFAULT '{}',
        next_best_action TEXT,
        follow_up_required BOOLEAN,
        recommended_callback_time TIMESTAMPTZ,
        agent_performance_score INTEGER,
        raw_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS web_call_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        call_id UUID NOT NULL REFERENCES web_call_sessions(id) ON DELETE CASCADE,
        event_type VARCHAR(40) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_web_call_event_call ON web_call_events(call_id, created_at);
    `);
    logger.info('Web-call tables initialized');
  } finally {
    client.release();
  }
}
