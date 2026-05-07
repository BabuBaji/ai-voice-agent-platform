// Real OTP delivery for the KYC wizard:
//   - Email via SMTP (nodemailer; uses the same env vars the notification
//     service does — SMTP_HOST/USER/PASS/PORT/SECURE/FROM_EMAIL/FROM_NAME).
//   - SMS via Plivo's REST Message API.
//
// Either side can fail without blocking the flow — we still return whether
// each channel succeeded so the wizard can fall back to surfacing the OTP
// inline (dev mode) if delivery didn't make it.

import nodemailer, { type Transporter } from 'nodemailer';
import pino from 'pino';

const logger = pino();

let transporter: Transporter | null = null;
let smtpAttempted = false;

function getSmtp(): Transporter | null {
  if (smtpAttempted) return transporter;
  smtpAttempted = true;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    logger.warn('SMTP not configured — OTP emails will not be delivered');
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user, pass },
  });
  logger.info({ host, port: process.env.SMTP_PORT, user }, 'KYC OTP SMTP transporter initialised');
  return transporter;
}

export async function sendOtpEmail(to: string, otp: string, purpose: string): Promise<boolean> {
  const t = getSmtp();
  if (!t) return false;
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '';
  const fromName = process.env.SMTP_FROM_NAME || 'AI Voice Agent';
  const from = `"${fromName}" <${fromEmail}>`;
  const subject = `Your verification code: ${otp}`;
  const text = `Your ${purpose} verification code is: ${otp}\n\nThis code expires in 10 minutes. If you did not request this code, please ignore this email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#0f1421;margin:0 0 12px">Verify your ${purpose}</h2>
      <p style="color:#374151;font-size:14px;line-height:1.5">Use this 6-digit code to continue:</p>
      <div style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:0.5em;background:#f3f4f6;border-radius:8px;padding:16px;text-align:center;color:#0d9488;margin:16px 0">${otp}</div>
      <p style="color:#6b7280;font-size:12px;line-height:1.5">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px">— ${fromName}</p>
    </div>
  `;
  try {
    const info = await t.sendMail({ from, to, subject, text, html });
    logger.info({ to, purpose, messageId: info.messageId }, 'OTP email sent');
    return true;
  } catch (err: any) {
    logger.error({ to, purpose, err: err.message }, 'OTP email send failed');
    return false;
  }
}

/**
 * Place an outbound voice call to the user that TTS-reads the OTP digit by
 * digit. Used instead of SMS in markets where SMS delivery is unreliable
 * (e.g. Indian DLT-restricted destinations).
 *
 * The Plivo Call API requires an `answer_url` it will GET when the user
 * answers. We point it at our /webhooks/kyc-otp-call/:sessionId endpoint
 * which renders Plivo XML <Speak> with the actual digits.
 */
export async function placeOtpCall(toRaw: string, sessionId: string, channel: 'mobile' | 'aadhaar'): Promise<{ ok: boolean; callUuid?: string; error?: string }> {
  const authId = process.env.PLIVO_AUTH_ID;
  const authToken = process.env.PLIVO_AUTH_TOKEN;
  const from = process.env.PLIVO_PHONE_NUMBER;
  const publicBase = process.env.PUBLIC_BASE_URL;
  if (!authId || !authToken || !from) {
    logger.warn('Plivo voice-OTP not configured — call OTP not placed');
    return { ok: false, error: 'Plivo not configured' };
  }
  if (!publicBase) {
    logger.warn('PUBLIC_BASE_URL not set — Plivo cannot reach the answer-url webhook');
    return { ok: false, error: 'Public base URL missing' };
  }
  const to = toRaw.startsWith('+') ? toRaw : '+' + toRaw.replace(/^\+/, '');
  if (!/^\+\d{8,15}$/.test(to)) {
    return { ok: false, error: 'Invalid mobile number format' };
  }

  const answerUrl = `${publicBase.replace(/\/$/, '')}/webhooks/kyc-otp-call/${sessionId}?channel=${channel}`;
  const url = `https://api.plivo.com/v1/Account/${authId}/Call/`;
  const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from.replace(/^\+/, ''),
        to: to.replace(/^\+/, ''),
        answer_url: answerUrl,
        answer_method: 'GET',
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      logger.error({ status: r.status, body: text.slice(0, 300), to, channel }, 'Plivo voice-OTP call create failed');
      let detail: any = text;
      try { detail = JSON.parse(text); } catch {}
      return { ok: false, error: detail?.error || detail?.message || `Plivo ${r.status}` };
    }
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    const callUuid = data.request_uuid || data.message_uuid;
    logger.info({ to, channel, callUuid, sessionId }, 'OTP voice call queued via Plivo');
    return { ok: true, callUuid };
  } catch (err: any) {
    logger.error({ to, channel, err: err.message }, 'OTP voice call threw');
    return { ok: false, error: err.message };
  }
}

export async function sendOtpSms(toRaw: string, otp: string, purpose: string): Promise<boolean> {
  const authId = process.env.PLIVO_AUTH_ID;
  const authToken = process.env.PLIVO_AUTH_TOKEN;
  const from = process.env.PLIVO_PHONE_NUMBER;
  if (!authId || !authToken || !from) {
    logger.warn('Plivo SMS not configured — OTP SMS will not be delivered');
    return false;
  }
  const to = toRaw.replace(/^\+/, '').replace(/\s/g, '');
  if (!/^\d{8,15}$/.test(to)) {
    logger.warn({ to: toRaw }, 'Skipping SMS — invalid phone format');
    return false;
  }
  const fromNum = from.replace(/^\+/, '');
  const text = `Your ${purpose} verification code is ${otp}. It expires in 10 minutes. Don't share this code with anyone.`;
  const url = `https://api.plivo.com/v1/Account/${authId}/Message/`;
  const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: fromNum, dst: to, text }),
    });
    const body = await r.text();
    if (!r.ok) {
      logger.error({ status: r.status, body: body.slice(0, 300), to }, 'Plivo SMS send failed');
      return false;
    }
    logger.info({ to, purpose, body: body.slice(0, 100) }, 'OTP SMS sent via Plivo');
    return true;
  } catch (err: any) {
    logger.error({ to, purpose, err: err.message }, 'Plivo SMS send threw');
    return false;
  }
}
