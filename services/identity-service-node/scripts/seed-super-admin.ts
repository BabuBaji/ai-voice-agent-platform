/**
 * Bootstrap the first super-admin user for the platform.
 *
 * Usage (from repo root):
 *   cd services/identity-service-node
 *   npx tsx --env-file=/c/Users/Smartgrow/Documents/AI_VOICE_AGENT/.env \
 *     scripts/seed-super-admin.ts <email> <password> [first_name] [last_name]
 *
 * Idempotent: re-running with the same email just sets is_platform_admin=true
 * and (re-)assigns the SUPER_ADMIN role under the platform tenant. Password
 * is reset on every run (intended — gives you an "I forgot the super-admin
 * password" recovery path).
 */
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../src/config';
import { ensurePlatformTenant, initDatabase } from '../src/db/init';

const SUPER_ADMIN_PERMISSIONS = [
  'platform:admin',
  'tenants:read',
  'tenants:write',
  'tenants:suspend',
  'tenants:impersonate',
  'billing:adjust',
  'audit:read',
  'integrations:read',
];

async function ensurePlatformSuperAdminRole(pool: Pool, platformTenantId: string): Promise<string> {
  const existing = await pool.query(
    `SELECT id FROM roles WHERE tenant_id = $1 AND name = 'SUPER_ADMIN' LIMIT 1`,
    [platformTenantId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const id = uuidv4();
  await pool.query(
    `INSERT INTO roles (id, tenant_id, name, permissions, is_system)
     VALUES ($1, $2, 'SUPER_ADMIN', $3, true)`,
    [id, platformTenantId, JSON.stringify(SUPER_ADMIN_PERMISSIONS)],
  );
  return id;
}

async function main() {
  const [email, password, firstNameRaw, lastNameRaw] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: tsx scripts/seed-super-admin.ts <email> <password> [first_name] [last_name]');
    process.exit(2);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(2);
  }

  const firstName = firstNameRaw || 'Platform';
  const lastName = lastNameRaw || 'Admin';

  const pool = new Pool({ connectionString: config.databaseUrl });

  // Make sure schema/extensions are present even on a fresh DB.
  await initDatabase(pool);

  const platformTenantId = await ensurePlatformTenant(pool);
  const roleId = await ensurePlatformSuperAdminRole(pool, platformTenantId);

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

  // Upsert by (tenant_id, email) — that's the unique constraint on users.
  const upsert = await pool.query(
    `INSERT INTO users
       (tenant_id, email, password_hash, first_name, last_name, status, email_verified, is_platform_admin)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true, true)
     ON CONFLICT (tenant_id, email)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       status = 'ACTIVE',
       email_verified = true,
       is_platform_admin = true,
       updated_at = now()
     RETURNING id, email`,
    [platformTenantId, email, passwordHash, firstName, lastName],
  );
  const userId = upsert.rows[0].id;

  // Assign SUPER_ADMIN role (idempotent — primary key catches dup).
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, roleId],
  );

  console.log('Super admin ready:');
  console.log('  email:        ', email);
  console.log('  user_id:      ', userId);
  console.log('  tenant_id:    ', platformTenantId, '(platform — synthetic)');
  console.log('  role:         ', 'SUPER_ADMIN');
  console.log('Login at /super-admin/login (or POST /auth/login).');

  await pool.end();
}

main().catch((err) => {
  console.error('seed-super-admin failed:', err);
  process.exit(1);
});
