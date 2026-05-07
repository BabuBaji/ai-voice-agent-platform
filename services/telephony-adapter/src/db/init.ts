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
    `);
    logger.info('Telephony adapter database tables initialized');
  } finally {
    client.release();
  }
}
