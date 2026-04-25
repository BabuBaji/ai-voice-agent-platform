import { Router, Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { pool } from '../index';
import { getProvider } from '../providers';
import { config } from '../config';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const campaignRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = (req.headers['x-tenant-id'] as string) || '';
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

// ---------- Campaigns CRUD ----------

/**
 * GET /api/v1/campaigns — list campaigns for the tenant.
 */
campaignRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const result = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id) AS target_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'COMPLETED') AS completed_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'FAILED') AS failed_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'PENDING') AS pending_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'IN_PROGRESS') AS in_progress_count
       FROM campaigns c
       WHERE c.tenant_id = $1
       ORDER BY c.created_at DESC`,
      [tenantId]
    );
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/campaigns — create a campaign.
 * Body: { name, description?, agent_id, from_number, provider?, concurrency?, max_attempts?, retry_delay_seconds?, schedule_start_at? }
 */
campaignRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const {
      name, description, agent_id, from_number,
      provider = 'plivo', concurrency = 1, max_attempts = 1,
      retry_delay_seconds = 900, schedule_start_at,
    } = req.body || {};

    if (!name || !agent_id || !from_number) {
      res.status(400).json({ error: 'Bad Request', message: 'name, agent_id, from_number required' });
      return;
    }

    const inserted = await pool.query(
      `INSERT INTO campaigns (tenant_id, agent_id, name, description, from_number, provider,
                              concurrency, max_attempts, retry_delay_seconds, schedule_start_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT')
       RETURNING *`,
      [tenantId, agent_id, name, description || null, from_number, provider,
       Math.max(1, Math.min(10, concurrency)),
       Math.max(1, Math.min(5, max_attempts)),
       Math.max(60, Math.min(86400, retry_delay_seconds)),
       schedule_start_at || null]
    );
    res.status(201).json(inserted.rows[0]);
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/campaigns/:id — fetch one campaign + rollup counts.
 */
campaignRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id) AS target_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'COMPLETED') AS completed_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'FAILED') AS failed_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'PENDING') AS pending_count,
              (SELECT COUNT(*)::int FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status = 'IN_PROGRESS') AS in_progress_count
       FROM campaigns c
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/campaigns/:id
 */
campaignRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    await pool.query('DELETE FROM campaigns WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Targets ----------

/**
 * POST /api/v1/campaigns/:id/targets — add one target (JSON) or bulk upload (CSV body).
 *
 * JSON body: { phone_number, name?, variables? }
 * CSV (Content-Type: text/csv) body: header row `phone_number,name,...extra_columns`
 *    — extra columns become `variables.{col_name}` for template interpolation.
 */
campaignRouter.post('/:id/targets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    // Verify campaign belongs to tenant
    const check = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenantId]
    );
    if (!check.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    let added = 0;
    let skipped = 0;

    if (contentType.includes('text/csv') || typeof req.body === 'string') {
      const csvText = typeof req.body === 'string' ? req.body : (req.body?.csv as string);
      if (!csvText) { res.status(400).json({ error: 'Bad Request', message: 'CSV body empty' }); return; }

      const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
      if (!lines.length) { res.status(400).json({ error: 'Bad Request', message: 'No rows' }); return; }

      // naive CSV — header is first row
      const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const phoneIdx = header.findIndex((h) => h === 'phone_number' || h === 'phone' || h === 'number' || h === 'to');
      const nameIdx = header.findIndex((h) => h === 'name');
      if (phoneIdx === -1) {
        res.status(400).json({ error: 'Bad Request', message: 'CSV must contain phone_number / phone / number / to column' });
        return;
      }

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p: string) => p.trim());
        const phone = parts[phoneIdx];
        if (!phone) { skipped++; continue; }
        const name = nameIdx >= 0 ? parts[nameIdx] : null;
        const variables: Record<string, string> = {};
        header.forEach((h, idx) => {
          if (h === 'phone_number' || h === 'phone' || h === 'number' || h === 'to' || h === 'name') return;
          if (parts[idx]) variables[h] = parts[idx];
        });
        try {
          await pool.query(
            `INSERT INTO campaign_targets (campaign_id, phone_number, name, variables, status)
             VALUES ($1,$2,$3,$4,'PENDING')`,
            [req.params.id, phone, name, variables]
          );
          added++;
        } catch { skipped++; }
      }
    } else {
      // single JSON target
      const { phone_number, name, variables } = req.body || {};
      if (!phone_number) { res.status(400).json({ error: 'Bad Request', message: 'phone_number required' }); return; }
      await pool.query(
        `INSERT INTO campaign_targets (campaign_id, phone_number, name, variables, status)
         VALUES ($1,$2,$3,$4,'PENDING')`,
        [req.params.id, phone_number, name || null, variables || {}]
      );
      added = 1;
    }

    // Refresh total_targets
    await pool.query(
      `UPDATE campaigns
       SET total_targets = (SELECT COUNT(*)::int FROM campaign_targets WHERE campaign_id = $1),
           updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );

    res.json({ added, skipped });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/campaigns/:id/targets
 */
campaignRouter.get('/:id/targets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const check = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenantId]
    );
    if (!check.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }

    const r = await pool.query(
      `SELECT * FROM campaign_targets WHERE campaign_id = $1 ORDER BY created_at ASC LIMIT 2000`,
      [req.params.id]
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

// ---------- Lifecycle ----------

/**
 * POST /api/v1/campaigns/:id/start — mark RUNNING and kick the runner.
 */
campaignRouter.post('/:id/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `UPDATE campaigns SET status = 'RUNNING', last_run_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    // Kick runner in background
    void processCampaign(req.params.id).catch((e) =>
      logger.error({ campaignId: req.params.id, err: e.message }, 'campaign processCampaign threw')
    );
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/campaigns/:id/pause
 */
campaignRouter.post('/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `UPDATE campaigns SET status = 'PAUSED', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ---------- Runner ----------

/**
 * Dial up to `concurrency` pending targets for the campaign. Self-reschedules
 * every 5s while the campaign is RUNNING and pending targets remain.
 */
async function processCampaign(campaignId: string): Promise<void> {
  const c = await pool.query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
  if (!c.rows.length) return;
  const campaign = c.rows[0];
  if (campaign.status !== 'RUNNING') return;

  // How many in-progress right now?
  const inFlight = await pool.query(
    `SELECT COUNT(*)::int AS n FROM campaign_targets WHERE campaign_id = $1 AND status = 'IN_PROGRESS'`,
    [campaignId]
  );
  const canStart = Math.max(0, (campaign.concurrency || 1) - inFlight.rows[0].n);
  if (canStart <= 0) {
    setTimeout(() => void processCampaign(campaignId), 5000);
    return;
  }

  // Pull pending targets (eligible now)
  const targets = await pool.query(
    `SELECT * FROM campaign_targets
     WHERE campaign_id = $1
       AND status = 'PENDING'
       AND (next_attempt_after IS NULL OR next_attempt_after <= NOW())
     ORDER BY created_at ASC
     LIMIT $2`,
    [campaignId, canStart]
  );

  if (!targets.rows.length) {
    // All done or waiting for retry windows. Check if we should finalize.
    const pendingLeft = await pool.query(
      `SELECT COUNT(*)::int AS n FROM campaign_targets
       WHERE campaign_id = $1 AND status IN ('PENDING','IN_PROGRESS')`,
      [campaignId]
    );
    if (pendingLeft.rows[0].n === 0) {
      await pool.query(
        `UPDATE campaigns
         SET status = 'COMPLETED',
             completed_targets = (SELECT COUNT(*)::int FROM campaign_targets WHERE campaign_id = $1 AND status = 'COMPLETED'),
             failed_targets = (SELECT COUNT(*)::int FROM campaign_targets WHERE campaign_id = $1 AND status = 'FAILED'),
             updated_at = NOW()
         WHERE id = $1`,
        [campaignId]
      );
      logger.info({ campaignId }, 'campaign completed');
      return;
    }
    // Waiting on retries — come back later
    setTimeout(() => void processCampaign(campaignId), 10000);
    return;
  }

  const provider = getProvider(campaign.provider || 'plivo');

  // Look up voicemail detection setting on the agent (per-call carrier flag).
  // Also check the deploy gate — refuse to start a campaign on a DRAFT agent.
  let voicemailDetection = false;
  try {
    const agentSvcUrl = process.env.AGENT_SERVICE_URL || 'http://localhost:3001/api/v1';
    const ar = await fetch(`${agentSvcUrl}/agents/${campaign.agent_id}`, {
      headers: { 'x-tenant-id': campaign.tenant_id },
    });
    if (ar.ok) {
      const ag: any = await ar.json();
      const status = String(ag?.status || '').toUpperCase();
      if (process.env.BYPASS_PUBLISH_GATE !== 'true' && (status === 'DRAFT' || status === 'ARCHIVED')) {
        await pool.query(
          `UPDATE campaigns SET status = 'FAILED', metadata = COALESCE(metadata,'{}') || $1 WHERE id = $2`,
          [JSON.stringify({ failure_reason: 'agent_not_deployed', agent_status: status }), campaign.id]
        );
        return; // Caller treats this as no-op; campaigns API surfaces the FAILED status.
      }
      voicemailDetection = !!ag?.call_config?.voicemail_detection?.enabled;
    }
  } catch { /* non-fatal */ }

  await Promise.all(targets.rows.map(async (t: any) => {
    // Mark in-progress first
    await pool.query(
      `UPDATE campaign_targets SET status = 'IN_PROGRESS', attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1`,
      [t.id]
    );
    try {
      const result = await provider.initiateCall({
        from: campaign.from_number,
        to: t.phone_number,
        agentId: campaign.agent_id,
        tenantId: campaign.tenant_id,
        voicemailDetection,
      });

      // Insert a calls row
      await pool.query(
        `INSERT INTO calls (tenant_id, agent_id, direction, status, caller_number, called_number,
                            provider, provider_call_sid, metadata)
         VALUES ($1,$2,'OUTBOUND','RINGING',$3,$4,$5,$6,$7)
         ON CONFLICT (provider_call_sid) DO NOTHING`,
        [campaign.tenant_id, campaign.agent_id, campaign.from_number, t.phone_number,
         campaign.provider, result.providerCallId,
         JSON.stringify({ campaign_id: campaignId, target_id: t.id, target_name: t.name, vars: t.variables })]
      );

      await pool.query(
        `UPDATE campaign_targets SET provider_call_sid = $1 WHERE id = $2`,
        [result.providerCallId, t.id]
      );

      logger.info({ campaignId, targetId: t.id, to: t.phone_number, callSid: result.providerCallId }, 'target dial initiated');
      // Leave status=IN_PROGRESS; the call status webhook will flip it to COMPLETED/FAILED via updateTargetFromCallEnd (below)
    } catch (err: any) {
      const msg = err?.message || 'dial failed';
      logger.warn({ campaignId, targetId: t.id, err: msg }, 'target dial failed');

      // Decide retry vs fail
      const maxAttempts = campaign.max_attempts || 1;
      if (t.attempts + 1 >= maxAttempts) {
        await pool.query(
          `UPDATE campaign_targets SET status = 'FAILED', last_error = $1 WHERE id = $2`,
          [msg.slice(0, 500), t.id]
        );
      } else {
        const delay = campaign.retry_delay_seconds || 900;
        await pool.query(
          `UPDATE campaign_targets
           SET status = 'PENDING',
               last_error = $1,
               next_attempt_after = NOW() + ($2 || ' seconds')::interval
           WHERE id = $3`,
          [msg.slice(0, 500), String(delay), t.id]
        );
      }
    }
  }));

  // Loop: check for more pending after a short pacing gap
  setTimeout(() => void processCampaign(campaignId), 5000);
}

/**
 * Called from the call-end status webhook so campaign target rows reflect
 * outcome once the call actually ends. Exported so webhooks.ts can import.
 */
export async function updateTargetFromCallEnd(
  providerCallSid: string,
  outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED',
  conversationId: string | null
): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT id, campaign_id, attempts FROM campaign_targets WHERE provider_call_sid = $1`,
      [providerCallSid]
    );
    if (!r.rows.length) return;
    const target = r.rows[0];

    // Look up campaign for retry decision
    const c = await pool.query(`SELECT max_attempts, retry_delay_seconds, status FROM campaigns WHERE id = $1`, [target.campaign_id]);
    const camp = c.rows[0] || {};

    // Treat COMPLETED = COMPLETED; anything else = retry if attempts remain, otherwise FAILED
    if (outcome === 'COMPLETED') {
      await pool.query(
        `UPDATE campaign_targets SET status = 'COMPLETED', outcome = 'answered', conversation_id = $1 WHERE id = $2`,
        [conversationId, target.id]
      );
    } else {
      const maxAttempts = camp.max_attempts || 1;
      if (target.attempts >= maxAttempts) {
        await pool.query(
          `UPDATE campaign_targets SET status = 'FAILED', outcome = $1, conversation_id = $2 WHERE id = $3`,
          [outcome.toLowerCase(), conversationId, target.id]
        );
      } else {
        const delay = camp.retry_delay_seconds || 900;
        await pool.query(
          `UPDATE campaign_targets
           SET status = 'PENDING',
               next_attempt_after = NOW() + ($1 || ' seconds')::interval,
               conversation_id = $2
           WHERE id = $3`,
          [String(delay), conversationId, target.id]
        );
      }
    }

    // Kick the runner to dial the next one if the campaign is still running
    if (camp.status === 'RUNNING') {
      void processCampaign(target.campaign_id).catch(() => {});
    }
  } catch (err: any) {
    logger.warn({ err: err.message, providerCallSid }, 'updateTargetFromCallEnd failed');
  }
}
