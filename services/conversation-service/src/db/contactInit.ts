import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export async function initContactTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference_id VARCHAR(20) UNIQUE NOT NULL,
        tenant_id UUID,                      -- the SaaS tenant that OWNS this landing page (NULL for the root tenant)
        full_name VARCHAR(160) NOT NULL,
        email VARCHAR(200) NOT NULL,
        phone VARCHAR(40),
        company_name VARCHAR(200),
        website VARCHAR(400),
        inquiry_type VARCHAR(40) NOT NULL,
        company_size VARCHAR(40),
        preferred_contact_method VARCHAR(20),
        message TEXT NOT NULL,
        consent_given BOOLEAN DEFAULT false,
        status VARCHAR(30) NOT NULL DEFAULT 'NEW',
        priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        assigned_to UUID,
        ai_summary TEXT,
        lead_score INTEGER,
        ai_payload JSONB,
        source_url TEXT,
        ip_address INET,
        user_agent TEXT,
        crm_lead_id UUID,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        first_response_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_contact_ref ON contact_requests(reference_id);
      CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_requests(status);
      CREATE INDEX IF NOT EXISTS idx_contact_inquiry ON contact_requests(inquiry_type);
      CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_requests(created_at DESC);

      CREATE SEQUENCE IF NOT EXISTS contact_ref_seq START 1;

      CREATE TABLE IF NOT EXISTS contact_request_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_request_id UUID NOT NULL REFERENCES contact_requests(id) ON DELETE CASCADE,
        event_type VARCHAR(40) NOT NULL,
        description TEXT,
        author_id UUID,
        visibility VARCHAR(20) NOT NULL DEFAULT 'internal',
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_contact_event_req ON contact_request_events(contact_request_id, created_at);
    `);
    logger.info('Contact requests tables initialized');
  } finally {
    client.release();
  }
}
