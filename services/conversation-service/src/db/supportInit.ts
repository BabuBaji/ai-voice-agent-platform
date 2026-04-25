import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initSupportTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS issue_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id VARCHAR(20) UNIQUE NOT NULL,
        tenant_id UUID,
        user_id UUID,
        name VARCHAR(160) NOT NULL,
        email VARCHAR(200) NOT NULL,
        phone VARCHAR(40),
        company_name VARCHAR(200),
        user_role VARCHAR(80),
        report_type VARCHAR(40) NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        product_area VARCHAR(40),
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        expected_behavior TEXT,
        actual_behavior TEXT,
        steps_to_reproduce TEXT,
        affected_agent_id UUID,
        affected_call_id UUID,
        affected_campaign_id UUID,
        browser VARCHAR(120),
        device VARCHAR(120),
        os VARCHAR(120),
        status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
        assigned_to UUID,
        consent_contact BOOLEAN DEFAULT false,
        consent_privacy BOOLEAN DEFAULT false,
        source VARCHAR(20) NOT NULL DEFAULT 'authed',
        rate_limit_ip INET,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        first_response_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        sla_due_at TIMESTAMPTZ,
        csat_rating INTEGER,
        csat_comment TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_issue_ticket ON issue_reports(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_issue_user ON issue_reports(user_id);
      CREATE INDEX IF NOT EXISTS idx_issue_tenant ON issue_reports(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_issue_status ON issue_reports(status);
      CREATE INDEX IF NOT EXISTS idx_issue_type ON issue_reports(report_type);
      CREATE INDEX IF NOT EXISTS idx_issue_priority ON issue_reports(priority);
      CREATE INDEX IF NOT EXISTS idx_issue_created ON issue_reports(created_at DESC);

      -- Ticket sequence: produces 1,2,3,... → formatted to ISS-000001 in the
      -- application layer so the running number doesn't clash across tenants
      -- but still reads nicely for users.
      CREATE SEQUENCE IF NOT EXISTS issue_ticket_seq START 1;

      CREATE TABLE IF NOT EXISTS issue_report_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
        kind VARCHAR(30) NOT NULL,
        filename VARCHAR(400),
        file_path TEXT,
        public_url TEXT,
        mime_type VARCHAR(100),
        size_bytes BIGINT,
        uploaded_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_issue_attach_report ON issue_report_attachments(report_id);

      CREATE TABLE IF NOT EXISTS issue_report_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
        author_id UUID,
        author_type VARCHAR(20) NOT NULL DEFAULT 'user',
        body TEXT NOT NULL,
        visibility VARCHAR(20) NOT NULL DEFAULT 'public',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_issue_comment_report ON issue_report_comments(report_id, created_at);

      CREATE TABLE IF NOT EXISTS issue_report_internal_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
        author_id UUID,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_issue_note_report ON issue_report_internal_notes(report_id, created_at);

      CREATE TABLE IF NOT EXISTS issue_report_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
        from_status VARCHAR(30),
        to_status VARCHAR(30) NOT NULL,
        changed_by UUID,
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_issue_history_report ON issue_report_status_history(report_id, created_at);

      CREATE TABLE IF NOT EXISTS issue_report_ai_analysis (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id UUID NOT NULL UNIQUE REFERENCES issue_reports(id) ON DELETE CASCADE,
        summary TEXT,
        detected_type VARCHAR(40),
        suggested_priority VARCHAR(20),
        product_area VARCHAR(40),
        sentiment VARCHAR(20),
        possible_duplicate BOOLEAN DEFAULT false,
        duplicate_ticket_ids JSONB DEFAULT '[]',
        suggested_assignee_team VARCHAR(80),
        recommended_next_action TEXT,
        draft_user_reply TEXT,
        raw_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS issue_report_duplicates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
        duplicate_of_report_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
        confidence NUMERIC(3,2),
        linked_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(report_id, duplicate_of_report_id)
      );

      CREATE TABLE IF NOT EXISTS roadmap_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
        source_report_id UUID REFERENCES issue_reports(id) ON DELETE SET NULL,
        upvotes INTEGER DEFAULT 0,
        target_release VARCHAR(50),
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    logger.info('Issue reports (support) tables initialized');
  } finally {
    client.release();
  }
}
