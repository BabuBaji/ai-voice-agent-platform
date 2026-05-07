// 6-step instant-KYC wizard:
//   register → otp → pan → aadhaar → gstin → complete
//
// Each step has its own endpoint. State lives in kyc_sessions (one row per
// in-flight purchase, 30-min TTL). On `complete` we register a Plivo End User
// and rent the number — only then does the phone_numbers row appear.
//
// OTP delivery: in dev (KYC_DEV_MODE !== 'production') we return the codes in
// the response body so local testing works without an SMS/email gateway.

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import pino from 'pino';
import { pool } from '../index';
import { plivoProvider } from '../providers/plivo.provider';
import {
  panValid,
  gstinValid,
  gstinPanConsistent,
  aadhaarValid,
  aadhaarLast4,
} from '../utils/kyc';
import { sendOtpEmail, placeOtpCall } from '../utils/otpSender';

const logger = pino();
export const kycWizardRouter = Router();

const DEV = (process.env.KYC_DEV_MODE || 'dev') !== 'production';
// Always echo OTPs in the API response when running locally. SMTP "success"
// doesn't mean the recipient saw the email (Gmail spam filter), and the Plivo
// test account hits 402 Insufficient balance for outbound calls. Set
// KYC_ALWAYS_SHOW_OTP=0 to disable.
const ALWAYS_SHOW_OTP = DEV && (process.env.KYC_ALWAYS_SHOW_OTP || '1') !== '0';
const OTP_TTL_MS = 10 * 60 * 1000; // 10 min
const MAX_OTP_ATTEMPTS = 5;

function genOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}
function hashOtp(otp: string, sessionId: string): string {
  return crypto.createHash('sha256').update(`${sessionId}:${otp}`).digest('hex');
}
function tenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return t;
}
function nameMatchScore(a: string, b: string): number {
  // Loose name match: tokenize, lowercase, compare overlap
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const x of ta) if (tb.has(x)) common++;
  return common / Math.max(ta.size, tb.size);
}

async function loadSession(id: string, tenant: string) {
  const r = await pool.query(
    `SELECT * FROM kyc_sessions WHERE id = $1 AND tenant_id = $2`,
    [id, tenant],
  );
  return r.rows[0] || null;
}

function publicSession(s: any) {
  if (!s) return null;
  return {
    id: s.id,
    provider: s.provider,
    number: s.number,
    capabilities: s.capabilities,
    monthly_rate: s.monthly_rate ? parseFloat(s.monthly_rate) : null,
    is_sandbox: !!s.is_sandbox,
    current_step: s.current_step,
    full_name: s.full_name,
    email: s.email,
    mobile: s.mobile,
    email_verified: s.email_verified,
    mobile_verified: s.mobile_verified,
    pan: s.pan,
    pan_holder_name: s.pan_holder_name,
    pan_verified: s.pan_verified,
    aadhaar_last4: s.aadhaar_last4,
    aadhaar_verified: s.aadhaar_verified,
    gstin: s.gstin,
    gstin_verified: s.gstin_verified,
    gstin_skipped: s.gstin_skipped,
    purchased_phone_id: s.purchased_phone_id,
    status: s.status,
    expires_at: s.expires_at,
    created_at: s.created_at,
  };
}

// ─── POST /reserve ─────────────────────────────────────────────────────
// Creates a new wizard session for a number. The number isn't actually rented
// at the carrier yet — that happens at /complete. Reserving here means: this
// number is held in our system for 30 minutes while the user finishes KYC.
const reserveSchema = z.object({
  provider: z.enum(['plivo', 'twilio', 'exotel']).default('plivo'),
  number: z.string().min(5),
  capabilities: z.array(z.enum(['voice', 'sms'])).default(['voice']),
  monthly_rate: z.number().optional(),
  is_sandbox: z.boolean().optional().default(false),
});

kycWizardRouter.post('/reserve', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const body = reserveSchema.parse(req.body);

    // Refuse if we already own this number
    const owned = await pool.query(
      `SELECT id FROM phone_numbers WHERE phone_number = $1 OR phone_number = $2`,
      [body.number, '+' + body.number.replace(/^\+/, '')],
    );
    if (owned.rows.length > 0) {
      res.status(409).json({ error: 'Already Owned', message: 'You already own this number.' });
      return;
    }

    // Refuse if any other tenant has an in-flight session on this exact number
    const held = await pool.query(
      `SELECT id, tenant_id FROM kyc_sessions
        WHERE number = $1 AND status = 'in_progress' AND expires_at > NOW()`,
      [body.number],
    );
    if (held.rows.length > 0 && held.rows[0].tenant_id !== t) {
      res.status(409).json({ error: 'Reserved', message: 'Another customer is currently reserving this number. Try again in a few minutes.' });
      return;
    }

    // Reuse this tenant's existing in-flight session for the same number
    if (held.rows.length > 0 && held.rows[0].tenant_id === t) {
      const ses = await loadSession(held.rows[0].id, t);
      res.status(200).json({ data: publicSession(ses), reused: true });
      return;
    }

    const ins = await pool.query(
      `INSERT INTO kyc_sessions (tenant_id, provider, number, capabilities, monthly_rate, is_sandbox)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [t, body.provider, body.number, JSON.stringify(body.capabilities), body.monthly_rate ?? null, body.is_sandbox],
    );
    res.status(201).json({ data: publicSession(ins.rows[0]) });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: e.errors });
      return;
    }
    next(e);
  }
});

// ─── GET /:id ──────────────────────────────────────────────────────────
kycWizardRouter.get('/:id', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found', message: 'KYC session not found' }); return; }
    res.json({ data: publicSession(ses) });
  } catch (e) { next(e); }
});

// ─── POST /:id/register ────────────────────────────────────────────────
// Step 1 → 2. Stores name/email/mobile, generates email + mobile OTPs.
const registerSchema = z.object({
  full_name: z.string().min(2).max(200),
  email: z.string().email(),
  mobile: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Mobile must be E.164'),
});

kycWizardRouter.post('/:id/register', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (ses.status !== 'in_progress') { res.status(410).json({ error: 'Session Closed' }); return; }

    const body = registerSchema.parse(req.body);
    const emailOtp = genOtp();
    const mobileOtp = genOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);

    await pool.query(
      `UPDATE kyc_sessions SET
         full_name=$1, email=$2, mobile=$3,
         email_otp_hash=$4, email_otp_expires=$5, email_verified=FALSE,
         mobile_otp_hash=$6, mobile_otp_expires=$7, mobile_otp_plain=$8, mobile_verified=FALSE,
         otp_attempts=0, current_step='otp', updated_at=NOW()
        WHERE id=$9`,
      [
        body.full_name, body.email, body.mobile,
        hashOtp(emailOtp, ses.id), expires,
        hashOtp(mobileOtp, ses.id), expires,
        mobileOtp,
        ses.id,
      ],
    );
    // We persist the plaintext OTP in mobile_otp_plain so the voice-call
    // webhook can render it via <Speak>. Hashed copy in mobile_otp_hash is
    // what verifies the user's input.

    // Real delivery — fire both in parallel.
    const [emailOk, callRes] = await Promise.all([
      sendOtpEmail(body.email, emailOtp, 'email'),
      placeOtpCall(body.mobile, ses.id, 'mobile'),
    ]);
    if (callRes.callUuid) {
      await pool.query(`UPDATE kyc_sessions SET mobile_call_uuid=$1 WHERE id=$2`, [callRes.callUuid, ses.id]);
    }
    logger.info({ session: ses.id, mobile: body.mobile, email: body.email, emailOk, callOk: callRes.ok, callUuid: callRes.callUuid }, 'KYC OTPs dispatched');

    const updated = await loadSession(ses.id, t);
    res.json({
      data: publicSession(updated),
      otp_sent: { email: emailOk, mobile: callRes.ok, channel: 'voice_call', expires_at: expires.toISOString() },
      mobile_call_uuid: callRes.callUuid,
      mobile_call_error: callRes.ok ? null : callRes.error,
      // In dev mode echo BOTH codes inline so the wizard can be completed
      // without depending on email-inbox delivery or carrier balance.
      ...(ALWAYS_SHOW_OTP ? { dev_otp: { email: emailOtp, mobile: mobileOtp } } : {}),
    });
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: e.errors }); return; }
    next(e);
  }
});

// ─── POST /:id/resend-otp ──────────────────────────────────────────────
kycWizardRouter.post('/:id/resend-otp', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (!ses.email || !ses.mobile) { res.status(400).json({ error: 'Bad Request', message: 'Complete step 1 first' }); return; }

    const which = (req.body?.channel || 'all') as 'email' | 'mobile' | 'all';
    const expires = new Date(Date.now() + OTP_TTL_MS);
    const updates: string[] = [];
    const vals: any[] = [];
    let i = 1;
    let dev: any = {};

    if (which === 'email' || which === 'all') {
      const o = genOtp();
      updates.push(`email_otp_hash=$${i++}`); vals.push(hashOtp(o, ses.id));
      updates.push(`email_otp_expires=$${i++}`); vals.push(expires);
      updates.push(`email_verified=FALSE`);
      dev.email = o;
    }
    if (which === 'mobile' || which === 'all') {
      const o = genOtp();
      updates.push(`mobile_otp_hash=$${i++}`); vals.push(hashOtp(o, ses.id));
      updates.push(`mobile_otp_expires=$${i++}`); vals.push(expires);
      updates.push(`mobile_otp_plain=$${i++}`); vals.push(o);
      updates.push(`mobile_verified=FALSE`);
      dev.mobile = o;
    }
    updates.push(`otp_attempts=0`);
    updates.push(`updated_at=NOW()`);
    vals.push(ses.id);

    await pool.query(`UPDATE kyc_sessions SET ${updates.join(', ')} WHERE id=$${i}`, vals);
    const sendResults: any = {};
    if (dev.email) sendResults.email = await sendOtpEmail(ses.email, dev.email, 'email');
    let mobileCallUuid: string | undefined;
    if (dev.mobile) {
      const callRes = await placeOtpCall(ses.mobile, ses.id, 'mobile');
      sendResults.mobile = callRes.ok;
      mobileCallUuid = callRes.callUuid;
      if (callRes.callUuid) {
        await pool.query(`UPDATE kyc_sessions SET mobile_call_uuid=$1 WHERE id=$2`, [callRes.callUuid, ses.id]);
      }
    }
    logger.info({ session: ses.id, channel: which, ...sendResults, mobileCallUuid }, 'KYC OTPs resent');
    // In dev mode always echo the codes so the wizard works without spam-folder/balance issues.
    res.json({
      ok: true,
      expires_at: expires.toISOString(),
      sent: sendResults,
      channel: which === 'mobile' ? 'voice_call' : (which === 'email' ? 'email' : 'voice_call_and_email'),
      mobile_call_uuid: mobileCallUuid,
      ...(ALWAYS_SHOW_OTP && Object.keys(dev).length ? { dev_otp: dev } : {}),
    });
  } catch (e) { next(e); }
});

// ─── POST /:id/verify-otp ──────────────────────────────────────────────
// Step 2 → 3. Verifies BOTH email + mobile OTPs at once.
const verifyOtpSchema = z.object({
  email_otp: z.string().regex(/^\d{6}$/),
  mobile_otp: z.string().regex(/^\d{6}$/),
});

kycWizardRouter.post('/:id/verify-otp', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (ses.status !== 'in_progress') { res.status(410).json({ error: 'Session Closed' }); return; }
    if (ses.otp_attempts >= MAX_OTP_ATTEMPTS) {
      res.status(429).json({ error: 'Too Many Attempts', message: 'Resend OTPs to retry.' });
      return;
    }

    const body = verifyOtpSchema.parse(req.body);
    const now = new Date();
    if (!ses.email_otp_hash || !ses.email_otp_expires || new Date(ses.email_otp_expires) < now) {
      res.status(400).json({ error: 'OTP Expired', message: 'Please request a new code.', field: 'email_otp' });
      return;
    }
    if (!ses.mobile_otp_hash || !ses.mobile_otp_expires || new Date(ses.mobile_otp_expires) < now) {
      res.status(400).json({ error: 'OTP Expired', message: 'Please request a new code.', field: 'mobile_otp' });
      return;
    }

    const emailOk = hashOtp(body.email_otp, ses.id) === ses.email_otp_hash;
    const mobileOk = hashOtp(body.mobile_otp, ses.id) === ses.mobile_otp_hash;

    if (!emailOk || !mobileOk) {
      await pool.query(`UPDATE kyc_sessions SET otp_attempts=otp_attempts+1, updated_at=NOW() WHERE id=$1`, [ses.id]);
      const errs: any[] = [];
      if (!emailOk) errs.push({ field: 'email_otp', message: 'Email OTP is incorrect' });
      if (!mobileOk) errs.push({ field: 'mobile_otp', message: 'Mobile OTP is incorrect' });
      res.status(401).json({ error: 'OTP Mismatch', details: errs });
      return;
    }

    await pool.query(
      `UPDATE kyc_sessions SET
         email_verified=TRUE, mobile_verified=TRUE,
         email_otp_hash=NULL, mobile_otp_hash=NULL,
         current_step='pan', updated_at=NOW()
       WHERE id=$1`,
      [ses.id],
    );
    const updated = await loadSession(ses.id, t);
    res.json({ data: publicSession(updated) });
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: e.errors }); return; }
    next(e);
  }
});

// ─── POST /:id/pan ─────────────────────────────────────────────────────
// Step 3 → 4. PAN format + name match against the registered full name.
const panSchema = z.object({
  pan: z.string().min(10).max(10),
  name_on_pan: z.string().min(2).max(200),
});

kycWizardRouter.post('/:id/pan', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (!ses.email_verified || !ses.mobile_verified) {
      res.status(403).json({ error: 'OTP Not Verified', message: 'Complete OTP verification first.' });
      return;
    }
    const body = panSchema.parse(req.body);
    const pan = body.pan.toUpperCase().trim();
    if (!panValid(pan)) {
      res.status(422).json({ error: 'Invalid PAN', details: [{ field: 'pan', message: 'PAN must match AAAAA9999A format' }] });
      return;
    }

    // Real-world: this is where you'd hit NSDL's PAN verification API.
    // Without that, we cross-check that name_on_pan loosely matches the
    // registered full_name — a strong signal that it's the same person.
    const score = nameMatchScore(body.name_on_pan, ses.full_name || '');
    if (score < 0.5) {
      res.status(422).json({
        error: 'Name Mismatch',
        details: [{ field: 'name_on_pan', message: `Name on PAN does not match your registered name "${ses.full_name}". Please use the exact name as on your PAN card.` }],
      });
      return;
    }

    await pool.query(
      `UPDATE kyc_sessions SET pan=$1, pan_holder_name=$2, pan_verified=TRUE, current_step='aadhaar', updated_at=NOW() WHERE id=$3`,
      [pan, body.name_on_pan.trim(), ses.id],
    );
    const updated = await loadSession(ses.id, t);
    res.json({ data: publicSession(updated) });
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: e.errors }); return; }
    next(e);
  }
});

// ─── POST /:id/aadhaar/init ────────────────────────────────────────────
// Validates the 12-digit Aadhaar (Verhoeff) and generates an OTP.
const aadhaarInitSchema = z.object({ aadhaar: z.string().min(12).max(12) });

kycWizardRouter.post('/:id/aadhaar/init', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (!ses.pan_verified) {
      res.status(403).json({ error: 'PAN Not Verified', message: 'Verify PAN before Aadhaar.' });
      return;
    }
    const body = aadhaarInitSchema.parse(req.body);
    if (!aadhaarValid(body.aadhaar)) {
      res.status(422).json({ error: 'Invalid Aadhaar', details: [{ field: 'aadhaar', message: 'Aadhaar checksum failed. Re-enter the 12-digit number from your card.' }] });
      return;
    }
    const otp = genOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await pool.query(
      `UPDATE kyc_sessions SET aadhaar_last4=$1, aadhaar_otp_hash=$2, aadhaar_otp_expires=$3, aadhaar_otp_plain=$4, aadhaar_verified=FALSE, otp_attempts=0, updated_at=NOW() WHERE id=$5`,
      [aadhaarLast4(body.aadhaar), hashOtp(otp, ses.id), expires, otp, ses.id],
    );
    const callRes = ses.mobile ? await placeOtpCall(ses.mobile, ses.id, 'aadhaar') : { ok: false, error: 'No mobile on file' };
    if (callRes.ok && callRes.callUuid) {
      await pool.query(`UPDATE kyc_sessions SET aadhaar_call_uuid=$1 WHERE id=$2`, [callRes.callUuid, ses.id]);
    }
    logger.info({ session: ses.id, last4: aadhaarLast4(body.aadhaar), callOk: callRes.ok, callUuid: callRes.callUuid }, 'Aadhaar OTP voice call dispatched');
    res.json({
      ok: true,
      mobile_hint: ses.mobile ? `Calling ${ses.mobile} now — answer the call to hear your verification code` : '',
      expires_at: expires.toISOString(),
      sent: callRes.ok,
      channel: 'voice_call',
      call_uuid: callRes.callUuid,
      ...(ALWAYS_SHOW_OTP ? { dev_otp: otp } : {}),
    });
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: e.errors }); return; }
    next(e);
  }
});

// ─── POST /:id/aadhaar/verify ──────────────────────────────────────────
// Step 4 → 5. Verifies Aadhaar OTP.
const aadhaarVerifySchema = z.object({ otp: z.string().regex(/^\d{6}$/) });

kycWizardRouter.post('/:id/aadhaar/verify', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (!ses.aadhaar_otp_hash) {
      res.status(400).json({ error: 'No OTP Pending', message: 'Submit your Aadhaar number first.' });
      return;
    }
    if (new Date(ses.aadhaar_otp_expires) < new Date()) {
      res.status(400).json({ error: 'OTP Expired', message: 'Request a new Aadhaar OTP.' });
      return;
    }
    if (ses.otp_attempts >= MAX_OTP_ATTEMPTS) {
      res.status(429).json({ error: 'Too Many Attempts' });
      return;
    }
    const body = aadhaarVerifySchema.parse(req.body);
    if (hashOtp(body.otp, ses.id) !== ses.aadhaar_otp_hash) {
      await pool.query(`UPDATE kyc_sessions SET otp_attempts=otp_attempts+1, updated_at=NOW() WHERE id=$1`, [ses.id]);
      res.status(401).json({ error: 'OTP Mismatch', details: [{ field: 'otp', message: 'Aadhaar OTP is incorrect' }] });
      return;
    }
    await pool.query(
      `UPDATE kyc_sessions SET aadhaar_verified=TRUE, aadhaar_otp_hash=NULL, current_step='gstin', updated_at=NOW() WHERE id=$1`,
      [ses.id],
    );
    const updated = await loadSession(ses.id, t);
    res.json({ data: publicSession(updated) });
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: e.errors }); return; }
    next(e);
  }
});

// ─── POST /:id/gstin ───────────────────────────────────────────────────
// Step 5 → 6. GSTIN is optional — pass `skip:true` to bypass.
const gstinSchema = z.object({
  gstin: z.string().min(15).max(15).optional(),
  skip: z.boolean().optional(),
});

kycWizardRouter.post('/:id/gstin', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (!ses.aadhaar_verified) {
      res.status(403).json({ error: 'Aadhaar Not Verified', message: 'Verify Aadhaar before GST.' });
      return;
    }
    const body = gstinSchema.parse(req.body);
    if (body.skip) {
      await pool.query(
        `UPDATE kyc_sessions SET gstin=NULL, gstin_verified=FALSE, gstin_skipped=TRUE, current_step='complete', updated_at=NOW() WHERE id=$1`,
        [ses.id],
      );
      const updated = await loadSession(ses.id, t);
      res.json({ data: publicSession(updated) });
      return;
    }
    if (!body.gstin) {
      res.status(422).json({ error: 'GSTIN Required', details: [{ field: 'gstin', message: 'Provide GSTIN or skip this step.' }] });
      return;
    }
    const gstin = body.gstin.toUpperCase().trim();
    if (!gstinValid(gstin)) {
      res.status(422).json({ error: 'Invalid GSTIN', details: [{ field: 'gstin', message: 'GSTIN must be 15 chars: 2 state + 10 PAN + 1 entity + 1 Z + 1 checksum.' }] });
      return;
    }
    if (ses.pan && !gstinPanConsistent(gstin, ses.pan)) {
      res.status(422).json({
        error: 'GSTIN PAN Mismatch',
        details: [{ field: 'gstin', message: `GSTIN positions 3–12 (${gstin.slice(2, 12)}) must match your PAN (${ses.pan}).` }],
      });
      return;
    }
    await pool.query(
      `UPDATE kyc_sessions SET gstin=$1, gstin_verified=TRUE, gstin_skipped=FALSE, current_step='complete', updated_at=NOW() WHERE id=$2`,
      [gstin, ses.id],
    );
    const updated = await loadSession(ses.id, t);
    res.json({ data: publicSession(updated) });
  } catch (e) {
    if (e instanceof z.ZodError) { res.status(400).json({ error: 'Validation Error', details: e.errors }); return; }
    next(e);
  }
});

// ─── POST /:id/complete ────────────────────────────────────────────────
// Step 6. Persists kyc_submissions, calls Plivo EndUser API, rents the
// number with end_user_id, inserts phone_numbers row, marks session done.
kycWizardRouter.post('/:id/complete', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const ses = await loadSession(req.params.id, t);
    if (!ses) { res.status(404).json({ error: 'Not Found' }); return; }
    if (ses.status === 'completed' && ses.purchased_phone_id) {
      const r = await pool.query(`SELECT * FROM phone_numbers WHERE id = $1`, [ses.purchased_phone_id]);
      res.json({ data: r.rows[0], session: publicSession(ses), already_completed: true });
      return;
    }
    if (!ses.email_verified || !ses.mobile_verified || !ses.pan_verified || !ses.aadhaar_verified) {
      res.status(403).json({ error: 'Incomplete', message: 'All KYC steps must be verified first.' });
      return;
    }
    if (!ses.gstin_verified && !ses.gstin_skipped) {
      res.status(403).json({ error: 'Incomplete', message: 'Submit or skip the GSTIN step first.' });
      return;
    }

    // Sandbox / synthetic numbers skip the carrier path entirely. We've still
    // collected and verified KYC for them — that data is persisted into
    // kyc_submissions just like real numbers — but no Plivo End-User /
    // PhoneNumber call is made and the row is stored with provider="sandbox"
    // so downstream code can treat it as test-only.
    if (ses.is_sandbox || ses.provider !== 'plivo') {
      // Persist KYC submission (no end_user_id since carrier wasn't involved)
      await pool.query(
        `INSERT INTO kyc_submissions
           (tenant_id, provider, status, business_name, owner_name, owner_email, owner_phone,
            pan, aadhaar_last4, gstin, address_line1, city, state, postal_code, country, use_case,
            verified_at)
         VALUES ($1,$2,'verified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
         ON CONFLICT (tenant_id, provider) DO UPDATE SET
           status='verified', business_name=EXCLUDED.business_name, owner_name=EXCLUDED.owner_name,
           owner_email=EXCLUDED.owner_email, owner_phone=EXCLUDED.owner_phone,
           pan=EXCLUDED.pan, aadhaar_last4=EXCLUDED.aadhaar_last4, gstin=EXCLUDED.gstin,
           rejection_reason=NULL, verified_at=NOW(), updated_at=NOW()`,
        [
          t, ses.provider,
          ses.full_name, ses.full_name, ses.email, ses.mobile,
          ses.pan, ses.aadhaar_last4, ses.gstin,
          '—', '—', '—', '—', 'IN',
          'Sandbox/test number — KYC verified for in-app demo flows.',
        ],
      );

      const caps = (ses.capabilities || ['voice']) as string[];
      const ins = await pool.query(
        `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
         VALUES ($1, $2, 'sandbox', $3, $4, TRUE) RETURNING *`,
        [
          t, ses.number, `sb_${ses.id}`,
          JSON.stringify({ voice: caps.includes('voice'), sms: caps.includes('sms'), sandbox: true }),
        ],
      );
      const phone = ins.rows[0];
      await pool.query(
        `UPDATE kyc_sessions SET status='completed', purchased_phone_id=$1, current_step='complete', updated_at=NOW() WHERE id=$2`,
        [phone.id, ses.id],
      );
      const updated = await loadSession(ses.id, t);
      res.status(201).json({ data: phone, session: publicSession(updated), sandbox: true });
      return;
    }

    // 1. Register Plivo End User
    let endUserId: string;
    try {
      const parts = (ses.full_name || '').trim().split(/\s+/);
      const r = await plivoProvider.registerEndUser({
        name: parts[0] || ses.full_name,
        last_name: parts.slice(1).join(' '),
        end_user_type: 'business',
      });
      endUserId = r.endUserId;
    } catch (err: any) {
      res.status(502).json({ error: 'Carrier Rejection', message: `Plivo rejected the End-User registration: ${err.message}` });
      return;
    }

    // 2. Persist kyc_submissions (verified)
    await pool.query(
      `INSERT INTO kyc_submissions
         (tenant_id, provider, status, business_name, owner_name, owner_email, owner_phone,
          pan, aadhaar_last4, gstin, address_line1, city, state, postal_code, country, use_case,
          provider_end_user_id, verified_at)
       VALUES ($1,$2,'verified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status='verified',
         business_name=EXCLUDED.business_name,
         owner_name=EXCLUDED.owner_name,
         owner_email=EXCLUDED.owner_email,
         owner_phone=EXCLUDED.owner_phone,
         pan=EXCLUDED.pan,
         aadhaar_last4=EXCLUDED.aadhaar_last4,
         gstin=EXCLUDED.gstin,
         provider_end_user_id=EXCLUDED.provider_end_user_id,
         rejection_reason=NULL,
         verified_at=NOW(),
         updated_at=NOW()`,
      [
        t, ses.provider,
        ses.full_name, ses.full_name, ses.email, ses.mobile,
        ses.pan, ses.aadhaar_last4, ses.gstin,
        '—', '—', '—', '—', 'IN',
        'Outbound/inbound voice agent calls (KYC via instant wizard).',
        endUserId,
      ],
    );

    // 3. Rent the number
    let purchased;
    try {
      purchased = await plivoProvider.provisionNumberWithEndUser({
        number: ses.number,
        endUserId,
        capabilities: (ses.capabilities || ['voice']).filter((c: string) => c === 'voice' || c === 'sms') as ('voice' | 'sms')[],
      });
    } catch (err: any) {
      const lower = (err.message || '').toLowerCase();
      const isCompliance = lower.includes('complian') || lower.includes('kyc') || lower.includes('document');
      res.status(isCompliance ? 422 : 502).json({
        error: isCompliance ? 'Compliance Required' : 'Provider Error',
        message: isCompliance
          ? `Plivo compliance is incomplete: ${err.message}. Finish DOT/TRAI doc upload at console.plivo.com.`
          : err.message,
      });
      return;
    }

    // 4. Persist phone_numbers row
    const caps = (ses.capabilities || ['voice']) as string[];
    const ins = await pool.query(
      `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
      [
        t, purchased.number, ses.provider, purchased.providerNumberId,
        JSON.stringify({ voice: caps.includes('voice'), sms: caps.includes('sms') }),
      ],
    );
    const phone = ins.rows[0];

    await pool.query(
      `UPDATE kyc_sessions SET status='completed', purchased_phone_id=$1, provider_end_user_id=$2, current_step='complete', updated_at=NOW() WHERE id=$3`,
      [phone.id, endUserId, ses.id],
    );
    const updated = await loadSession(ses.id, t);
    res.status(201).json({ data: phone, session: publicSession(updated) });
  } catch (e) { next(e); }
});

// ─── DELETE /:id ───────────────────────────────────────────────────────
// Cancel an in-flight session. Frees up the number for someone else.
kycWizardRouter.delete('/:id', async (req, res, next) => {
  try {
    const t = tenantId(req, res); if (!t) return;
    const r = await pool.query(
      `UPDATE kyc_sessions SET status='cancelled', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='in_progress' RETURNING id`,
      [req.params.id, t],
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    res.status(204).send();
  } catch (e) { next(e); }
});
