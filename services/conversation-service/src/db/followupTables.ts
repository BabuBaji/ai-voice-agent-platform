import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initFollowupTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Follow-up tasks (core scheduler table)
      CREATE TABLE IF NOT EXISTS followup_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID NOT NULL,
        conversation_id UUID,
        agent_id UUID,
        type VARCHAR(50) NOT NULL DEFAULT 'admission_interest',
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        priority INTEGER DEFAULT 5,
        scheduled_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        attempt_count INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        last_attempt_at TIMESTAMPTZ,
        next_retry_at TIMESTAMPTZ,
        result JSONB DEFAULT '{}',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_followup_tasks_tenant_status ON followup_tasks(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_followup_tasks_scheduled ON followup_tasks(scheduled_at) WHERE status = 'PENDING';
      CREATE INDEX IF NOT EXISTS idx_followup_tasks_lead ON followup_tasks(lead_id);

      -- Visit schedules
      CREATE TABLE IF NOT EXISTS visit_schedules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID NOT NULL,
        followup_task_id UUID REFERENCES followup_tasks(id),
        visit_date DATE NOT NULL,
        visit_time TIME,
        location TEXT,
        counselor_name VARCHAR(200),
        counselor_phone VARCHAR(20),
        status VARCHAR(30) DEFAULT 'SCHEDULED',
        confirmation_call_id UUID,
        reminder_24h_sent BOOLEAN DEFAULT FALSE,
        reminder_2h_sent BOOLEAN DEFAULT FALSE,
        customer_confirmed BOOLEAN DEFAULT FALSE,
        reschedule_count INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_visit_schedules_tenant ON visit_schedules(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_visit_schedules_date ON visit_schedules(visit_date, status);

      -- Reminder logs
      CREATE TABLE IF NOT EXISTS reminder_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID NOT NULL,
        visit_schedule_id UUID REFERENCES visit_schedules(id),
        followup_task_id UUID REFERENCES followup_tasks(id),
        type VARCHAR(30) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'SENT',
        customer_response TEXT,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        responded_at TIMESTAMPTZ
      );

      -- Call attempt logs
      CREATE TABLE IF NOT EXISTS call_attempt_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID NOT NULL,
        followup_task_id UUID REFERENCES followup_tasks(id),
        call_id UUID,
        conversation_id UUID,
        attempt_number INTEGER DEFAULT 1,
        status VARCHAR(30) NOT NULL,
        duration_seconds INTEGER,
        outcome VARCHAR(50),
        transcript_summary TEXT,
        customer_response JSONB DEFAULT '{}',
        initiated_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_call_attempt_logs_task ON call_attempt_logs(followup_task_id);

      -- Feedback logs
      CREATE TABLE IF NOT EXISTS feedback_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        lead_id UUID NOT NULL,
        followup_task_id UUID REFERENCES followup_tasks(id),
        call_id UUID,
        rating VARCHAR(20),
        rating_score INTEGER,
        reason TEXT,
        feedback_text TEXT,
        requires_escalation BOOLEAN DEFAULT FALSE,
        escalation_notes TEXT,
        collected_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Post-brochure → visit → feedback automation: additive columns.
      ALTER TABLE visit_schedules ADD COLUMN IF NOT EXISTS visitor_type VARCHAR(20);
      ALTER TABLE visit_schedules ADD COLUMN IF NOT EXISTS created_from VARCHAR(40) DEFAULT 'MANUAL';
      -- Visit Card: link the originating call so the visit row carries recording + summary.
      ALTER TABLE visit_schedules ADD COLUMN IF NOT EXISTS conversation_id UUID;
      ALTER TABLE visit_schedules ADD COLUMN IF NOT EXISTS recording_url TEXT;
      ALTER TABLE visit_schedules ADD COLUMN IF NOT EXISTS call_summary TEXT;
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS visit_id UUID;
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS interest_after_visit VARCHAR(20);
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS admission_readiness VARCHAR(30);
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS objections JSONB;
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS next_action TEXT;
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS callback_required BOOLEAN DEFAULT FALSE;
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS callback_time TIMESTAMPTZ;
      ALTER TABLE feedback_logs ADD COLUMN IF NOT EXISTS visited_status VARCHAR(30);
    `);
    logger.info('Follow-up scheduler tables initialized');
  } finally {
    client.release();
  }
}
