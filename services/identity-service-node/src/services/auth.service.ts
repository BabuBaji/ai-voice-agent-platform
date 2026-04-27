import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { createTenantRoles } from '../db/init';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from './jwt.service';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface UserDTO {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
  isPlatformAdmin: boolean;
}

function toUserDTO(row: any, roles: string[]): UserDTO {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    emailVerified: row.email_verified,
    roles,
    isPlatformAdmin: !!row.is_platform_admin,
  };
}

export async function register(
  pool: Pool,
  data: {
    tenantName: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
): Promise<{ tokens: AuthTokens; user: UserDTO }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create tenant
    const tenantId = uuidv4();
    const slug = slugify(data.tenantName) || 'tenant-' + tenantId.slice(0, 8);
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`,
      [tenantId, data.tenantName, slug],
    );

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, config.bcryptRounds);

    // Create user
    const userId = uuidv4();
    const userResult = await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING *`,
      [userId, tenantId, data.email, passwordHash, data.firstName, data.lastName],
    );

    // Create default roles for tenant (uses a separate pool query, but we need
    // to do it inside the transaction using the client).
    const roleMap = new Map<string, string>();
    const systemRoles = [
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
        permissions: ['agents:read', 'conversations:read', 'conversations:write'],
      },
      {
        name: 'VIEWER',
        permissions: ['agents:read', 'conversations:read', 'analytics:read'],
      },
    ];

    for (const role of systemRoles) {
      const roleId = uuidv4();
      await client.query(
        `INSERT INTO roles (id, tenant_id, name, permissions, is_system)
         VALUES ($1, $2, $3, $4, true)`,
        [roleId, tenantId, role.name, JSON.stringify(role.permissions)],
      );
      roleMap.set(role.name, roleId);
    }

    // Assign OWNER role
    const ownerRoleId = roleMap.get('OWNER')!;
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
      [userId, ownerRoleId],
    );

    await client.query('COMMIT');

    // Generate tokens (refresh token uses pool, outside transaction)
    const roles = ['OWNER'];
    const accessToken = generateAccessToken(userId, tenantId, data.email, roles);
    const refreshToken = await generateRefreshToken(pool, userId);

    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: config.jwt.accessExpiration,
      },
      user: toUserDTO(userResult.rows[0], roles),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function login(
  pool: Pool,
  email: string,
  password: string,
): Promise<{ tokens: AuthTokens; user: UserDTO }> {
  // Find user by email
  const userResult = await pool.query(
    `SELECT * FROM users WHERE email = $1 AND status = 'ACTIVE' LIMIT 1`,
    [email],
  );

  if (userResult.rows.length === 0) {
    const err: any = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  const user = userResult.rows[0];

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err: any = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  // Update last_login_at
  await pool.query(
    `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
    [user.id],
  );

  // Get roles
  const rolesResult = await pool.query(
    `SELECT r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [user.id],
  );
  const roles = rolesResult.rows.map((r: any) => r.name);

  // Generate tokens
  const accessToken = generateAccessToken(
    user.id,
    user.tenant_id,
    user.email,
    roles,
    !!user.is_platform_admin,
  );
  const refreshToken = await generateRefreshToken(pool, user.id);

  return {
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessExpiration,
    },
    user: toUserDTO(user, roles),
  };
}

export async function refresh(
  pool: Pool,
  rawRefreshToken: string,
): Promise<AuthTokens> {
  const hash = hashToken(rawRefreshToken);

  const result = await pool.query(
    `SELECT rt.*, u.email, u.tenant_id, u.is_platform_admin
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.revoked = false AND rt.expires_at > now()`,
    [hash],
  );

  if (result.rows.length === 0) {
    const err: any = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }

  const row = result.rows[0];

  // Revoke old refresh token
  await pool.query(
    `UPDATE refresh_tokens SET revoked = true WHERE id = $1`,
    [row.id],
  );

  // Get roles
  const rolesResult = await pool.query(
    `SELECT r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [row.user_id],
  );
  const roles = rolesResult.rows.map((r: any) => r.name);

  // Generate new tokens
  const accessToken = generateAccessToken(
    row.user_id,
    row.tenant_id,
    row.email,
    roles,
    !!row.is_platform_admin,
  );
  const newRefreshToken = await generateRefreshToken(pool, row.user_id);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: config.jwt.accessExpiration,
  };
}

export async function logout(
  pool: Pool,
  rawRefreshToken: string,
): Promise<void> {
  const hash = hashToken(rawRefreshToken);
  await pool.query(
    `UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`,
    [hash],
  );
}
