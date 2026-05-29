import type { Pool } from 'pg';

/**
 * lead_brochure_deliveries — a dedicated, queryable record of every brochure
 * send attempt (email / WhatsApp / SMS). It sits ALONGSIDE communication_logs
 * (which stays the channel-level transport log) and references it via
 * communication_log_id. This table is the source of truth for the brochure
 * "Sent / Not-Sent / Pending" queues, retry scheduling, and delivery-driven
 * follow-ups — without changing the leads schema (lead-level brochure status
 * continues to live in leads.custom_fields).
 *
 * `brochure_url` holds either a hosted file URL OR a plain link — the brochure
 * may be a link, and tracking is identical in both cases (brochure_id /
 * brochure_name are null for ad-hoc links).
 *
 * Additive only — CREATE TABLE IF NOT EXISTS, mirrors the existing init pattern
 * (contactInit / webCallInit / followupFeaturesInit).
 */
export async function initBrochureDeliveryTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_brochure_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      lead_id UUID,
      call_id UUID,
      campaign_id UUID,
      conversation_id UUID,

      brochure_id UUID,                  -- null when the brochure is an ad-hoc link
      brochure_name VARCHAR(255),
      brochure_url TEXT,                 -- hosted file URL OR plain link
      college_name VARCHAR(255),
      course_name VARCHAR(255),
      branch_name VARCHAR(255),

      channel VARCHAR(20) NOT NULL,      -- 'email' | 'whatsapp' | 'sms'
      recipient_email VARCHAR(255),
      recipient_mobile VARCHAR(32),

      -- See classifySendStatus(): SEND_PENDING | SENT | DELIVERED | OPENED |
      -- READ | FAILED | BOUNCED | INVALID_EMAIL | INVALID_MOBILE |
      -- PROVIDER_NOT_CONFIGURED | BROCHURE_NOT_FOUND | TEMPLATE_NOT_APPROVED |
      -- SKIPPED_NOT_INTERESTED | SKIPPED_DUPLICATE | NEEDS_REVIEW
      send_status VARCHAR(32) NOT NULL DEFAULT 'SEND_PENDING',
      delivery_status VARCHAR(20),       -- mirrors provider lifecycle: delivered/read/etc.
      failure_reason TEXT,

      provider VARCHAR(40),              -- 'smtp' | 'meta_cloud' | 'twilio' | 'plivo' | 'stub'
      provider_message_id TEXT,
      communication_log_id UUID,         -- FK-by-convention to communication_logs.id

      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,

      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_brochure_deliv_tenant_status
      ON lead_brochure_deliveries (tenant_id, send_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_brochure_deliv_lead
      ON lead_brochure_deliveries (lead_id);
    CREATE INDEX IF NOT EXISTS idx_brochure_deliv_retry_due
      ON lead_brochure_deliveries (next_retry_at)
      WHERE send_status = 'FAILED' AND next_retry_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_brochure_deliv_dedup
      ON lead_brochure_deliveries (lead_id, brochure_id, channel, created_at DESC);
  `);
}
