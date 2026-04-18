import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
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
