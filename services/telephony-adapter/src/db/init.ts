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

      -- Calling-hours window. Outbound runner skips dial ticks outside the window.
      -- NULL window = no restriction (24x7). timezone is IANA, default Asia/Kolkata.
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata';
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS call_window_start VARCHAR(5);
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS call_window_end VARCHAR(5);

      -- OmniDim-style campaign-level runtime injection. campaign_instruction is
      -- a short free-form note that gets appended to every dial's system prompt
      -- (e.g. "This is for MBA admission follow-up — ask about fee or counselling")
      -- without permanently changing the agent. deployed_agent_config_id is the
      -- frozen snapshot we bind to at campaign-creation time so mid-campaign
      -- agent edits don't leak into running dials.
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_instruction TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deployed_agent_config_id UUID;

      -- Multi-channel campaigns. 'PHONE' (default) keeps every existing voice
      -- campaign exactly as it was; 'SMS' / 'WHATSAPP' campaigns reuse the
      -- same CSV upload + DND filter + retry queue + analytics but dispatch
      -- through conversation-service's /communications/* endpoints instead
      -- of dialing. message_body is the templated text ({{name}} / {{var}}
      -- placeholders interpolated from campaign_targets.variables JSONB at
      -- dispatch time); template_id pins a tenant-approved WA/DLT template.
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'PHONE';
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS message_body TEXT;
      ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_id VARCHAR(64);
      -- agent_id was NOT NULL when only voice campaigns existed. SMS/WhatsApp
      -- campaigns don't need an agent, so relax the constraint. DROP NOT NULL
      -- is a no-op if it's already nullable, so this is safe to re-run.
      ALTER TABLE campaigns ALTER COLUMN agent_id DROP NOT NULL;

      -- Tenant-scoped do-not-call list. Outbound runner skips any target whose
      -- phone_number matches an entry for the tenant.
      CREATE TABLE IF NOT EXISTS do_not_call_numbers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        reason TEXT,
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (tenant_id, phone_number)
      );
      CREATE INDEX IF NOT EXISTS idx_dnc_tenant ON do_not_call_numbers(tenant_id);

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

      CREATE TABLE IF NOT EXISTS kyc_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        provider VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        business_name VARCHAR(200) NOT NULL,
        owner_name VARCHAR(200) NOT NULL,
        owner_email VARCHAR(200),
        owner_phone VARCHAR(20),
        pan VARCHAR(20),
        aadhaar_last4 VARCHAR(4),
        gstin VARCHAR(20),
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        postal_code VARCHAR(20) NOT NULL,
        country VARCHAR(2) NOT NULL DEFAULT 'IN',
        use_case TEXT NOT NULL,
        provider_end_user_id VARCHAR(255),
        rejection_reason TEXT,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (tenant_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_kyc_tenant ON kyc_submissions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_submissions(status);

      CREATE TABLE IF NOT EXISTS kyc_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        provider VARCHAR(20) NOT NULL DEFAULT 'plivo',
        number VARCHAR(20) NOT NULL,
        capabilities JSONB DEFAULT '["voice"]'::jsonb,
        monthly_rate NUMERIC,
        current_step VARCHAR(20) NOT NULL DEFAULT 'register',
        full_name VARCHAR(200),
        email VARCHAR(200),
        mobile VARCHAR(20),
        email_otp_hash VARCHAR(128),
        email_otp_expires TIMESTAMPTZ,
        email_verified BOOLEAN DEFAULT FALSE,
        mobile_otp_hash VARCHAR(128),
        mobile_otp_expires TIMESTAMPTZ,
        mobile_verified BOOLEAN DEFAULT FALSE,
        otp_attempts INTEGER NOT NULL DEFAULT 0,
        pan VARCHAR(10),
        pan_holder_name VARCHAR(200),
        pan_verified BOOLEAN DEFAULT FALSE,
        aadhaar_last4 VARCHAR(4),
        aadhaar_otp_hash VARCHAR(128),
        aadhaar_otp_expires TIMESTAMPTZ,
        aadhaar_verified BOOLEAN DEFAULT FALSE,
        gstin VARCHAR(20),
        gstin_verified BOOLEAN DEFAULT FALSE,
        gstin_skipped BOOLEAN DEFAULT FALSE,
        provider_end_user_id VARCHAR(255),
        purchased_phone_id UUID,
        status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_kyc_sessions_tenant ON kyc_sessions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_kyc_sessions_number ON kyc_sessions(number);

      -- Sandbox/synthetic flag added in a follow-up — guard with IF NOT EXISTS
      -- so existing rows from earlier runs don't break the migration.
      ALTER TABLE kyc_sessions ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;

      -- Plaintext OTP slots used by the voice-call OTP path: when we place an
      -- outbound call, the answer-URL webhook reads the OTP from here and
      -- renders Plivo XML <Speak> to TTS the digits to the caller. Cleared
      -- after the webhook serves them. Hashed copy in *_otp_hash is the
      -- authoritative verification record.
      ALTER TABLE kyc_sessions ADD COLUMN IF NOT EXISTS mobile_otp_plain VARCHAR(8);
      ALTER TABLE kyc_sessions ADD COLUMN IF NOT EXISTS aadhaar_otp_plain VARCHAR(8);
      ALTER TABLE kyc_sessions ADD COLUMN IF NOT EXISTS mobile_call_uuid VARCHAR(64);
      ALTER TABLE kyc_sessions ADD COLUMN IF NOT EXISTS aadhaar_call_uuid VARCHAR(64);

      -- =====================================================================
      -- Phone-number lifecycle (verify → assign → deploy → route → audit)
      -- =====================================================================
      -- Deployment status on phone_numbers itself: draft → testing → deployed
      -- → paused. is_active is the legacy flag (kept for backward compat with
      -- the inbound webhook lookup); deployment_status is the richer state.
      ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS deployment_status VARCHAR(20) NOT NULL DEFAULT 'draft';
      ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
      ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ;
      ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS deployed_config_id UUID;

      -- Each verify run aggregates 5 sub-tests. We persist every test row so
      -- the UI can show a granular history; aggregate status = worst child.
      CREATE TABLE IF NOT EXISTS number_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        number_id UUID NOT NULL,
        tenant_id UUID NOT NULL,
        run_id UUID NOT NULL,
        test_type VARCHAR(40) NOT NULL,
        status VARCHAR(20) NOT NULL,
        log JSONB DEFAULT '{}',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_nv_number ON number_verifications(number_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_nv_run ON number_verifications(run_id);

      -- Frozen snapshot of the agent at deploy time. Live calls read from the
      -- snapshot (when present) so in-progress edits to the agent never leak
      -- into a running deployment. Re-deploy creates a new active row and
      -- flips the prior one to is_active=false (audit trail kept).
      CREATE TABLE IF NOT EXISTS deployed_agent_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        number_id UUID NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        snapshot JSONB NOT NULL,
        deployed_by UUID,
        deployed_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        retired_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_dac_number_active ON deployed_agent_configs(number_id) WHERE is_active = TRUE;
      CREATE INDEX IF NOT EXISTS idx_dac_agent ON deployed_agent_configs(agent_id);

      -- Routing config per number: business hours, failover agent, IVR menu,
      -- geo restrictions. Stored as a single JSONB blob so adding fields
      -- doesn't require a migration. One active row per number_id.
      CREATE TABLE IF NOT EXISTS call_routes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        number_id UUID NOT NULL UNIQUE,
        route_config JSONB NOT NULL DEFAULT '{}',
        updated_by UUID,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Append-only lifecycle log. One row per: assign, unassign, deploy,
      -- pause, resume, verify-passed, verify-failed, route-changed, release.
      CREATE TABLE IF NOT EXISTS number_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        number_id UUID NOT NULL,
        event_type VARCHAR(40) NOT NULL,
        actor_user_id UUID,
        actor_email VARCHAR(255),
        before_state JSONB,
        after_state JSONB,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nal_number ON number_audit_log(number_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_nal_tenant ON number_audit_log(tenant_id, created_at DESC);
    `);
    logger.info('Telephony adapter database tables initialized');
  } finally {
    client.release();
  }
}
