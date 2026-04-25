import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { seedDocs } from './seedDocs';
import { initBillingTables } from './billing';

const CREATE_TABLES = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL DEFAULT 'free',
  settings   JSONB NOT NULL DEFAULT '{}',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL DEFAULT '',
  avatar_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  email_verified  BOOLEAN NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  is_system  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en-US';

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

CREATE TABLE IF NOT EXISTS integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  config          JSONB NOT NULL DEFAULT '{}',
  credentials     JSONB NOT NULL DEFAULT '{}',
  test_status     TEXT,
  test_message    TEXT,
  last_tested_at  TIMESTAMPTZ,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations(tenant_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,            -- first 12 chars, shown in the UI for identification
  key_hash      TEXT NOT NULL,            -- sha256 of the full key; full key only shown once at create time
  scopes        JSONB DEFAULT '["*"]',    -- currently unused, reserved for per-key permissions
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS doc_sections (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS doc_articles (
  id           SERIAL PRIMARY KEY,
  section_id   INT REFERENCES doc_sections(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  body_md      TEXT NOT NULL DEFAULT '',
  icon         TEXT,            -- lucide icon name rendered by the frontend
  color        TEXT,            -- tailwind color family key (sky/violet/emerald/...)
  link_to      TEXT,            -- optional internal path (e.g. /agents) — if set, card links there instead of the article detail
  is_new       BOOLEAN NOT NULL DEFAULT false,
  is_featured  BOOLEAN NOT NULL DEFAULT false,  -- shown in the top grid on /docs
  sort_order   INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_articles_section ON doc_articles(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_doc_articles_featured ON doc_articles(is_featured, sort_order) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_doc_articles_search ON doc_articles USING gin(to_tsvector('english', title || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body_md,'')));

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID,
  user_email    TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  method        TEXT,
  path          TEXT,
  status_code   INTEGER,
  ip            TEXT,
  user_agent    TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

CREATE TABLE IF NOT EXISTS email_verifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash     TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user
  ON email_verifications(user_id) WHERE consumed_at IS NULL;
`;

interface SystemRole {
  name: string;
  permissions: string[];
}

const SYSTEM_ROLES: SystemRole[] = [
  {
    name: 'OWNER',
    permissions: [
      'tenant:manage',
      'users:read',
      'users:write',
      'users:delete',
      'roles:read',
      'roles:write',
      'agents:read',
      'agents:write',
      'agents:delete',
      'conversations:read',
      'analytics:read',
      'billing:manage',
    ],
  },
  {
    name: 'ADMIN',
    permissions: [
      'users:read',
      'users:write',
      'roles:read',
      'roles:write',
      'agents:read',
      'agents:write',
      'agents:delete',
      'conversations:read',
      'analytics:read',
    ],
  },
  {
    name: 'AGENT',
    permissions: [
      'agents:read',
      'conversations:read',
      'conversations:write',
    ],
  },
  {
    name: 'VIEWER',
    permissions: ['agents:read', 'conversations:read', 'analytics:read'],
  },
];

export async function initDatabase(pool: Pool): Promise<void> {
  await pool.query(CREATE_TABLES);

  // Insert system roles (tenant_id = NULL means global/system roles)
  for (const role of SYSTEM_ROLES) {
    await pool.query(
      `INSERT INTO roles (name, permissions, is_system, tenant_id)
       VALUES ($1, $2, true, NULL)
       ON CONFLICT DO NOTHING`,
      [role.name, JSON.stringify(role.permissions)],
    );
  }

  await seedDocs(pool);
  await initBillingTables(pool);
}

/**
 * Create default roles for a new tenant by copying system roles.
 * Returns a map of role name -> role id.
 */
export async function createTenantRoles(
  pool: Pool,
  tenantId: string,
): Promise<Map<string, string>> {
  const roleMap = new Map<string, string>();

  for (const role of SYSTEM_ROLES) {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO roles (id, tenant_id, name, permissions, is_system)
       VALUES ($1, $2, $3, $4, true)`,
      [id, tenantId, role.name, JSON.stringify(role.permissions)],
    );
    roleMap.set(role.name, id);
  }

  return roleMap;
}
