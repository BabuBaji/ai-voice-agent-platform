import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import pino from 'pino';

const logger = pino({ name: 'otp-service' });

const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

function generateOtp(): string {
  // 6-digit numeric OTP, zero-padded
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
}

export interface CreateOtpResult {
  /** OTP plaintext — only returned for dev convenience when DEV_RETURN_OTP=true. */
  dev_otp?: string;
  expires_at: Date;
}

/**
 * Generate a fresh OTP for a user, invalidate prior unused codes, store the
 * hash, and "send" it. In dev (DEV_RETURN_OTP=true) the plaintext is returned
 * so the frontend can display it during QA without a real email provider.
 *
 * In production, plug `sendOtpEmail()` into your real email provider (SES,
 * SendGrid, Mailgun, etc.) — the hash never leaves this service.
 */
export async function createOtp(pool: Pool, userId: string, email: string): Promise<CreateOtpResult> {
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  // Invalidate any prior pending OTPs for this user.
  await pool.query(
    `UPDATE email_verifications SET consumed_at = now()
     WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );

  await pool.query(
    `INSERT INTO email_verifications (user_id, otp_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, otpHash, expiresAt],
  );

  await sendOtpEmail(email, otp);

  return {
    expires_at: expiresAt,
    dev_otp: process.env.DEV_RETURN_OTP === 'true' ? otp : undefined,
  };
}

async function sendOtpEmail(email: string, otp: string): Promise<void> {
  // Real email infra is phase-2. For now: log with pino so dev can copy it
  // from the identity-service log if they didn't get the dev_otp in the
  // response. notification-service can be wired in later.
  logger.info({ email, otp }, '[DEV] email verification OTP — replace with real SMTP send in production');

  // Hook point for production:
  // const { sendEmail } = await import('../adapters/email');
  // await sendEmail({ to: email, subject: 'Your verification code', body: `Your code is ${otp}. Valid 10 minutes.` });
}

export interface VerifyOtpResult {
  ok: boolean;
  reason?: 'invalid' | 'expired' | 'consumed' | 'too_many_attempts' | 'no_pending';
}

export async function verifyOtp(pool: Pool, userId: string, otp: string): Promise<VerifyOtpResult> {
  const res = await pool.query(
    `SELECT id, otp_hash, attempts, expires_at, consumed_at
     FROM email_verifications
     WHERE user_id = $1 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  if (res.rows.length === 0) {
    return { ok: false, reason: 'no_pending' };
  }
  const row = res.rows[0];
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const ok = await bcrypt.compare(otp, row.otp_hash);
  if (!ok) {
    await pool.query(
      `UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1`,
      [row.id],
    );
    return { ok: false, reason: 'invalid' };
  }

  // Mark consumed + flip user.email_verified
  await pool.query(
    `UPDATE email_verifications SET consumed_at = now() WHERE id = $1`,
    [row.id],
  );
  await pool.query(
    `UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1`,
    [userId],
  );
  return { ok: true };
}
