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
  const subject = 'Your VoiceAgent AI verification code';
  const body = [
    `Your VoiceAgent AI verification code is: ${otp}`,
    '',
    'This code expires in 10 minutes. Enter it on the signup page to finish creating your account.',
    '',
    'If you did not request this code, you can safely ignore this email — no account will be created.',
    '',
    '— VoiceAgent AI',
  ].join('\n');
  const html = renderOtpEmailHtml(otp);

  // Always log to identity-service so dev can grab the OTP if SMTP isn't set up.
  logger.info({ email, otp }, '[OTP] email verification — see notification-service log to confirm delivery');

  // Try the real send via notification-service. Best-effort: failures are
  // logged, never raised, so signup never fails because email infra is down.
  const url = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004';
  // No tenant context exists yet for a new signup — use the synthetic platform
  // tenant id so the notification-service route's x-tenant-id check passes.
  const platformTenantId = process.env.PLATFORM_TENANT_ID || '7ae83e63-dd52-4586-8633-826cb032d4f6';
  try {
    const r = await fetch(`${url}/api/v1/notifications/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': platformTenantId,
      },
      body: JSON.stringify({ type: 'email', recipient: email, subject, body, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      logger.warn({ status: r.status, text: text.slice(0, 200) }, '[OTP] notification-service rejected email send');
    } else {
      logger.info({ email }, '[OTP] dispatched to notification-service for SendGrid delivery');
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, '[OTP] could not reach notification-service — OTP visible only in identity-service log');
  }
}

function renderOtpEmailHtml(otp: string): string {
  const digits = otp.split('').map((d) =>
    `<span style="display:inline-block;width:38px;height:48px;line-height:48px;margin:0 3px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-family:'Courier New',Consolas,monospace;font-size:24px;font-weight:700;text-align:center;letter-spacing:0;">${d}</span>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Verify your email</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your VoiceAgent AI verification code is ${otp}. It expires in 10 minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
            <tr>
              <td style="padding:24px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f43f5e 100%);">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.2);text-align:center;line-height:40px;font-size:20px;color:#ffffff;font-weight:700;">V</div>
                    </td>
                    <td style="padding-left:12px;vertical-align:middle;">
                      <div style="color:#ffffff;font-size:16px;font-weight:700;line-height:1.2;">VoiceAgent AI</div>
                      <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:1px;text-transform:uppercase;">Build · Call · Convert</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 12px;">
                <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Verify your email</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
                  Enter the 6-digit code below to finish creating your VoiceAgent AI account. This code expires in <strong>10 minutes</strong>.
                </p>
                <div style="text-align:center;margin:8px 0 28px;">
                  ${digits}
                </div>
                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
                  Didn't request this? You can safely ignore this email — no account will be created until the code is verified.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
                <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  © ${new Date().getFullYear()} VoiceAgent AI. This is an automated message — please don't reply.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
