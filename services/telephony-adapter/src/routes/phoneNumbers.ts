import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { twilioProvider } from '../providers/twilio.provider';
import { exotelProvider } from '../providers/exotel.provider';
import { plivoProvider } from '../providers/plivo.provider';
import { getProvider } from '../providers';
import { validateKyc, aadhaarLast4 } from '../utils/kyc';
import { generateSandboxNumbers } from '../providers/sandbox.catalog';
import { debitForRental } from '../services/walletClient';

export const phoneNumberRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

const provisionSchema = z.object({
  provider: z.enum(['twilio', 'exotel', 'plivo']).default('plivo'),
  country: z.string().min(2).max(2).default('US'),
  capabilities: z.array(z.enum(['voice', 'sms'])).default(['voice']),
  area_code: z.string().optional(),
});

const buySchema = z.object({
  provider: z.enum(['twilio', 'exotel', 'plivo']).default('plivo'),
  number: z.string().min(5),
  capabilities: z.array(z.enum(['voice', 'sms'])).default(['voice']),
});

// Used for "Add existing number" — imports a number the tenant already owns
// on the carrier (typical for Exotel which has no number-catalog API, and
// for Twilio/Plivo numbers bought via the carrier's own dashboard).
const importSchema = z.object({
  provider: z.enum(['twilio', 'exotel', 'plivo']),
  phone_number: z.string().min(5).max(20),
  provider_sid: z.string().optional(),
  capabilities: z.array(z.enum(['voice', 'sms'])).default(['voice']),
  // Per-carrier credentials. When present, we validate them with the carrier
  // BEFORE storing the row. Without credentials we fall through to env-var
  // creds (legacy trust-based flow) so existing imports keep working.
  twilio_account_sid: z.string().optional(),
  twilio_auth_token: z.string().optional(),
  exotel_api_key: z.string().optional(),
  exotel_api_token: z.string().optional(),
  exotel_subdomain: z.string().optional(),
  exotel_account_sid: z.string().optional(),
  // SIP — informational only, stored as metadata; no carrier-side validation.
  sip_uri: z.string().optional(),
  sip_username: z.string().optional(),
  sip_password: z.string().optional(),
});

const updatePhoneNumberSchema = z.object({
  agent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

// GET /phone-numbers
phoneNumberRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const result = await pool.query(
      'SELECT * FROM phone_numbers WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /phone-numbers/available?provider=plivo&country=US&capabilities=voice
// Lists numbers available for purchase. No DB write.
//
// Returns 200 + `data: []` (with `reason` + friendly `message`) for the common
// soft-failure cases:
//   - provider credentials missing
//   - country not served by this provider
//   - provider blocks new numbers without account verification
// Only escalates to 502 when the provider call truly errored upstream.
phoneNumberRouter.get('/available', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!getTenantId(req, res)) return;
    const provider = ((req.query.provider as string) || 'plivo').toLowerCase();
    const country = ((req.query.country as string) || 'US').toUpperCase();
    const caps = ((req.query.capabilities as string) || 'voice').split(',').map((s) => s.trim()) as ('voice' | 'sms')[];

    const p = getProvider(provider);
    let real: any[] = [];
    let realErr: any = null;
    try { real = await p.listAvailableNumbers(country, caps); } catch (err) { realErr = err; }

    // If the real catalog returned at least one number, use it as-is.
    if (real.length > 0) {
      res.json({ data: real, provider, country });
      return;
    }

    // Real catalog empty — fall back to the synthetic sandbox catalog so
    // every (provider, country) combo can be demoed end-to-end. The hint
    // tells the UI these are test numbers (see `synthetic: true`).
    const sandbox = generateSandboxNumbers({ provider, country, capabilities: caps });
    const msg = (realErr?.message || '').toLowerCase();
    const status = realErr?.status || realErr?.statusCode;
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    let hint = `${cap(provider)} doesn't sell real numbers in ${country} from this account. Showing test (sandbox) numbers — buy one to try the agent flow without live PSTN calls.`;
    if (msg.includes('credentials') || msg.includes('not configured') || msg.includes('authenticate'))
      hint = `${cap(provider)} credentials aren't configured. Showing test (sandbox) numbers — add credentials in Settings → Integrations to access the live catalog.`;
    else if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden'))
      hint = `${cap(provider)} rejected the credentials for this account. Showing test (sandbox) numbers in the meantime.`;
    else if (provider === 'exotel')
      hint = `Exotel doesn't expose a public number-catalog API. Showing test (sandbox) numbers — for real Exotel numbers, buy via my.exotel.com and click "Add existing number" above.`;

    res.json({ data: sandbox, provider, country, sandbox: true, message: hint });
  } catch (err) { next(err); }
});

// GET /phone-numbers/available-all — unified inventory across all carriers.
// Fetches plivo + twilio + exotel in parallel, tags each row with its source
// provider, and returns the merged list. If all carriers return zero numbers,
// falls back to the synthetic sandbox catalog so the UI can still demo flows.
phoneNumberRouter.get('/available-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!getTenantId(req, res)) return;
    const country = ((req.query.country as string) || 'US').toUpperCase();
    const caps = ((req.query.capabilities as string) || 'voice').split(',').map((s) => s.trim()) as ('voice' | 'sms')[];

    const carriers = ['plivo', 'twilio', 'exotel'] as const;
    const results = await Promise.allSettled(
      carriers.map(async (name) => {
        const p = getProvider(name);
        const rows = await p.listAvailableNumbers(country, caps);
        return { name, rows };
      }),
    );

    const merged: any[] = [];
    const errors: { provider: string; error: string }[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const carrierName = carriers[i];
      if (r.status === 'fulfilled') {
        for (const row of r.value.rows) {
          merged.push({ ...row, provider: carrierName });
        }
      } else {
        errors.push({ provider: carrierName, error: r.reason?.message || String(r.reason) });
      }
    }

    if (merged.length > 0) {
      res.json({ data: merged, country, errors: errors.length > 0 ? errors : undefined });
      return;
    }

    // All carriers empty — fall back to sandbox using plivo's prefix table for India,
    // generic prefixes elsewhere. The UI shows synthetic:true so they're clearly test rows.
    const sandbox = generateSandboxNumbers({ provider: 'plivo', country, capabilities: caps });
    const tagged = sandbox.map((row) => ({ ...row, provider: 'sandbox' }));
    const msg = errors.length > 0
      ? `No real inventory available in ${country} from any carrier (${errors.map((e) => e.provider).join(', ')} all returned errors or empty). Showing test (sandbox) numbers.`
      : `No real inventory available in ${country} from any carrier. Showing test (sandbox) numbers.`;
    res.json({ data: tagged, country, sandbox: true, message: msg, errors: errors.length > 0 ? errors : undefined });
  } catch (err) { next(err); }
});

// POST /phone-numbers/buy — purchase a specific number from the provider's
// catalog and persist it to phone_numbers. Used by the "Buy" button in the UI.
phoneNumberRouter.post('/buy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = buySchema.parse(req.body);

    // Avoid double-rent: refuse if we already own this number
    const existing = await pool.query(
      `SELECT id FROM phone_numbers WHERE phone_number = $1 OR phone_number = $2`,
      [parsed.number, '+' + parsed.number.replace(/^\+/, '')],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Already Owned', message: 'This number is already in your account.' });
      return;
    }

    const provider = getProvider(parsed.provider);
    let purchased;
    try {
      purchased = await provider.provisionNumber({
        country: 'US',
        capabilities: parsed.capabilities,
        // Pass exact number through `areaCode` since the SDK uses one field
        areaCode: parsed.number,
      });
    } catch (err: any) {
      res.status(502).json({ error: 'Provider Error', message: err.message });
      return;
    }

    // Wallet debit (best-effort) — refuse purchase if balance insufficient.
    // Identity-service /billing/phone-numbers POST does the balance check +
    // debit + invoice atomically on its side. We forward the caller's
    // Authorization so the request is properly attributed.
    const debit = await debitForRental({
      authHeader: req.headers.authorization,
      tenantId,
      number: purchased.number,
      provider: parsed.provider,
      monthlyCost: undefined,
    });
    if (!debit.ok && debit.status === 402) {
      // Best-effort release at carrier so we don't keep a number we couldn't pay for.
      try { await provider.releaseNumber(purchased.providerNumberId); } catch { /* swallow */ }
      res.status(402).json({
        error: 'Insufficient Wallet Balance',
        message: debit.body?.message || 'Top up the wallet and retry the purchase.',
        required: debit.body?.required,
        available: debit.body?.available,
      });
      return;
    }
    // Non-fatal: if identity-service is unreachable, log it and continue —
    // we'll insert the number row but billing will be reconciled later.

    const inserted = await pool.query(
      `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [
        tenantId,
        purchased.number,
        parsed.provider,
        purchased.providerNumberId,
        JSON.stringify({
          voice: parsed.capabilities.includes('voice'),
          sms: parsed.capabilities.includes('sms'),
          billing_debit_status: debit.ok ? 'debited' : 'pending',
        }),
      ],
    );

    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// GET /phone-numbers/kyc?provider=plivo — return current KYC submission for
// this tenant+provider so the UI can pre-fill / skip the form when verified.
phoneNumberRouter.get('/kyc', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const provider = ((req.query.provider as string) || 'plivo').toLowerCase();
    const r = await pool.query(
      `SELECT id, status, business_name, owner_name, owner_email, owner_phone,
              pan, aadhaar_last4, gstin, address_line1, address_line2, city,
              state, postal_code, country, use_case, provider_end_user_id,
              rejection_reason, verified_at, created_at
         FROM kyc_submissions
        WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider],
    );
    res.json({ data: r.rows[0] || null });
  } catch (err) { next(err); }
});

const kycBuySchema = z.object({
  provider: z.enum(['twilio', 'exotel', 'plivo']).default('plivo'),
  number: z.string().min(5),
  capabilities: z.array(z.enum(['voice', 'sms'])).default(['voice']),
  kyc: z.object({
    business_name: z.string(),
    owner_name: z.string(),
    owner_email: z.string().optional(),
    owner_phone: z.string().optional(),
    pan: z.string().optional(),
    aadhaar: z.string().optional(),
    gstin: z.string().optional(),
    address_line1: z.string(),
    address_line2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    postal_code: z.string(),
    country: z.string().default('IN'),
    use_case: z.string(),
  }),
});

// POST /phone-numbers/buy-with-kyc — full KYC-gated buy:
//   1. validate KYC payload format (PAN, Aadhaar Verhoeff, GSTIN, address)
//   2. reuse a previously-verified KYC for this tenant+provider, or register
//      a fresh Plivo End User (the carrier-side compliance anchor)
//   3. rent the number with end_user_id attached
//   4. persist phone_numbers row + return it
phoneNumberRouter.post('/buy-with-kyc', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = kycBuySchema.parse(req.body);

    if (parsed.provider !== 'plivo') {
      res.status(400).json({
        error: 'Unsupported',
        message: `KYC-gated buy is wired for Plivo only right now. ${parsed.provider} numbers go through their own console.`,
      });
      return;
    }

    const v = validateKyc(parsed.kyc, { country: parsed.kyc.country });
    if (!v.ok) {
      res.status(422).json({
        error: 'KYC Validation Failed',
        message: 'Some KYC fields are invalid — please correct them and try again.',
        details: v.errors,
      });
      return;
    }

    // Avoid double-rent
    const existing = await pool.query(
      `SELECT id FROM phone_numbers WHERE phone_number = $1 OR phone_number = $2`,
      [parsed.number, '+' + parsed.number.replace(/^\+/, '')],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Already Owned', message: 'This number is already in your account.' });
      return;
    }

    // Reuse verified KYC if present; otherwise register fresh
    const prior = await pool.query(
      `SELECT id, status, provider_end_user_id FROM kyc_submissions
        WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, parsed.provider],
    );
    let endUserId: string | null = prior.rows[0]?.provider_end_user_id || null;
    let kycId: string | null = prior.rows[0]?.id || null;

    if (!endUserId) {
      try {
        const ownerParts = parsed.kyc.owner_name.trim().split(/\s+/);
        const firstName = ownerParts[0] || parsed.kyc.business_name;
        const lastName = ownerParts.slice(1).join(' ');
        const r = await plivoProvider.registerEndUser({
          name: firstName,
          last_name: lastName,
          end_user_type: 'business',
        });
        endUserId = r.endUserId;
      } catch (err: any) {
        // Persist the failed attempt so the UI can show the carrier's reason
        await pool.query(
          `INSERT INTO kyc_submissions
             (tenant_id, provider, status, business_name, owner_name, owner_email, owner_phone,
              pan, aadhaar_last4, gstin, address_line1, address_line2, city, state, postal_code,
              country, use_case, rejection_reason)
           VALUES ($1,$2,'rejected',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             status='rejected',
             rejection_reason=EXCLUDED.rejection_reason,
             updated_at=NOW()`,
          [
            tenantId, parsed.provider, parsed.kyc.business_name, parsed.kyc.owner_name,
            parsed.kyc.owner_email || null, parsed.kyc.owner_phone || null,
            parsed.kyc.pan?.toUpperCase() || null, aadhaarLast4(parsed.kyc.aadhaar),
            parsed.kyc.gstin?.toUpperCase() || null, parsed.kyc.address_line1,
            parsed.kyc.address_line2 || null, parsed.kyc.city, parsed.kyc.state,
            parsed.kyc.postal_code, parsed.kyc.country.toUpperCase(), parsed.kyc.use_case,
            err.message || 'End-user registration failed',
          ],
        );
        res.status(502).json({
          error: 'KYC Carrier Rejection',
          message: `Carrier could not register your KYC: ${err.message}. Verify your Plivo account itself is KYC-cleared at console.plivo.com first.`,
        });
        return;
      }
    }

    // Upsert KYC submission as verified before the buy attempt
    const upsert = await pool.query(
      `INSERT INTO kyc_submissions
         (tenant_id, provider, status, business_name, owner_name, owner_email, owner_phone,
          pan, aadhaar_last4, gstin, address_line1, address_line2, city, state, postal_code,
          country, use_case, provider_end_user_id, verified_at)
       VALUES ($1,$2,'verified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status='verified',
         business_name=EXCLUDED.business_name,
         owner_name=EXCLUDED.owner_name,
         owner_email=EXCLUDED.owner_email,
         owner_phone=EXCLUDED.owner_phone,
         pan=EXCLUDED.pan,
         aadhaar_last4=EXCLUDED.aadhaar_last4,
         gstin=EXCLUDED.gstin,
         address_line1=EXCLUDED.address_line1,
         address_line2=EXCLUDED.address_line2,
         city=EXCLUDED.city,
         state=EXCLUDED.state,
         postal_code=EXCLUDED.postal_code,
         country=EXCLUDED.country,
         use_case=EXCLUDED.use_case,
         provider_end_user_id=EXCLUDED.provider_end_user_id,
         rejection_reason=NULL,
         verified_at=NOW(),
         updated_at=NOW()
       RETURNING id`,
      [
        tenantId, parsed.provider, parsed.kyc.business_name, parsed.kyc.owner_name,
        parsed.kyc.owner_email || null, parsed.kyc.owner_phone || null,
        parsed.kyc.pan?.toUpperCase() || null, aadhaarLast4(parsed.kyc.aadhaar),
        parsed.kyc.gstin?.toUpperCase() || null, parsed.kyc.address_line1,
        parsed.kyc.address_line2 || null, parsed.kyc.city, parsed.kyc.state,
        parsed.kyc.postal_code, parsed.kyc.country.toUpperCase(), parsed.kyc.use_case,
        endUserId,
      ],
    );
    kycId = upsert.rows[0].id;

    // Now rent the number with the end-user attached
    let purchased;
    try {
      purchased = await plivoProvider.provisionNumberWithEndUser({
        number: parsed.number,
        endUserId,
        capabilities: parsed.capabilities,
      });
    } catch (err: any) {
      const lower = (err.message || '').toLowerCase();
      const isCompliance = lower.includes('complian') || lower.includes('kyc') ||
        lower.includes('end user') || lower.includes('document');
      res.status(isCompliance ? 422 : 502).json({
        error: isCompliance ? 'Compliance Required' : 'Provider Error',
        message: isCompliance
          ? `Plivo compliance check is incomplete: ${err.message}. Submit DOT/TRAI documents at console.plivo.com → Compliance to clear it.`
          : err.message,
        kyc_id: kycId,
      });
      return;
    }

    // Wallet debit — same pattern as /buy. Roll back at carrier on insufficient balance.
    const debit = await debitForRental({
      authHeader: req.headers.authorization,
      tenantId,
      number: purchased.number,
      provider: parsed.provider,
    });
    if (!debit.ok && debit.status === 402) {
      try { await plivoProvider.releaseNumber(purchased.providerNumberId); } catch { /* swallow */ }
      res.status(402).json({
        error: 'Insufficient Wallet Balance',
        message: debit.body?.message || 'Top up the wallet and retry the purchase.',
        required: debit.body?.required,
        available: debit.body?.available,
        kyc_id: kycId,
      });
      return;
    }

    const inserted = await pool.query(
      `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [
        tenantId,
        purchased.number,
        parsed.provider,
        purchased.providerNumberId,
        JSON.stringify({
          voice: parsed.capabilities.includes('voice'),
          sms: parsed.capabilities.includes('sms'),
        }),
      ],
    );

    res.status(201).json({
      ...inserted.rows[0],
      kyc: { id: kycId, status: 'verified', provider_end_user_id: endUserId },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// POST /phone-numbers/import — register a number the tenant ALREADY owns at
// the carrier (Plivo / Twilio / Exotel) without going through provisioning.
// Required for Exotel (no catalog API) and useful for numbers purchased
// directly via Plivo/Twilio dashboards. Just inserts a row in our DB.
phoneNumberRouter.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = importSchema.parse(req.body);

    const normalized = parsed.phone_number.trim().startsWith('+')
      ? parsed.phone_number.trim()
      : '+' + parsed.phone_number.trim().replace(/^\+/, '');

    const dup = await pool.query(
      `SELECT id FROM phone_numbers WHERE phone_number = $1`,
      [normalized],
    );
    if (dup.rows.length > 0) {
      res.status(409).json({ error: 'Already Imported', message: 'This number is already in your account.' });
      return;
    }

    // ─── Carrier-side credential validation ───
    // If the user supplied per-import credentials, verify them with the
    // carrier BEFORE inserting the row. Returns 422 on failure with the
    // exact carrier error so the UI shows actionable feedback.
    let carrierMeta: Record<string, any> = {};
    if (parsed.provider === 'twilio' && parsed.twilio_account_sid && parsed.twilio_auth_token) {
      const auth = Buffer.from(`${parsed.twilio_account_sid}:${parsed.twilio_auth_token}`).toString('base64');
      try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${parsed.twilio_account_sid}.json`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!r.ok) {
          res.status(422).json({
            error: 'Twilio Credentials Invalid',
            message: `Twilio rejected those credentials (${r.status}). Verify the Account SID and Auth Token.`,
          });
          return;
        }
        // Also confirm the number actually exists on this Twilio account.
        const numCleaned = encodeURIComponent(normalized);
        const own = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${parsed.twilio_account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${numCleaned}`,
          { headers: { Authorization: `Basic ${auth}` } },
        );
        if (own.ok) {
          const j: any = await own.json();
          const list = j.incoming_phone_numbers || [];
          if (list.length === 0) {
            res.status(422).json({
              error: 'Number Not On Twilio Account',
              message: `${normalized} doesn't exist on Twilio account ${parsed.twilio_account_sid}. Buy it at console.twilio.com first, or use the correct Account SID.`,
            });
            return;
          }
          carrierMeta.twilio_number_sid = list[0].sid;
          carrierMeta.twilio_voice_url = list[0].voice_url;
          carrierMeta.twilio_validated_at = new Date().toISOString();
        }
      } catch (err: any) {
        res.status(502).json({ error: 'Twilio Unreachable', message: err.message });
        return;
      }
    }
    if (parsed.provider === 'exotel' && parsed.exotel_api_key && parsed.exotel_api_token && parsed.exotel_account_sid) {
      const subdomain = (parsed.exotel_subdomain || 'api.exotel.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const auth = Buffer.from(`${parsed.exotel_api_key}:${parsed.exotel_api_token}`).toString('base64');
      try {
        // Exotel doesn't have a clean account-info endpoint; hit /Calls.json
        // with limit=1 — returns 200 if creds are valid even with empty list.
        const r = await fetch(`https://${subdomain}/v1/Accounts/${parsed.exotel_account_sid}/Calls.json?PageSize=1`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!r.ok) {
          res.status(422).json({
            error: 'Exotel Credentials Invalid',
            message: `Exotel returned ${r.status}. Check API Key, Token, Subdomain, and Account SID at my.exotel.com → Settings → API.`,
          });
          return;
        }
        carrierMeta.exotel_validated_at = new Date().toISOString();
        carrierMeta.exotel_subdomain = subdomain;
        carrierMeta.exotel_account_sid = parsed.exotel_account_sid;
      } catch (err: any) {
        res.status(502).json({ error: 'Exotel Unreachable', message: err.message });
        return;
      }
    }
    if (parsed.sip_uri) {
      // SIP creds aren't carrier-validated (no universal SIP REGISTER probe
      // server-side); we just stash them for later trunk routing.
      carrierMeta.sip_uri = parsed.sip_uri;
      if (parsed.sip_username) carrierMeta.sip_username = parsed.sip_username;
      // NOTE: store password as-is for now; integration-level encryption is
      // applied by `INTEGRATION_ENCRYPTION_KEY` flow in identity-service.
      if (parsed.sip_password) carrierMeta.sip_password_present = true;
    }

    const inserted = await pool.query(
      `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [
        tenantId,
        normalized,
        parsed.provider,
        parsed.provider_sid || carrierMeta.twilio_number_sid || null,
        JSON.stringify({
          voice: parsed.capabilities.includes('voice'),
          sms: parsed.capabilities.includes('sms'),
          carrier_meta: carrierMeta,
        }),
      ],
    );

    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// POST /phone-numbers/provision  (legacy — Twilio/Exotel auto-pick)
phoneNumberRouter.post('/provision', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const parsed = provisionSchema.parse(req.body);

    const provider = parsed.provider === 'plivo' ? plivoProvider
      : parsed.provider === 'exotel' ? exotelProvider
      : twilioProvider;

    let provisionedNumber;
    try {
      provisionedNumber = await provider.provisionNumber({
        country: parsed.country,
        capabilities: parsed.capabilities,
        areaCode: parsed.area_code,
      });
    } catch (err: any) {
      res.status(502).json({
        error: 'Provider Error',
        message: `Failed to provision number via ${parsed.provider}: ${err.message}`,
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [
        tenantId,
        provisionedNumber.number,
        parsed.provider,
        provisionedNumber.providerNumberId,
        JSON.stringify({ voice: parsed.capabilities.includes('voice'), sms: parsed.capabilities.includes('sms') }),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// GET /phone-numbers/:id/carrier-status — live compliance/active state from the carrier.
// For Plivo: hits GET /v1/Account/<id>/Number/<number>/. For sandbox/exotel/twilio
// without a status API, returns a synthesized response so the UI can render uniformly.
phoneNumberRouter.get('/:id/carrier-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const r = await pool.query(
      'SELECT id, phone_number, provider, provider_sid FROM phone_numbers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }
    const phone = r.rows[0];

    if (phone.provider === 'sandbox') {
      res.json({
        carrier_active: true,
        compliance_status: 'sandbox',
        message: 'Sandbox number — no carrier review required, in-app testing only.',
      });
      return;
    }

    if (phone.provider === 'plivo') {
      const authId = process.env.PLIVO_AUTH_ID;
      const authToken = process.env.PLIVO_AUTH_TOKEN;
      if (!authId || !authToken) {
        res.json({ carrier_active: null, compliance_status: 'unknown', message: 'Plivo credentials not configured.' });
        return;
      }
      const num = String(phone.phone_number).replace(/[^\d]/g, '');
      const url = `https://api.plivo.com/v1/Account/${authId}/Number/${num}/`;
      const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');
      try {
        const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        if (!resp.ok) {
          res.json({
            carrier_active: null,
            compliance_status: resp.status === 404 ? 'not_found' : 'error',
            message: `Plivo returned ${resp.status}.`,
          });
          return;
        }
        const data: any = await resp.json();
        res.json({
          carrier_active: data.active === true,
          compliance_status: data.active === true ? 'active' : 'pending',
          renewal_date: data.renewal_date ?? null,
          monthly_rental_rate: data.monthly_rental_rate ?? null,
          region: data.region ?? null,
          voice_enabled: data.voice_enabled ?? null,
          sms_enabled: data.sms_enabled ?? null,
          message: data.active === true
            ? 'Number is active at the carrier and ready for live calls.'
            : 'Number rented but carrier compliance is pending. Upload PAN/Aadhaar/address proof at console.plivo.com → Compliance to activate.',
        });
        return;
      } catch (err: any) {
        res.json({ carrier_active: null, compliance_status: 'unreachable', message: `Could not reach Plivo: ${err.message}` });
        return;
      }
    }

    // Twilio / Exotel: we don't have a unified status fetch — assume active if it's in our DB.
    res.json({
      carrier_active: true,
      compliance_status: 'unknown',
      message: `Live compliance check not implemented for provider "${phone.provider}".`,
    });
  } catch (err) { next(err); }
});

// PUT /phone-numbers/:id
phoneNumberRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const parsed = updatePhoneNumberSchema.parse(req.body);

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (parsed.agent_id !== undefined) {
      setClauses.push(`agent_id = $${paramIdx}`);
      values.push(parsed.agent_id);
      paramIdx++;
    }
    if (parsed.is_active !== undefined) {
      setClauses.push(`is_active = $${paramIdx}`);
      values.push(parsed.is_active);
      paramIdx++;
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    values.push(id, tenantId);

    const result = await pool.query(
      `UPDATE phone_numbers SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// DELETE /phone-numbers/:id
phoneNumberRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    // Get the phone number record first
    const phoneResult = await pool.query(
      'SELECT * FROM phone_numbers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (phoneResult.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }

    const phone = phoneResult.rows[0];

    // Release from provider
    if (phone.provider_sid) {
      const provider = phone.provider === 'exotel' ? exotelProvider : twilioProvider;
      try {
        await provider.releaseNumber(phone.provider_sid);
      } catch (err) {
        // Log but continue with DB deletion
      }
    }

    await pool.query(
      'DELETE FROM phone_numbers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
