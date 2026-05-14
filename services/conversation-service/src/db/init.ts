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

      -- Post-call lead module tables (admissions-focused, but kept generic
      -- enough to work for any campaign vertical). Lives in conversation_db
      -- so the analyzer can write to them in the same transaction as it
      -- updates conversations.analysis.
      --
      -- post_call_lead_analysis: audit row written every time the post-call
      -- processor runs on a conversation. Lets us see what was extracted,
      -- with what confidence, on which run (re-analyze produces a new row,
      -- so we can compare extractions over time).
      CREATE TABLE IF NOT EXISTS post_call_lead_analysis (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        conversation_id UUID NOT NULL,
        call_id UUID,
        campaign_id UUID,
        lead_id UUID,                    -- nullable until CRM lead actually created
        lead_status VARCHAR(40),         -- HOT_INTERESTED / INTERESTED / etc
        interest_level VARCHAR(20),      -- hot / warm / cold / not_interested
        confidence_score NUMERIC(3,2),   -- 0.00–1.00
        analysis_json JSONB NOT NULL,
        missing_fields TEXT[],
        review_reasons TEXT[],
        processor_version VARCHAR(20) DEFAULT 'v1',
        processed_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pca_tenant ON post_call_lead_analysis (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pca_conv ON post_call_lead_analysis (conversation_id);
      CREATE INDEX IF NOT EXISTS idx_pca_status ON post_call_lead_analysis (lead_status, created_at DESC);

      -- follow_up_tasks: explicit task records the sales team works from.
      -- Replaces the implicit-CRM-appointment pattern that didn't have
      -- priority, task_type, or proper assignment fields.
      CREATE TABLE IF NOT EXISTS follow_up_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID,                    -- nullable when task created before lead row exists
        conversation_id UUID,
        assigned_to UUID,                -- counselor id
        task_type VARCHAR(40) NOT NULL DEFAULT 'call',
                                         -- 'call' | 'whatsapp' | 'email' | 'counselor_meeting' | 'campus_visit'
        scheduled_at TIMESTAMPTZ NOT NULL,
        priority VARCHAR(10) NOT NULL DEFAULT 'normal',  -- 'urgent' | 'high' | 'normal' | 'low'
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                                         -- 'pending' | 'in_progress' | 'done' | 'cancelled' | 'overdue'
        notes TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_followup_tenant ON follow_up_tasks (tenant_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_followup_assigned ON follow_up_tasks (assigned_to, status);
      CREATE INDEX IF NOT EXISTS idx_followup_lead ON follow_up_tasks (lead_id);
      CREATE INDEX IF NOT EXISTS idx_followup_pending ON follow_up_tasks (status, scheduled_at) WHERE status = 'pending';

      -- communication_logs: every email / WhatsApp / SMS we attempt to send
      -- on a lead's behalf. Tracks provider response + delivery status. The
      -- WhatsApp provider is generic for now (stub) so this table is the
      -- contract every concrete provider must write to.
      CREATE TABLE IF NOT EXISTS communication_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID,
        conversation_id UUID,
        channel VARCHAR(20) NOT NULL,    -- 'email' | 'whatsapp' | 'sms'
        provider VARCHAR(40),            -- 'smtp' | 'sendgrid' | 'twilio_whatsapp' | 'meta_cloud' | 'stub'
        recipient VARCHAR(255) NOT NULL,
        subject TEXT,
        message TEXT,
        template_id VARCHAR(64),
        attachments JSONB,               -- [{name, url}] for brochure attachments
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
                                         -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
        provider_response JSONB,
        last_error TEXT,
        sent_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_comm_tenant ON communication_logs (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comm_lead ON communication_logs (lead_id);
      CREATE INDEX IF NOT EXISTS idx_comm_channel_status ON communication_logs (channel, status);

      -- counselors: lookup for assignment rules. Simple v1 — round-robin
      -- across rows where availability_status='available'. Future: weighted
      -- by language match / college match / current task count.
      CREATE TABLE IF NOT EXISTS counselors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(120) NOT NULL,
        mobile VARCHAR(20),
        email VARCHAR(255),
        languages TEXT[],                -- ['te-IN','en-IN']
        assigned_colleges TEXT[],
        assigned_courses TEXT[],
        availability_status VARCHAR(20) DEFAULT 'available',
                                         -- 'available' | 'busy' | 'offline'
        active_task_count INTEGER DEFAULT 0,
        last_assigned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_counselor_tenant ON counselors (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_counselor_avail ON counselors (tenant_id, availability_status) WHERE availability_status = 'available';

      -- college_brochures: cached brochure catalogue. Populated by the
      -- brochure-search helper (Tavily) or admin-uploaded. Only verified
      -- entries are auto-sent; unverified ones flag a review task.
      CREATE TABLE IF NOT EXISTS college_brochures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        college_name VARCHAR(255) NOT NULL,
        course VARCHAR(120),             -- 'BTech', 'BBA', etc
        branch VARCHAR(120),             -- 'CSE', 'AI&DS', null for "any branch"
        brochure_url TEXT,               -- official public URL
        file_url TEXT,                   -- our local cached copy (if we mirrored it)
        source VARCHAR(40),              -- 'admin_upload' | 'tavily_search' | 'manual_entry'
        source_url TEXT,                 -- where we found the link
        verified_status VARCHAR(20) DEFAULT 'unverified',
                                         -- 'verified' | 'unverified' | 'rejected'
        verified_by UUID,
        verified_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_brochure_college ON college_brochures (tenant_id, college_name);
      CREATE INDEX IF NOT EXISTS idx_brochure_verified ON college_brochures (verified_status);
    `);
    logger.info('Conversation service database tables initialized');
  } finally {
    client.release();
  }
}
