import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { config } from '../config';

export interface AccessTokenPayload {
  sub: string; // userId
  tenantId: string;
  email: string;
  roles: string[];
}

export function generateAccessToken(
  userId: string,
  tenantId: string,
  email: string,
  roles: string[],
): string {
  const payload: AccessTokenPayload = {
    sub: userId,
    tenantId,
    email,
    roles,
  };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiration as any,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.secret) as AccessTokenPayload;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a refresh token, store its hash in the database, and return
 * the raw token (to be sent to the client).
 */
export async function generateRefreshToken(
  pool: Pool,
  userId: string,
): Promise<string> {
  const rawToken = uuidv4() + '-' + crypto.randomBytes(32).toString('hex');
  const hash = hashToken(rawToken);

  // Parse refresh expiration to milliseconds
  const expiresMs = parseDuration(config.jwt.refreshExpiration);
  const expiresAt = new Date(Date.now() + expiresMs);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt.toISOString()],
  );

  return rawToken;
}

function parseDuration(dur: string): number {
  const match = dur.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return val * 1000;
    case 'm':
      return val * 60 * 1000;
    case 'h':
      return val * 60 * 60 * 1000;
    case 'd':
      return val * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}
