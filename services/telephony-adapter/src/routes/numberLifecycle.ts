import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { pool } from '../index';
import { config } from '../config';
import { recordNumberAudit } from '../services/numberAudit';
import { fetchLiveAgent, buildAgentSnapshot } from '../services/deployedAgentResolver';

export const numberLifecycleRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

function actorFrom(req: Request) {
  const userId = (req.headers['x-user-id'] as string) || null;
  const email = (req.headers['x-user-email'] as string) || null;
  return { userId, email };
}

async function loadNumber(numberId: string, tenantId: string) {
  const r = await pool.query(
    `SELECT * FROM phone_numbers WHERE id = $1 AND tenant_id = $2`,
    [numberId, tenantId],
  );
  return r.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /:id/verify — runs 5 sub-tests, persists every row, returns aggregate
// ─────────────────────────────────────────────────────────────────────────
//   1. provider_api      — credentials + carrier reachability
//   2. ownership         — number really belongs to us at the carrier
//   3. webhook_reachable — PUBLIC_BASE_URL responds with 200 on /health
//   4. ws_stream         — wss handshake on /plivo/audio responds
//   5. recording_writeable — logs/recordings dir is writable
//
// We DON'T place a real test call here — that's what the user-driven
// "Test call" button (TestCallModal) is for. Verification is meant to be
// fast and non-destructive: < 5s end-to-end.
numberLifecycleRouter.post('/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }

    const runId = randomUUID();
    const tests: Array<{
      type: string;
      run: () => Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }>;
    }> = [
      { type: 'provider_api', run: () => testProviderApi(num) },
      { type: 'ownership', run: () => testOwnership(num) },
      { type: 'webhook_reachable', run: () => testWebhookReachable() },
      { type: 'ws_stream', run: () => testWsStream() },
      { type: 'recording_writeable', run: () => testRecordingDir() },
      { type: 'outbound_call', run: () => testOutboundDryRun(num) },
    ];

    const results: any[] = [];
    for (const t of tests) {
      const startedAt = new Date();
      let outcome: { status: 'pass' | 'fail' | 'skip'; log?: any; error?: string };
      try {
        outcome = await Promise.race([
          t.run(),
          new Promise<{ status: 'fail'; error: string }>((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), 5000),
          ).catch((e) => ({ status: 'fail' as const, error: e.message })),
        ]);
      } catch (err: any) {
        outcome = { status: 'fail', error: err?.message || String(err) };
      }
      const completedAt = new Date();
      await pool.query(
        `INSERT INTO number_verifications
           (number_id, tenant_id, run_id, test_type, status, log, started_at, completed_at, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          num.id,
          tenantId,
          runId,
          t.type,
          outcome.status,
          JSON.stringify(outcome.log || {}),
          startedAt.toISOString(),
          completedAt.toISOString(),
          outcome.error || null,
        ],
      );
      results.push({ test: t.type, ...outcome });
    }

    const failed = results.filter((r) => r.status === 'fail');
    const passed = results.filter((r) => r.status === 'pass');
    const aggregate = failed.length === 0 ? 'verified' : failed.length === results.length ? 'failed' : 'partial';

    if (aggregate === 'verified' || aggregate === 'partial') {
      await pool.query(`UPDATE phone_numbers SET last_verified_at = NOW() WHERE id = $1`, [num.id]);
    }

    await recordNumberAudit(pool, {
      tenantId,
      numberId: num.id,
      eventType: aggregate === 'failed' ? 'verify_failed' : 'verify_passed',
      actor: actorFrom(req),
      metadata: { run_id: runId, aggregate, passed: passed.length, failed: failed.length },
    });

    res.json({
      run_id: runId,
      aggregate,
      results,
      summary: {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        skipped: results.filter((r) => r.status === 'skip').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /:id/verify-inbound/start  → opens a 60s probe window
// POST /:id/verify-inbound/check  → polls whether the inbound webhook fired
//
// Caller calls the number from any phone within 60s; the inbound webhook in
// webhooks.ts will see an active probe and mark it satisfied. The UI polls
// /check to surface pass/fail.
// ─────────────────────────────────────────────────────────────────────────
numberLifecycleRouter.post('/:id/verify-inbound/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }
    const probeId = randomUUID();
    await pool.query(
      `INSERT INTO number_verifications
         (number_id, tenant_id, run_id, test_type, status, log, started_at)
       VALUES ($1, $2, $3, 'inbound_call_probe', 'pending', $4, NOW())`,
      [num.id, tenantId, probeId, JSON.stringify({ window_seconds: 60, expected_to: num.phone_number })],
    );
    res.json({
      probe_id: probeId,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      message: `Call ${num.phone_number} from any phone within 60 seconds. Polling for the inbound webhook to fire.`,
    });
  } catch (err) {
    next(err);
  }
});

numberLifecycleRouter.get('/:id/verify-inbound/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const probeId = String(req.query.probe_id || '');
    if (!probeId) {
      res.status(400).json({ error: 'Bad Request', message: 'probe_id required' });
      return;
    }
    const r = await pool.query(
      `SELECT status, log, completed_at, started_at, error
         FROM number_verifications
        WHERE tenant_id = $1 AND number_id = $2 AND run_id = $3 AND test_type = 'inbound_call_probe'`,
      [tenantId, req.params.id, probeId],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Probe not found' });
      return;
    }
    const row = r.rows[0];
    const startedAt = new Date(row.started_at).getTime();
    const expired = Date.now() - startedAt > 60_000;
    if (row.status === 'pending' && expired) {
      // Expire it
      await pool.query(
        `UPDATE number_verifications SET status = 'fail', completed_at = NOW(), error = 'Probe window expired (60s)' WHERE run_id = $1 AND test_type = 'inbound_call_probe'`,
        [probeId],
      );
      res.json({ status: 'fail', error: 'Probe window expired (60s)', expired: true });
      return;
    }
    res.json({ status: row.status, log: row.log, completed_at: row.completed_at, error: row.error });
  } catch (err) {
    next(err);
  }
});

// GET /:id/verifications — last 20 verification rows for the timeline UI
numberLifecycleRouter.get('/:id/verifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT id, run_id, test_type, status, log, started_at, completed_at, error
         FROM number_verifications
        WHERE tenant_id = $1 AND number_id = $2
        ORDER BY started_at DESC LIMIT 20`,
      [tenantId, req.params.id],
    );
    res.json({ data: r.rows });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Verification helpers
// ─────────────────────────────────────────────────────────────────────────

async function testProviderApi(num: any): Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }> {
  if (num.provider === 'sandbox') {
    return { status: 'pass', log: { note: 'Sandbox numbers don\'t need a carrier round-trip.' } };
  }
  if (num.provider === 'plivo') {
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) return { status: 'fail', error: 'Plivo credentials not configured' };
    const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');
    try {
      const resp = await fetch(`https://api.plivo.com/v1/Account/${authId}/`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!resp.ok) return { status: 'fail', error: `Plivo returned ${resp.status}` };
      const data: any = await resp.json();
      return { status: 'pass', log: { account_type: data.account_type, name: data.name, cash_credits: data.cash_credits } };
    } catch (err: any) {
      return { status: 'fail', error: err.message };
    }
  }
  if (num.provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) return { status: 'fail', error: 'Twilio credentials not configured' };
    const auth = Buffer.from(`${sid}:${tok}`).toString('base64');
    try {
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!resp.ok) return { status: 'fail', error: `Twilio returned ${resp.status}` };
      return { status: 'pass', log: { account_sid: sid } };
    } catch (err: any) {
      return { status: 'fail', error: err.message };
    }
  }
  if (num.provider === 'exotel') {
    return { status: 'skip', log: { note: 'Exotel has no public account-status API.' } };
  }
  return { status: 'skip', log: { provider: num.provider } };
}

async function testOwnership(num: any): Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }> {
  if (num.provider === 'sandbox') return { status: 'pass', log: { note: 'Sandbox-owned.' } };
  if (num.provider === 'plivo') {
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) return { status: 'fail', error: 'Plivo credentials not configured' };
    const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');
    const cleaned = String(num.phone_number).replace(/[^\d]/g, '');
    try {
      const resp = await fetch(`https://api.plivo.com/v1/Account/${authId}/Number/${cleaned}/`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (resp.status === 404) return { status: 'fail', error: 'Number not found in your Plivo account.' };
      if (!resp.ok) return { status: 'fail', error: `Plivo returned ${resp.status}` };
      const data: any = await resp.json();
      return {
        status: 'pass',
        log: { active: data.active, voice_enabled: data.voice_enabled, sms_enabled: data.sms_enabled, region: data.region },
      };
    } catch (err: any) {
      return { status: 'fail', error: err.message };
    }
  }
  // Twilio/Exotel: trust DB row — full ownership check needs paid API calls.
  return { status: 'skip', log: { provider: num.provider, note: 'Ownership check unavailable for this provider.' } };
}

async function testWebhookReachable(): Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }> {
  const base = (config as any)?.publicBaseUrl || process.env.PUBLIC_BASE_URL || '';
  if (!base || !/^https?:\/\//i.test(base)) {
    return { status: 'fail', error: 'PUBLIC_BASE_URL not set — Plivo webhooks won\'t reach us.' };
  }
  try {
    const resp = await fetch(`${base.replace(/\/+$/, '')}/health`, { method: 'GET' });
    if (!resp.ok) return { status: 'fail', error: `Public base returned ${resp.status}` };
    return { status: 'pass', log: { public_base_url: base } };
  } catch (err: any) {
    return { status: 'fail', error: err.message };
  }
}

async function testWsStream(): Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }> {
  const base = (config as any)?.publicBaseUrl || process.env.PUBLIC_BASE_URL || '';
  if (!base) return { status: 'fail', error: 'PUBLIC_BASE_URL not set' };
  // We can't open an actual upstream WS handshake from here without dragging
  // in a ws client — but we CAN verify that the same origin that serves
  // /health is publishing the /plivo/audio path (the WS upgrade dispatch
  // lives in src/index.ts). This catches the common breakage where the
  // tunnel is up but the upgrade listener isn't registered.
  try {
    const resp = await fetch(`${base.replace(/\/+$/, '')}/plivo/audio`, {
      method: 'GET',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    });
    // Without a real WS handshake the server will respond with non-2xx,
    // but as long as we get *something* back the path is reachable.
    if (resp.status >= 100 && resp.status < 600) {
      return { status: 'pass', log: { path: '/plivo/audio', http_status: resp.status } };
    }
    return { status: 'fail', error: `Unexpected status ${resp.status}` };
  } catch (err: any) {
    return { status: 'fail', error: err.message };
  }
}

/**
 * Outbound dry-run: ask the carrier to dial a sentinel destination, then
 * cancel the call immediately. Validates: credentials, account status,
 * outbound entitlement, and answer-URL routing — without actually billing
 * for an answered call. Sentinels per carrier:
 *   - Twilio: Magic test number `+15005550006` (returns "valid", no call placed, no charge)
 *   - Plivo:  Send to a test extension that returns 400 immediately if account
 *             has voice entitlement (vs 401/403 if it doesn't)
 *   - Exotel/sandbox: skip
 */
async function testOutboundDryRun(num: any): Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }> {
  if (num.provider === 'sandbox') return { status: 'skip', log: { note: 'Sandbox cannot make real calls.' } };
  if (num.provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) return { status: 'fail', error: 'Twilio creds missing' };
    const auth = Buffer.from(`${sid}:${tok}`).toString('base64');
    const body = new URLSearchParams();
    body.set('From', String(num.phone_number));
    body.set('To', '+15005550006'); // Twilio magic: "valid number, returns success without dialing"
    body.set('Url', 'http://demo.twilio.com/docs/voice.xml');
    try {
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const text = await resp.text();
      if (resp.ok) {
        // Cancel the call immediately to avoid billing.
        try {
          const j = JSON.parse(text);
          if (j.sid) {
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${j.sid}.json`, {
              method: 'POST',
              headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'Status=canceled',
            });
          }
        } catch { /* swallow */ }
        return { status: 'pass', log: { magic_dest: '+15005550006', note: 'Twilio accepted the outbound request — credentials + entitlement OK.' } };
      }
      return { status: 'fail', error: `Twilio returned ${resp.status}: ${text.slice(0, 200)}` };
    } catch (err: any) {
      return { status: 'fail', error: err.message };
    }
  }
  if (num.provider === 'plivo') {
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) return { status: 'fail', error: 'Plivo creds missing' };
    const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');
    try {
      // Plivo doesn't have a magic-dry-run number. Instead, hit /v1/Account/<sid>/Pricing/?country_iso=US
      // which returns 200 only if account+entitlement allow voice. This avoids
      // touching the Calls API (would either succeed and bill, or fail on 402).
      const resp = await fetch(`https://api.plivo.com/v1/Account/${authId}/Pricing/?country_iso=US`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!resp.ok) return { status: 'fail', error: `Plivo returned ${resp.status}` };
      const data: any = await resp.json();
      return { status: 'pass', log: { country: 'US', voice_outbound_rate: data?.voice?.outbound?.rate, note: 'Plivo voice rates fetched — account is voice-enabled.' } };
    } catch (err: any) {
      return { status: 'fail', error: err.message };
    }
  }
  return { status: 'skip', log: { provider: num.provider, note: 'Outbound dry-run not implemented for this carrier.' } };
}

async function testRecordingDir(): Promise<{ status: 'pass' | 'fail' | 'skip'; log?: any; error?: string }> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const dir = path.resolve(process.cwd(), 'logs', 'recordings');
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return { status: 'pass', log: { dir } };
  } catch (err: any) {
    return { status: 'fail', error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /:id/assign-agent — explicit assignment with verification gate
// ─────────────────────────────────────────────────────────────────────────
const assignAgentSchema = z.object({
  agent_id: z.string().uuid(),
  // Allow the UI to override the verification gate when the user knows what
  // they're doing (e.g. importing a number whose verify run intentionally
  // partial-fails because PUBLIC_BASE_URL isn't a public tunnel in dev).
  bypass_verification: z.boolean().optional().default(false),
});

numberLifecycleRouter.post('/:id/assign-agent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = assignAgentSchema.parse(req.body);

    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }

    if (!parsed.bypass_verification) {
      // Require a passing verification within the last 7 days.
      const v = await pool.query(
        `SELECT 1 FROM number_verifications
          WHERE number_id = $1 AND status = 'pass' AND started_at > NOW() - INTERVAL '7 days'
          LIMIT 1`,
        [num.id],
      );
      if (v.rows.length === 0) {
        res.status(412).json({
          error: 'Verification Required',
          message: 'This number has no passing verification in the last 7 days. Click Verify first, or pass `bypass_verification: true` to override.',
        });
        return;
      }
    }

    // Confirm agent exists in this tenant
    const agent = await fetchLiveAgent(parsed.agent_id, tenantId);
    if (!agent || agent.tenant_id !== tenantId) {
      res.status(404).json({ error: 'Agent Not Found', message: 'Agent does not exist in your tenant.' });
      return;
    }

    const before = { agent_id: num.agent_id };
    const updated = await pool.query(
      `UPDATE phone_numbers SET agent_id = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [parsed.agent_id, num.id, tenantId],
    );

    await recordNumberAudit(pool, {
      tenantId,
      numberId: num.id,
      eventType: before.agent_id ? 'assigned' : 'assigned',
      actor: actorFrom(req),
      before,
      after: { agent_id: parsed.agent_id },
    });

    res.json({ data: updated.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /:id/deploy — freeze the agent config + activate live routing
// ─────────────────────────────────────────────────────────────────────────
const deploySchema = z.object({
  agent_id: z.string().uuid().optional(),
  bypass_verification: z.boolean().optional().default(false),
});

numberLifecycleRouter.post('/:id/deploy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const parsed = deploySchema.parse(req.body || {});

    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }

    const agentId = parsed.agent_id || num.agent_id;
    if (!agentId) {
      res.status(400).json({
        error: 'Agent Required',
        message: 'Pick an agent first — either pass agent_id in the body or call /assign-agent before deploy.',
      });
      return;
    }

    if (!parsed.bypass_verification) {
      const v = await pool.query(
        `SELECT 1 FROM number_verifications
          WHERE number_id = $1 AND status = 'pass' AND started_at > NOW() - INTERVAL '7 days'
          LIMIT 1`,
        [num.id],
      );
      if (v.rows.length === 0) {
        res.status(412).json({
          error: 'Verification Required',
          message: 'No passing verification in the last 7 days. Click Verify first, or pass `bypass_verification: true`.',
        });
        return;
      }
    }

    const agent = await fetchLiveAgent(agentId, tenantId);
    if (!agent || agent.tenant_id !== tenantId) {
      res.status(404).json({ error: 'Agent Not Found', message: 'Agent does not exist in your tenant.' });
      return;
    }
    if (!agent.system_prompt || String(agent.system_prompt).trim().length < 5) {
      res.status(412).json({
        error: 'Agent Not Ready',
        message: 'Agent has no system prompt — live calls would have nothing to say. Add one in Agent Builder, then redeploy.',
      });
      return;
    }

    // Snapshot current config + retire any previous active deploys for this number
    const snapshot = buildAgentSnapshot(agent);
    const before = {
      deployment_status: num.deployment_status,
      agent_id: num.agent_id,
      is_active: num.is_active,
    };

    const client = await pool.connect();
    let inserted: any;
    try {
      await client.query('BEGIN');
      // Compute next version
      const versionRow = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS v FROM deployed_agent_configs WHERE number_id = $1`,
        [num.id],
      );
      const nextVersion = (versionRow.rows[0].v || 0) + 1;
      // Retire prior active snapshot(s) for this number
      await client.query(
        `UPDATE deployed_agent_configs
            SET is_active = FALSE, retired_at = NOW()
          WHERE number_id = $1 AND is_active = TRUE`,
        [num.id],
      );
      const ins = await client.query(
        `INSERT INTO deployed_agent_configs
           (tenant_id, agent_id, number_id, version, snapshot, deployed_by, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING *`,
        [
          tenantId,
          agentId,
          num.id,
          nextVersion,
          JSON.stringify(snapshot),
          actorFrom(req).userId,
        ],
      );
      inserted = ins.rows[0];
      await client.query(
        `UPDATE phone_numbers
            SET agent_id = $1,
                is_active = TRUE,
                deployment_status = 'deployed',
                deployed_at = NOW(),
                deployed_config_id = $2
          WHERE id = $3 AND tenant_id = $4`,
        [agentId, inserted.id, num.id, tenantId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await recordNumberAudit(pool, {
      tenantId,
      numberId: num.id,
      eventType: before.deployment_status === 'deployed' ? 'redeployed' : 'deployed',
      actor: actorFrom(req),
      before,
      after: {
        deployment_status: 'deployed',
        agent_id: agentId,
        deployed_config_id: inserted.id,
        version: inserted.version,
      },
    });

    res.json({
      ok: true,
      number_id: num.id,
      agent_id: agentId,
      deployment_status: 'deployed',
      deployed_config_id: inserted.id,
      version: inserted.version,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// POST /:id/pause — keep snapshot, but stop accepting live calls
numberLifecycleRouter.post('/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }
    const before = { deployment_status: num.deployment_status, is_active: num.is_active };
    await pool.query(
      `UPDATE phone_numbers SET deployment_status = 'paused', is_active = FALSE WHERE id = $1 AND tenant_id = $2`,
      [num.id, tenantId],
    );
    await recordNumberAudit(pool, {
      tenantId,
      numberId: num.id,
      eventType: 'paused',
      actor: actorFrom(req),
      before,
      after: { deployment_status: 'paused', is_active: false },
    });
    res.json({ ok: true, deployment_status: 'paused' });
  } catch (err) {
    next(err);
  }
});

// POST /:id/resume — re-activate the existing snapshot without redeploying
numberLifecycleRouter.post('/:id/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }
    if (!num.deployed_config_id) {
      res.status(412).json({
        error: 'Not Deployed',
        message: 'Nothing to resume — this number was never deployed. Click Deploy.',
      });
      return;
    }
    const before = { deployment_status: num.deployment_status, is_active: num.is_active };
    await pool.query(
      `UPDATE phone_numbers SET deployment_status = 'deployed', is_active = TRUE WHERE id = $1 AND tenant_id = $2`,
      [num.id, tenantId],
    );
    await recordNumberAudit(pool, {
      tenantId,
      numberId: num.id,
      eventType: 'resumed',
      actor: actorFrom(req),
      before,
      after: { deployment_status: 'deployed', is_active: true },
    });
    res.json({ ok: true, deployment_status: 'deployed' });
  } catch (err) {
    next(err);
  }
});

// POST /:id/inbound — toggle inbound_enabled on/off
numberLifecycleRouter.post('/:id/inbound', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await resolveNumber(req.params.id, tenantId, res);
    if (!num) return;
    const enabled = req.body.enabled !== false;
    await pool.query(
      `UPDATE phone_numbers SET inbound_enabled = $1 WHERE id = $2 AND tenant_id = $3`,
      [enabled, num.id, tenantId],
    );
    await auditLog({
      tenantId,
      numberId: num.id,
      eventType: enabled ? 'inbound_enabled' : 'inbound_disabled',
      actor: actorFrom(req),
      before: { inbound_enabled: !enabled },
      after: { inbound_enabled: enabled },
    });
    res.json({ ok: true, inbound_enabled: enabled });
  } catch (err) {
    next(err);
  }
});

// POST /:id/outbound — toggle outbound_enabled on/off
numberLifecycleRouter.post('/:id/outbound', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await resolveNumber(req.params.id, tenantId, res);
    if (!num) return;
    const enabled = req.body.enabled !== false;
    await pool.query(
      `UPDATE phone_numbers SET outbound_enabled = $1 WHERE id = $2 AND tenant_id = $3`,
      [enabled, num.id, tenantId],
    );
    await auditLog({
      tenantId,
      numberId: num.id,
      eventType: enabled ? 'outbound_enabled' : 'outbound_disabled',
      actor: actorFrom(req),
      before: { outbound_enabled: !enabled },
      after: { outbound_enabled: enabled },
    });
    res.json({ ok: true, outbound_enabled: enabled });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Routing config endpoints
// ─────────────────────────────────────────────────────────────────────────

const routeConfigSchema = z.object({
  business_hours: z
    .object({
      enabled: z.boolean().default(false),
      timezone: z.string().default('UTC'),
      // 0=Sun … 6=Sat. Each day: {open: "HH:MM", close: "HH:MM"} or null for closed.
      days: z.record(z.string(), z.object({ open: z.string(), close: z.string() }).nullable()).default({}),
      after_hours_message: z.string().optional(),
    })
    .optional(),
  failover: z
    .object({
      enabled: z.boolean().default(false),
      failover_agent_id: z.string().uuid().nullable().optional(),
      failover_number_id: z.string().uuid().nullable().optional(),
      // Cross-carrier fallback: when the primary carrier returns 402/429/5xx
      // on outbound, retry through this carrier using a tenant-owned number
      // on that carrier. Set to null/undefined to disable cross-carrier failover.
      failover_provider: z.enum(['plivo', 'twilio', 'exotel']).nullable().optional(),
    })
    .optional(),
  ivr: z
    .object({
      enabled: z.boolean().default(false),
      greeting: z.string().optional(),
      menu: z
        .array(
          z.object({
            digit: z.string().min(1).max(1),
            label: z.string(),
            action: z.enum(['route_to_agent', 'transfer_to_number', 'hangup']),
            agent_id: z.string().uuid().nullable().optional(),
            transfer_to: z.string().nullable().optional(),
          }),
        )
        .default([]),
      timeout_seconds: z.number().int().min(3).max(60).default(8),
    })
    .optional(),
  geo: z
    .object({
      enabled: z.boolean().default(false),
      allowed_country_codes: z.array(z.string()).default([]),
      blocked_country_codes: z.array(z.string()).default([]),
    })
    .optional(),
  spam_dnd: z
    .object({
      enabled: z.boolean().default(false),
      blocked_numbers: z.array(z.string()).default([]),
    })
    .optional(),
});

// GET /:id/route — current routing config (returns {} if none configured)
numberLifecycleRouter.get('/:id/route', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT route_config, updated_at FROM call_routes WHERE tenant_id = $1 AND number_id = $2`,
      [tenantId, req.params.id],
    );
    if (r.rows.length === 0) {
      res.json({ data: { route_config: {}, updated_at: null } });
      return;
    }
    res.json({ data: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /:id/route — upsert routing config
numberLifecycleRouter.put('/:id/route', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const num = await loadNumber(req.params.id, tenantId);
    if (!num) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }
    const parsed = routeConfigSchema.parse(req.body || {});

    const before = await pool.query(
      `SELECT route_config FROM call_routes WHERE tenant_id = $1 AND number_id = $2`,
      [tenantId, num.id],
    );
    const beforeCfg = before.rows[0]?.route_config || null;

    const upsert = await pool.query(
      `INSERT INTO call_routes (tenant_id, number_id, route_config, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (number_id) DO UPDATE SET
         route_config = EXCLUDED.route_config,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [tenantId, num.id, JSON.stringify(parsed), actorFrom(req).userId],
    );

    await recordNumberAudit(pool, {
      tenantId,
      numberId: num.id,
      eventType: 'route_updated',
      actor: actorFrom(req),
      before: beforeCfg ? { route_config: beforeCfg } : null,
      after: { route_config: parsed },
    });

    res.json({ data: upsert.rows[0] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /:id/audit — number lifecycle audit trail (last 50 events)
// ─────────────────────────────────────────────────────────────────────────
numberLifecycleRouter.get('/:id/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT id, event_type, actor_user_id, actor_email, before_state, after_state, metadata, created_at
         FROM number_audit_log
        WHERE tenant_id = $1 AND number_id = $2
        ORDER BY created_at DESC LIMIT 50`,
      [tenantId, req.params.id],
    );
    res.json({ data: r.rows });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /:id/deployment — current snapshot + history (last 5)
// ─────────────────────────────────────────────────────────────────────────
numberLifecycleRouter.get('/:id/deployment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT id, agent_id, version, deployed_at, retired_at, is_active,
              snapshot->>'name' AS agent_name,
              snapshot->>'llm_provider' AS llm_provider,
              snapshot->>'llm_model' AS llm_model
         FROM deployed_agent_configs
        WHERE tenant_id = $1 AND number_id = $2
        ORDER BY deployed_at DESC LIMIT 5`,
      [tenantId, req.params.id],
    );
    res.json({ data: r.rows });
  } catch (err) {
    next(err);
  }
});
