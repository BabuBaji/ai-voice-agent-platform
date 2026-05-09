import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { twilioProvider } from '../providers/twilio.provider';
import { exotelProvider } from '../providers/exotel.provider';
import { plivoProvider } from '../providers/plivo.provider';
import { resolveDeployedAgent } from '../services/deployedAgentResolver';

export const callRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

const initiateCallSchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1),
  agent_id: z.string().uuid(),
  provider: z.enum(['twilio', 'exotel', 'plivo']).default('twilio'),
  metadata: z.any().default({}),
});

// POST /calls/initiate
callRouter.post('/initiate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const parsed = initiateCallSchema.parse(req.body);

    // Resolve `from` number. Order of preference:
    //  1) Explicit `from` in the request
    //  2) The agent's DEPLOYED number (active + status=deployed)
    //  3) Any tenant-wide DEPLOYED, non-sandbox number (lets a single carrier
    //     number serve all agents — matches how the user said "use this
    //     number for all calls now")
    //  4) TWILIO_PHONE_NUMBER env var, but only if a TWILIO row exists in
    //     phone_numbers (avoid the old "default to Plivo when from is empty"
    //     trap that produced cross-carrier 400s)
    let fromNumber = parsed.from;
    let fromRow: any = null;
    if (!fromNumber) {
      // Filter out sandbox provider — sandbox numbers are synthetic, can't
      // place real PSTN calls. They're for the in-browser web-call widget.
      // If an agent only has a sandbox number attached, fall through to the
      // tenant-wide fallback so we use a real carrier number.
      const phoneRow = await pool.query(
        `SELECT phone_number, provider, provider_sid FROM phone_numbers
         WHERE tenant_id = $1 AND agent_id = $2 AND is_active = TRUE
           AND provider IN ('twilio','plivo','exotel')
         ORDER BY (deployment_status = 'deployed') DESC, deployed_at DESC NULLS LAST, created_at ASC
         LIMIT 1`,
        [tenantId, parsed.agent_id]
      );
      if (phoneRow.rows.length > 0) {
        fromNumber = phoneRow.rows[0].phone_number;
        fromRow = phoneRow.rows[0];
      }
    } else {
      // User passed `from` explicitly — find its row so we know the carrier.
      const ownerRow = await pool.query(
        `SELECT phone_number, provider, provider_sid FROM phone_numbers
         WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
        [tenantId, fromNumber],
      );
      if (ownerRow.rows.length > 0) fromRow = ownerRow.rows[0];
    }
    // Tenant-wide fallback: any deployed real-carrier number this tenant owns.
    if (!fromNumber) {
      const tenantWide = await pool.query(
        `SELECT phone_number, provider, provider_sid FROM phone_numbers
         WHERE tenant_id = $1 AND is_active = TRUE AND deployment_status = 'deployed'
           AND provider IN ('twilio','plivo','exotel')
         ORDER BY deployed_at DESC NULLS LAST, created_at ASC
         LIMIT 1`,
        [tenantId]
      );
      if (tenantWide.rows.length > 0) {
        fromNumber = tenantWide.rows[0].phone_number;
        fromRow = tenantWide.rows[0];
      }
    }
    // Last resort: env var, but require a phone_numbers row to exist for it
    // (so the carrier we route through always has a real number we own).
    if (!fromNumber && process.env.TWILIO_PHONE_NUMBER) {
      const envRow = await pool.query(
        `SELECT phone_number, provider, provider_sid FROM phone_numbers
         WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
        [tenantId, process.env.TWILIO_PHONE_NUMBER],
      );
      if (envRow.rows.length > 0) {
        fromNumber = envRow.rows[0].phone_number;
        fromRow = envRow.rows[0];
      }
    }
    if (!fromNumber) {
      res.status(400).json({
        error: 'No From Number',
        message: 'No active phone number is configured for this tenant. Buy or import a number in Settings → Phone Numbers and click Deploy.',
      });
      return;
    }

    // Authoritative provider is the carrier the FROM number actually belongs to,
    // not whatever the client picked. Caller's `provider` is treated as a hint
    // and only used as a tiebreaker when the number isn't in our DB. This stops
    // the "from number 12184147809 is not a Plivo Number" cross-carrier failure.
    const resolvedProviderName: 'plivo' | 'twilio' | 'exotel' | 'sandbox' =
      (fromRow?.provider as any) || parsed.provider;

    if (resolvedProviderName === 'sandbox') {
      res.status(400).json({
        error: 'Sandbox Number',
        message: 'Sandbox numbers cannot place real PSTN calls. Use the in-app Web Call from the agent page, or attach a real carrier number first.',
      });
      return;
    }

    if (resolvedProviderName !== parsed.provider) {
      // Log the override so the UI's mismatched picker doesn't get blamed for
      // a carrier rejection later.
      // eslint-disable-next-line no-console
      console.log(`[calls.initiate] provider override: client sent '${parsed.provider}', using '${resolvedProviderName}' (number ${fromNumber} belongs to ${resolvedProviderName})`);
    }

    const provider =
      resolvedProviderName === 'exotel' ? exotelProvider
      : resolvedProviderName === 'plivo' ? plivoProvider
      : twilioProvider;

    // Look up the agent's call_config so we can pass per-call options like
    // voicemail/AMD detection through to the carrier. Also check the deploy
    // gate. We prefer the deployed snapshot (frozen at /deploy time) so an
    // in-progress edit can't kick a live outbound call into a half-broken
    // state. Falls back to the live agent fetch when no snapshot exists.
    let voicemailDetection = false;
    try {
      // Try to find the number we're dialling FROM so we can key the snapshot lookup.
      const fromRow = await pool.query(
        `SELECT id FROM phone_numbers
          WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
        [tenantId, fromNumber],
      );
      const numberId = fromRow.rows[0]?.id || null;
      const agent = await resolveDeployedAgent(pool, {
        agentId: parsed.agent_id,
        tenantId,
        numberId,
      });
      if (agent) {
        const status = String(agent?.status || '').toUpperCase();
        // Snapshot path returns status='PUBLISHED' so this gate only triggers
        // for un-deployed agents whose live row says DRAFT/ARCHIVED.
        if (process.env.BYPASS_PUBLISH_GATE !== 'true' && (status === 'DRAFT' || status === 'ARCHIVED')) {
          res.status(400).json({
            error: 'Agent not deployed',
            message: 'Click Deploy on the agent to enable outbound calls.',
            agent_status: status,
          });
          return;
        }
        voicemailDetection = !!agent?.call_config?.voicemail_detection?.enabled;
      }
    } catch {
      /* non-fatal — fall back to defaults */
    }

    // Initiate call via provider, with optional failover to a backup carrier
    // when call_routes.failover.failover_provider is configured for the FROM
    // number. We try the primary; on retryable carrier errors (402, 5xx, 429)
    // we re-resolve a fresh from-number on the failover carrier and retry.
    interface AttemptOutcome { ok: boolean; result?: any; err?: any; provider: string; from: string; }
    const attempts: AttemptOutcome[] = [];

    async function attempt(p: 'plivo' | 'twilio' | 'exotel', fromNum: string): Promise<AttemptOutcome> {
      const prov = p === 'exotel' ? exotelProvider : p === 'plivo' ? plivoProvider : twilioProvider;
      try {
        const r = await prov.initiateCall({
          from: fromNum,
          to: parsed.to,
          agentId: parsed.agent_id,
          tenantId,
          voicemailDetection,
        });
        return { ok: true, result: r, provider: p, from: fromNum };
      } catch (err) {
        return { ok: false, err, provider: p, from: fromNum };
      }
    }

    function isRetryable(errMsg: string): boolean {
      const m = errMsg.match(/\b(\d{3})\b/);
      const code = m ? parseInt(m[1], 10) : 0;
      return code === 402 || code === 429 || (code >= 500 && code < 600);
    }

    // Primary attempt
    let final = await attempt(resolvedProviderName as any, fromNumber);
    attempts.push(final);

    // Try failover if primary failed retryably
    if (!final.ok) {
      const errMsg = String(final.err?.message || final.err || '');
      if (isRetryable(errMsg)) {
        try {
          // Look up failover_provider on the FROM number's call_routes (if any).
          const numIdRow = await pool.query(
            `SELECT id FROM phone_numbers WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
            [tenantId, fromNumber],
          );
          const fromId = numIdRow.rows[0]?.id || null;
          let failoverProvider: string | null = null;
          if (fromId) {
            const cfg = await pool.query(
              `SELECT route_config FROM call_routes WHERE tenant_id = $1 AND number_id = $2`,
              [tenantId, fromId],
            );
            failoverProvider = cfg.rows[0]?.route_config?.failover?.failover_provider || null;
          }
          if (failoverProvider && failoverProvider !== resolvedProviderName && ['plivo', 'twilio', 'exotel'].includes(failoverProvider)) {
            // Find a tenant-deployed number on the failover carrier to use as new from.
            const altRow = await pool.query(
              `SELECT phone_number FROM phone_numbers
               WHERE tenant_id = $1 AND provider = $2 AND is_active = TRUE
               ORDER BY (deployment_status='deployed') DESC, deployed_at DESC NULLS LAST LIMIT 1`,
              [tenantId, failoverProvider],
            );
            const altFrom = altRow.rows[0]?.phone_number;
            if (altFrom) {
              // eslint-disable-next-line no-console
              console.log(`[calls.initiate] failover: '${resolvedProviderName}' → '${failoverProvider}' (from ${fromNumber} → ${altFrom}). primary error: ${errMsg.slice(0, 120)}`);
              const second = await attempt(failoverProvider as any, altFrom);
              attempts.push(second);
              if (second.ok) final = second;
            }
          }
        } catch (e) {
          // Failover lookup itself failed; keep the primary error.
        }
      }
    }

    if (!final.ok) {
      const msg = String(final.err?.message || final.err || '');
      const m = msg.match(/\b(\d{3})\b/);
      const carrierStatus = m ? parseInt(m[1], 10) : 0;
      const lower = msg.toLowerCase();
      let outStatus = 502;
      let code = 'Provider Error';
      let friendly = msg;
      if (carrierStatus === 402 || lower.includes('insufficient balance') || lower.includes('insufficient funds')) {
        outStatus = 402;
        code = 'Insufficient Balance';
        friendly = `Your ${final.provider} account is out of credit — top it up at the carrier console and try again.`;
      } else if (carrierStatus === 401 || carrierStatus === 403 || lower.includes('unauthorized') || lower.includes('forbidden')) {
        outStatus = 401;
        code = 'Provider Auth Failed';
        friendly = `${final.provider} rejected the credentials. Verify the API key in Settings → Integrations.`;
      } else if (lower.includes('kyc') || lower.includes('compliance') || lower.includes('end user')) {
        outStatus = 422;
        code = 'Carrier Compliance Required';
      } else if (carrierStatus >= 400 && carrierStatus < 500) {
        outStatus = carrierStatus;
      }
      res.status(outStatus).json({
        error: code,
        message: friendly,
        provider: final.provider,
        attempts: attempts.map((a) => ({ provider: a.provider, ok: a.ok, error: a.ok ? null : String(a.err?.message || a.err) })),
      });
      return;
    }

    // Create call record in DB. provider/from reflect the carrier that
    // actually placed the call (not the original primary if failover fired).
    const callResult = final.result;
    const result = await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, direction, status, caller_number, called_number, provider, provider_call_sid, metadata)
       VALUES ($1, $2, 'OUTBOUND', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        parsed.agent_id,
        callResult.status === 'queued' ? 'RINGING' : callResult.status.toUpperCase(),
        final.from,
        parsed.to,
        final.provider,
        callResult.providerCallId,
        JSON.stringify({
          ...parsed.metadata,
          failover_used: attempts.length > 1,
          attempts: attempts.length,
        }),
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

// ─────────────────────────────────────────────────────────────────────────
// POST /calls/verify-destination — start Twilio's caller-ID verification flow
// for a destination number on a trial account. Twilio places a call to the
// number with a 6-digit validation_code; the caller enters it via DTMF, and
// once accepted the number is added to OutgoingCallerIds (verified list) and
// outbound dials to it stop returning the "unverified destination" error.
// ─────────────────────────────────────────────────────────────────────────
const verifyDestSchema = z.object({
  phone_number: z.string().min(5),
});

callRouter.post('/verify-destination', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = verifyDestSchema.parse(req.body);

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) {
      res.status(400).json({
        error: 'Twilio Not Configured',
        message: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN must be set on the server.',
      });
      return;
    }

    const e164 = parsed.phone_number.startsWith('+')
      ? parsed.phone_number
      : '+' + parsed.phone_number.replace(/^\+/, '');
    const auth = Buffer.from(`${sid}:${tok}`).toString('base64');

    // Check if already verified — saves the user from sitting through another
    // call from Twilio for a number already on their verified list.
    try {
      const listResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(e164)}`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (listResp.ok) {
        const listJson: any = await listResp.json();
        if ((listJson.outgoing_caller_ids || []).length > 0) {
          res.json({
            already_verified: true,
            phone_number: e164,
            message: `${e164} is already verified on your Twilio account. Try the call again.`,
          });
          return;
        }
      }
    } catch {
      // Non-fatal — fall through to the verification request below.
    }

    // Kick off verification — Twilio will place a call with a 6-digit code.
    const body = new URLSearchParams();
    body.set('PhoneNumber', e164);
    body.set('FriendlyName', `Test caller ${e164}`);

    let resp: Response | any;
    try {
      resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/OutgoingCallerIds.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (err: any) {
      res.status(502).json({ error: 'Twilio Unreachable', message: err.message });
      return;
    }

    if (!resp.ok) {
      const text = await resp.text();
      res.status(resp.status === 401 || resp.status === 403 ? resp.status : 502).json({
        error: 'Twilio Validation Failed',
        message: `Twilio returned ${resp.status}: ${text.slice(0, 300)}`,
      });
      return;
    }

    const data: any = await resp.json();
    res.json({
      already_verified: false,
      phone_number: e164,
      validation_code: data.validation_code,
      friendly_name: data.friendly_name,
      message: `Twilio is now calling ${e164}. Answer the phone, and when prompted enter the 6-digit code shown above on the keypad. After that, retry your test call.`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// GET /calls
callRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const agentId = req.query.agent_id as string | undefined;
    const status = req.query.status as string | undefined;
    const direction = req.query.direction as string | undefined;
    const provider = req.query.provider as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM calls WHERE tenant_id = $1';
    let countQuery = 'SELECT COUNT(*) FROM calls WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    const countParams: any[] = [tenantId];
    let paramIdx = 2;

    if (agentId) {
      query += ` AND agent_id = $${paramIdx}`;
      countQuery += ` AND agent_id = $${paramIdx}`;
      params.push(agentId);
      countParams.push(agentId);
      paramIdx++;
    }
    if (status) {
      query += ` AND status = $${paramIdx}`;
      countQuery += ` AND status = $${paramIdx}`;
      params.push(status);
      countParams.push(status);
      paramIdx++;
    }
    if (direction) {
      query += ` AND direction = $${paramIdx}`;
      countQuery += ` AND direction = $${paramIdx}`;
      params.push(direction);
      countParams.push(direction);
      paramIdx++;
    }
    if (provider) {
      query += ` AND provider = $${paramIdx}`;
      countQuery += ` AND provider = $${paramIdx}`;
      params.push(provider);
      countParams.push(provider);
      paramIdx++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    res.json({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      pageSize: limit,
    });
  } catch (err) {
    next(err);
  }
});

// GET /calls/:id
callRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM calls WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Call not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /calls/:id/end
callRouter.post('/:id/end', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    // Get call record
    const callResult = await pool.query(
      'SELECT * FROM calls WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (callResult.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Call not found' });
      return;
    }

    const call = callResult.rows[0];

    // End call via provider
    if (call.provider_call_sid) {
      const provider =
        call.provider === 'exotel' ? exotelProvider
        : call.provider === 'plivo' ? plivoProvider
        : twilioProvider;
      try {
        await provider.endCall(call.provider_call_sid);
      } catch (err) {
        // Log but don't fail - provider may already have ended the call
      }
    }

    // Calculate duration
    const startedAt = new Date(call.started_at);
    const endedAt = new Date();
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);

    // Update call record
    const result = await pool.query(
      `UPDATE calls SET status = 'COMPLETED', ended_at = NOW(), duration_seconds = $1, outcome = $2
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [durationSeconds, req.body.outcome || 'COMPLETED', id, tenantId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /calls/:id/transfer
callRouter.post('/:id/transfer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const { transfer_to, transfer_type } = req.body;

    if (!transfer_to) {
      res.status(400).json({ error: 'Bad Request', message: 'transfer_to is required' });
      return;
    }

    const callResult = await pool.query(
      'SELECT * FROM calls WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (callResult.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Call not found' });
      return;
    }

    const call = callResult.rows[0];

    // Transfer via provider
    if (call.provider_call_sid) {
      const provider =
        call.provider === 'exotel' ? exotelProvider
        : call.provider === 'plivo' ? plivoProvider
        : twilioProvider;
      await provider.transferCall({
        callId: call.provider_call_sid,
        transferTo: transfer_to,
        transferType: transfer_type || 'warm',
      });
    }

    // Update call status
    const result = await pool.query(
      `UPDATE calls SET status = 'TRANSFERRED', outcome = 'TRANSFERRED',
       metadata = metadata || $1
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [JSON.stringify({ transferred_to: transfer_to, transfer_type: transfer_type || 'warm' }), id, tenantId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
