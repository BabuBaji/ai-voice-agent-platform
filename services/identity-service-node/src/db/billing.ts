import { Pool } from 'pg';

const CREATE_BILLING_TABLES = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id            TEXT NOT NULL,
  plan_name          TEXT NOT NULL,
  price              NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'INR',
  billing_cycle      TEXT NOT NULL DEFAULT 'monthly',
  status             TEXT NOT NULL DEFAULT 'active',
  auto_renew         BOOLEAN NOT NULL DEFAULT true,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_renewal_date  TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_due ON subscriptions(next_renewal_date) WHERE status = 'active' AND auto_renew = true;

CREATE TABLE IF NOT EXISTS wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'INR',
  low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  type            TEXT NOT NULL,
  reason          TEXT NOT NULL,
  reference_type  TEXT,
  reference_id    TEXT,
  balance_after   NUMERIC(12,2) NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_tenant_time ON wallet_transactions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_ref ON wallet_transactions(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS usage_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id       TEXT NOT NULL,
  agent_id      UUID,
  campaign_id   UUID,
  channel       TEXT NOT NULL DEFAULT 'voice',
  duration_sec  INTEGER NOT NULL DEFAULT 0,
  rate_per_min  NUMERIC(10,4) NOT NULL DEFAULT 0,
  cost          NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_breakdown JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, call_id)
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_time ON usage_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent ON usage_logs(agent_id);

CREATE TABLE IF NOT EXISTS phone_number_rentals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number              TEXT NOT NULL,
  country             TEXT NOT NULL DEFAULT 'IN',
  provider            TEXT NOT NULL DEFAULT 'plivo',
  monthly_cost        NUMERIC(12,2) NOT NULL DEFAULT 500,
  channels            INTEGER NOT NULL DEFAULT 1,
  channel_extra_cost  NUMERIC(12,2) NOT NULL DEFAULT 200,
  status              TEXT NOT NULL DEFAULT 'active',
  agent_id            UUID,
  next_renewal_date   TIMESTAMPTZ NOT NULL,
  last_charged_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_phone_rentals_tenant ON phone_number_rentals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_rentals_due ON phone_number_rentals(next_renewal_date) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_no    TEXT NOT NULL UNIQUE,
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate      NUMERIC(5,2) NOT NULL DEFAULT 18,
  total_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'INR',
  status        TEXT NOT NULL DEFAULT 'paid',
  reason        TEXT NOT NULL,
  line_items    JSONB NOT NULL DEFAULT '[]',
  period_start  TIMESTAMPTZ,
  period_end    TIMESTAMPTZ,
  pdf_url       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_time ON invoices(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'mock',
  brand         TEXT,
  last4         TEXT,
  upi_id        TEXT,
  holder_name   TEXT,
  exp_month     INTEGER,
  exp_year      INTEGER,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  provider_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON payment_methods(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_payment_method
  ON payment_methods(tenant_id) WHERE is_default = true;
`;

export async function initBillingTables(pool: Pool): Promise<void> {
  await pool.query(CREATE_BILLING_TABLES);
}
