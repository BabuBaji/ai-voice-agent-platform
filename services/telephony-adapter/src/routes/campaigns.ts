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

// Validate IANA timezone via the runtime's Intl tz database. Returns the
// canonical id on success, null if the runtime rejects it.
function sanitizeTimezone(tz: any): string | null {
  if (!tz || typeof tz !== 'string') return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch { return null; }
}

function sanitizeHHMM(s: any): string | null {
  if (!s || typeof s !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

// Returns { open, msUntilOpen } for the campaign's window evaluated *now*.
// open=true → dial freely. open=false → msUntilOpen tells the runner when to
// re-check. If no window is configured, always open. Crosses midnight handled
// (e.g. 22:00–06:00 night window).
function evaluateCallWindow(campaign: any): { open: boolean; msUntilOpen: number } {
  const start = campaign.call_window_start as string | null;
  const end = campaign.call_window_end as string | null;
  if (!start || !end) return { open: true, msUntilOpen: 0 };
  const tz = campaign.timezone || 'Asia/Kolkata';

  // Get the current HH:MM in the campaign's timezone.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const nowMin = hh * 60 + mm;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  const inWindow = startMin <= endMin
    ? (nowMin >= startMin && nowMin < endMin)
    : (nowMin >= startMin || nowMin < endMin); // crosses midnight

  if (inWindow) return { open: true, msUntilOpen: 0 };

  // Outside window — compute minutes until next open.
  let waitMin: number;
  if (startMin <= endMin) {
    waitMin = nowMin < startMin ? startMin - nowMin : (1440 - nowMin) + startMin;
  } else {
    waitMin = (1440 - nowMin) + startMin; // we're in the daytime gap of a night window
  }
  // Add a tiny buffer so we don't fire exactly on the boundary.
  return { open: false, msUntilOpen: (waitMin * 60 + 5) * 1000 };
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
      timezone, call_window_start, call_window_end,
      campaign_instruction,
      // Multi-channel additions (default to PHONE so the existing wizard
      // payload — no channel field — keeps creating voice campaigns).
      channel, message_body, template_id,
    } = req.body || {};

    const channelUpper = String(channel || 'PHONE').toUpperCase();
    if (!['PHONE', 'SMS', 'WHATSAPP'].includes(channelUpper)) {
      res.status(400).json({ error: 'Bad Request', message: 'channel must be PHONE | SMS | WHATSAPP' });
      return;
    }
    const isMessageChannel = channelUpper === 'SMS' || channelUpper === 'WHATSAPP';

    if (!name || !from_number) {
      res.status(400).json({ error: 'Bad Request', message: 'name, from_number required' });
      return;
    }
    if (channelUpper === 'PHONE' && !agent_id) {
      res.status(400).json({ error: 'Bad Request', message: 'agent_id required for PHONE campaigns' });
      return;
    }
    if (isMessageChannel) {
      const hasBody = typeof message_body === 'string' && message_body.trim().length > 0;
      const hasTpl  = typeof template_id  === 'string' && template_id.trim().length  > 0;
      if (!hasBody && !hasTpl) {
        res.status(400).json({ error: 'Bad Request', message: 'message_body or template_id required for SMS/WHATSAPP campaigns' });
        return;
      }
    }

    const tz = sanitizeTimezone(timezone);
    if (timezone && !tz) {
      res.status(400).json({ error: 'Bad Request', message: `Unknown timezone "${timezone}"` });
      return;
    }
    const winStart = sanitizeHHMM(call_window_start);
    const winEnd = sanitizeHHMM(call_window_end);
    if ((call_window_start && !winStart) || (call_window_end && !winEnd)) {
      res.status(400).json({ error: 'Bad Request', message: 'call_window_start/end must be HH:MM (24h)' });
      return;
    }
    if ((winStart && !winEnd) || (winEnd && !winStart)) {
      res.status(400).json({ error: 'Bad Request', message: 'Both call_window_start and call_window_end must be set together' });
      return;
    }

    // Bind a deployed snapshot at creation time so mid-campaign agent edits
    // don't leak into running dials. Prefer the active snapshot for the
    // (number, agent) pair; fall back to the agent's most recent active
    // snapshot on any number. NULL is fine — runner will fall through to
    // the live agent config (with the deploy-gate still enforced).
    let snapshotId: string | null = null;
    try {
      const snap = await pool.query(
        `SELECT dac.id FROM deployed_agent_configs dac
         JOIN phone_numbers pn ON pn.id = dac.number_id
         WHERE dac.tenant_id = $1 AND dac.agent_id = $2 AND dac.is_active = TRUE
           AND pn.phone_number = $3
         ORDER BY dac.deployed_at DESC LIMIT 1`,
        [tenantId, agent_id, from_number]
      );
      snapshotId = snap.rows[0]?.id || null;
      if (!snapshotId) {
        const snap2 = await pool.query(
          `SELECT id FROM deployed_agent_configs
           WHERE tenant_id = $1 AND agent_id = $2 AND is_active = TRUE
           ORDER BY deployed_at DESC LIMIT 1`,
          [tenantId, agent_id]
        );
        snapshotId = snap2.rows[0]?.id || null;
      }
    } catch { /* non-fatal: snapshot binding is optional */ }

    const instructionTrimmed =
      typeof campaign_instruction === 'string' && campaign_instruction.trim().length > 0
        ? campaign_instruction.trim().slice(0, 4000)
        : null;

    const inserted = await pool.query(
      `INSERT INTO campaigns (tenant_id, agent_id, name, description, from_number, provider,
                              concurrency, max_attempts, retry_delay_seconds, schedule_start_at,
                              timezone, call_window_start, call_window_end, status,
                              campaign_instruction, deployed_agent_config_id,
                              channel, message_body, template_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16,$17,$18)
       RETURNING *`,
      [tenantId, isMessageChannel ? (agent_id || null) : agent_id,
       name, description || null, from_number, provider,
       Math.max(1, Math.min(10, concurrency)),
       Math.max(1, Math.min(5, max_attempts)),
       Math.max(60, Math.min(86400, retry_delay_seconds)),
       schedule_start_at || null,
       tz || 'Asia/Kolkata', winStart, winEnd,
       instructionTrimmed, snapshotId,
       channelUpper,
       isMessageChannel ? (message_body ? String(message_body).slice(0, 4000) : null) : null,
       isMessageChannel ? (template_id  ? String(template_id).slice(0, 64)   : null) : null]
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
 * PATCH /api/v1/campaigns/:id — tweak runtime knobs on an existing campaign.
 * Allowed fields: concurrency, max_attempts, retry_delay_seconds,
 * timezone, call_window_start, call_window_end.
 *
 * Refused while RUNNING — tuning concurrency mid-dial would race with the
 * in-flight processCampaign tick. Pause first, then PATCH, then resume.
 */
campaignRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const cur = await pool.query(
      `SELECT status FROM campaigns WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (!cur.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }

    // schedule_start_at is cosmetic once the campaign is already RUNNING/
    // COMPLETED (the runner ignores it), so we allow editing it any time.
    // Other knobs (concurrency, retry rules) must wait for a PAUSE because
    // the runner reads them on each tick — mutating mid-flight would race.
    const { concurrency, max_attempts, retry_delay_seconds, timezone, call_window_start, call_window_end, campaign_instruction, schedule_start_at } = req.body || {};
    const nonScheduleEdit = (
      concurrency !== undefined || max_attempts !== undefined || retry_delay_seconds !== undefined ||
      timezone !== undefined || call_window_start !== undefined || call_window_end !== undefined ||
      campaign_instruction !== undefined
    );
    if (cur.rows[0].status === 'RUNNING' && nonScheduleEdit) {
      res.status(409).json({ error: 'Conflict', message: 'Pause the campaign before editing concurrency / retry rules.' });
      return;
    }

    const sets: string[] = [];
    const vals: any[] = [];
    const push = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (concurrency !== undefined)         push('concurrency',         Math.max(1, Math.min(10, parseInt(concurrency, 10) || 1)));
    if (max_attempts !== undefined)        push('max_attempts',        Math.max(1, Math.min(5,  parseInt(max_attempts, 10) || 1)));
    if (retry_delay_seconds !== undefined) push('retry_delay_seconds', Math.max(60, Math.min(86400, parseInt(retry_delay_seconds, 10) || 900)));
    if (campaign_instruction !== undefined) {
      const v = campaign_instruction === null || campaign_instruction === ''
        ? null
        : String(campaign_instruction).trim().slice(0, 4000) || null;
      push('campaign_instruction', v);
    }
    if (timezone !== undefined) {
      const tz = sanitizeTimezone(timezone);
      if (!tz) { res.status(400).json({ error: 'Bad Request', message: `Unknown timezone "${timezone}"` }); return; }
      push('timezone', tz);
    }
    if (call_window_start !== undefined) {
      const v = call_window_start === null ? null : sanitizeHHMM(call_window_start);
      if (call_window_start && !v) { res.status(400).json({ error: 'Bad Request', message: 'call_window_start must be HH:MM' }); return; }
      push('call_window_start', v);
    }
    if (call_window_end !== undefined) {
      const v = call_window_end === null ? null : sanitizeHHMM(call_window_end);
      if (call_window_end && !v) { res.status(400).json({ error: 'Bad Request', message: 'call_window_end must be HH:MM' }); return; }
      push('call_window_end', v);
    }
    if (schedule_start_at !== undefined) {
      // Accept ISO string or null. Reject if it doesn't parse.
      if (schedule_start_at === null || schedule_start_at === '') {
        push('schedule_start_at', null);
      } else {
        const d = new Date(schedule_start_at);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: 'Bad Request', message: 'schedule_start_at must be an ISO datetime' });
          return;
        }
        push('schedule_start_at', d.toISOString());
      }
    }

    if (!sets.length) { res.status(400).json({ error: 'Bad Request', message: 'No editable fields supplied' }); return; }
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.id, tenantId);
    const upd = await pool.query(
      `UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(upd.rows[0]);
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

/**
 * POST /api/v1/campaigns/:id/targets/bulk-action
 * Body: { action: 'exclude' | 'include' | 'exclude_others' | 'include_all', target_ids?: string[] }
 *
 * - exclude:        flip the given PENDING targets → EXCLUDED (runner skips)
 * - include:        flip the given EXCLUDED targets → PENDING (runner picks them up again)
 * - exclude_others: keep target_ids on PENDING, flip every OTHER PENDING in this campaign → EXCLUDED.
 *                   This is the "call only these" action.
 * - include_all:    flip every EXCLUDED in this campaign → PENDING. The reset button.
 *
 * Only touches rows in safe statuses (PENDING / EXCLUDED) — never overwrites
 * IN_PROGRESS / COMPLETED / FAILED so we don't disturb in-flight calls or
 * rewrite history. Returns {updated} count.
 */
campaignRouter.post('/:id/targets/bulk-action', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const campaignId = req.params.id;
    const { action, target_ids } = req.body || {};
    const allowed = ['exclude', 'include', 'exclude_others', 'include_all'];
    if (!allowed.includes(action)) {
      res.status(400).json({ error: 'Invalid action', allowed });
      return;
    }
    const own = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND tenant_id = $2',
      [campaignId, tenantId]
    );
    if (!own.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }

    let updated = 0;
    if (action === 'exclude' || action === 'include') {
      if (!Array.isArray(target_ids) || target_ids.length === 0) {
        res.status(400).json({ error: 'target_ids must be a non-empty array for this action' });
        return;
      }
      const fromStatus = action === 'exclude' ? 'PENDING' : 'EXCLUDED';
      const toStatus = action === 'exclude' ? 'EXCLUDED' : 'PENDING';
      const r = await pool.query(
        `UPDATE campaign_targets
            SET status = $1
          WHERE campaign_id = $2
            AND status = $3
            AND id = ANY($4::uuid[])`,
        [toStatus, campaignId, fromStatus, target_ids]
      );
      updated = r.rowCount || 0;
    } else if (action === 'exclude_others') {
      if (!Array.isArray(target_ids) || target_ids.length === 0) {
        res.status(400).json({ error: 'target_ids must list which targets to KEEP' });
        return;
      }
      const r = await pool.query(
        `UPDATE campaign_targets
            SET status = 'EXCLUDED'
          WHERE campaign_id = $1
            AND status = 'PENDING'
            AND id <> ALL($2::uuid[])`,
        [campaignId, target_ids]
      );
      updated = r.rowCount || 0;
    } else if (action === 'include_all') {
      const r = await pool.query(
        `UPDATE campaign_targets
            SET status = 'PENDING'
          WHERE campaign_id = $1
            AND status = 'EXCLUDED'`,
        [campaignId]
      );
      updated = r.rowCount || 0;
    }
    res.json({ updated, action });
  } catch (err) { next(err); }
});

// ---------- Analytics ----------

/**
 * GET /api/v1/campaigns/:id/analytics — aggregated dashboard metrics:
 *  - target rollups (status + outcome buckets)
 *  - answer rate, avg duration on COMPLETED calls
 *  - per-hour throughput over the last 24h
 *  - sentiment + lead_score histograms from conversations.analysis
 *  - top objections + outcomes from analysis JSONB
 */
campaignRouter.get('/:id/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const cid = req.params.id;

    const own = await pool.query(
      `SELECT id FROM campaigns WHERE id = $1 AND tenant_id = $2`,
      [cid, tenantId]
    );
    if (!own.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }

    // Target rollups: every status + every outcome bucket in one trip.
    const rollup = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status='PENDING')::int     AS pending,
         COUNT(*) FILTER (WHERE status='IN_PROGRESS')::int AS in_progress,
         COUNT(*) FILTER (WHERE status='COMPLETED')::int   AS completed,
         COUNT(*) FILTER (WHERE status='FAILED')::int      AS failed,
         COUNT(*) FILTER (WHERE outcome='answered')::int   AS answered,
         COUNT(*) FILTER (WHERE outcome='no_answer')::int  AS no_answer,
         COUNT(*) FILTER (WHERE outcome='busy')::int       AS busy,
         COUNT(*) FILTER (WHERE outcome='failed')::int     AS dial_failed,
         COUNT(*) FILTER (WHERE outcome='cancelled')::int  AS cancelled,
         COUNT(*) FILTER (WHERE outcome='dnc')::int        AS dnc,
         SUM(attempts)::int                                AS total_attempts
       FROM campaign_targets WHERE campaign_id = $1`,
      [cid]
    );

    // Call-level metrics: avg duration on completed calls and per-hour
    // throughput (last 24h, bucketed by truncated hour in campaign tz).
    const callMetrics = await pool.query(
      `SELECT
         AVG(duration_seconds) FILTER (WHERE status='COMPLETED' AND duration_seconds > 0) AS avg_duration_seconds,
         COUNT(*) FILTER (WHERE status='COMPLETED') AS dialed_completed,
         COUNT(*) AS total_dials
       FROM calls
       WHERE metadata->>'campaign_id' = $1`,
      [cid]
    );

    const throughput = await pool.query(
      `SELECT date_trunc('hour', started_at AT TIME ZONE 'UTC') AS hour_utc,
              COUNT(*)::int AS dials,
              COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed
       FROM calls
       WHERE metadata->>'campaign_id' = $1
         AND started_at >= NOW() - INTERVAL '24 hours'
       GROUP BY hour_utc
       ORDER BY hour_utc ASC`,
      [cid]
    );

    // Sentiment + lead-score histograms from the post-call analysis JSONB.
    // Defensive: analysis may not be present on every conversation (failed
    // analyzer, dial-only call). Skip nulls.
    const sentiment = await pool.query(
      `SELECT LOWER(COALESCE(cv.analysis->>'sentiment',''))::text AS sentiment,
              COUNT(*)::int AS n
       FROM calls c
       JOIN conversations cv ON cv.id = c.conversation_id
       WHERE c.metadata->>'campaign_id' = $1
         AND cv.analysis IS NOT NULL
         AND cv.analysis->>'sentiment' IS NOT NULL
       GROUP BY LOWER(COALESCE(cv.analysis->>'sentiment',''))
       ORDER BY n DESC`,
      [cid]
    );

    const intent = await pool.query(
      `SELECT LOWER(COALESCE(cv.analysis->>'interest_level',''))::text AS bucket,
              COUNT(*)::int AS n
       FROM calls c
       JOIN conversations cv ON cv.id = c.conversation_id
       WHERE c.metadata->>'campaign_id' = $1
         AND cv.analysis IS NOT NULL
         AND cv.analysis->>'interest_level' IS NOT NULL
       GROUP BY LOWER(COALESCE(cv.analysis->>'interest_level',''))
       ORDER BY n DESC`,
      [cid]
    );

    // Lead-score histogram: 5 buckets 0-20, 20-40, 40-60, 60-80, 80-100.
    const leadScore = await pool.query(
      `WITH parsed AS (
         SELECT CASE
                  WHEN cv.analysis->>'lead_score' ~ '^[0-9]+(\\.[0-9]+)?$'
                  THEN (cv.analysis->>'lead_score')::numeric
                  ELSE NULL END AS score
         FROM calls c
         JOIN conversations cv ON cv.id = c.conversation_id
         WHERE c.metadata->>'campaign_id' = $1 AND cv.analysis IS NOT NULL
       )
       SELECT
         COUNT(*) FILTER (WHERE score >= 0 AND score < 20)::int  AS b_0_20,
         COUNT(*) FILTER (WHERE score >= 20 AND score < 40)::int AS b_20_40,
         COUNT(*) FILTER (WHERE score >= 40 AND score < 60)::int AS b_40_60,
         COUNT(*) FILTER (WHERE score >= 60 AND score < 80)::int AS b_60_80,
         COUNT(*) FILTER (WHERE score >= 80 AND score <= 100)::int AS b_80_100,
         AVG(score)::float AS avg
       FROM parsed WHERE score IS NOT NULL`,
      [cid]
    );

    const r = rollup.rows[0] || {};
    const cm = callMetrics.rows[0] || {};
    const closed = (r.completed || 0) + (r.failed || 0);
    const answer_rate = closed > 0 ? +((r.answered || 0) / closed).toFixed(4) : 0;
    const conversion_rate = closed > 0 ? +((r.completed || 0) / closed).toFixed(4) : 0;

    res.json({
      rollup: r,
      answer_rate,
      conversion_rate,
      avg_duration_seconds: cm.avg_duration_seconds != null ? parseFloat(cm.avg_duration_seconds) : null,
      total_dials: parseInt(cm.total_dials || '0', 10),
      throughput: throughput.rows.map((x: any) => ({
        hour_utc: x.hour_utc,
        dials: x.dials,
        completed: x.completed,
      })),
      sentiment: sentiment.rows.map((x: any) => ({ label: x.sentiment || 'unknown', count: x.n })),
      interest_level: intent.rows.map((x: any) => ({ label: x.bucket || 'unknown', count: x.n })),
      lead_score: leadScore.rows[0] || null,
    });
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
/**
 * Interpolate {{var}} placeholders in a message body using the target's
 * variables JSONB (+ `name` as a top-level convenience). Unknown placeholders
 * are left as-is so the operator can spot them in communication_logs and
 * fix the CSV. Empty string variables become empty, not "undefined".
 */
function interpolateMessage(body: string, target: { name?: string | null; variables?: Record<string, any> | null }): string {
  if (!body) return '';
  const bag: Record<string, any> = { name: target.name || '', ...(target.variables || {}) };
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const v = bag[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/**
 * Dispatch a batch of SMS / WhatsApp campaign targets. Posts to
 * conversation-service's /api/v1/communications/{sms|whatsapp}/send for each
 * target so all the per-tenant provider resolution + DLT enforcement +
 * communication_logs writes happen in one place. Honors the same status state
 * machine as the voice flow (PENDING → IN_PROGRESS → COMPLETED/FAILED).
 * Retry semantics + DND + concurrency are governed by the caller — this
 * function just transmits one tick's worth of targets in parallel.
 */
async function dispatchMessageBatch(
  campaign: any,
  targets: any[],
  channel: 'SMS' | 'WHATSAPP',
): Promise<void> {
  const convUrl = process.env.CONVERSATION_SERVICE_URL || 'http://localhost:3003/api/v1';
  const channelPath = channel === 'SMS' ? 'sms' : 'whatsapp';
  await Promise.all(targets.map(async (t: any) => {
    await pool.query(
      `UPDATE campaign_targets SET status = 'IN_PROGRESS', attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1`,
      [t.id],
    );
    try {
      const message = interpolateMessage(campaign.message_body || '', { name: t.name, variables: t.variables });
      // Empty rendered message after interpolation is almost always a CSV/column
      // mismatch — fail fast so the operator can fix it rather than burning
      // provider credits on blanks.
      if (!message.trim()) {
        await pool.query(
          `UPDATE campaign_targets SET status='FAILED', last_error=$1, outcome='failed' WHERE id=$2`,
          ['Rendered message body is empty (check {{var}} placeholders vs CSV columns)', t.id],
        );
        return;
      }
      const resp = await fetch(`${convUrl}/communications/${channelPath}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': campaign.tenant_id,
        },
        body: JSON.stringify({
          recipient: t.phone_number,
          message,
          template_id: campaign.template_id || null,
          from_number: campaign.from_number || null,
          // No lead_id here — campaign targets aren't always CRM leads.
        }),
      });
      const body: any = await resp.json().catch(() => ({}));
      if (!resp.ok || body?.ok === false) {
        const errMsg = body?.error || body?.message || `HTTP ${resp.status}`;
        // Retry vs fail — same logic as the voice path. Re-read campaign
        // status so a PAUSE mid-batch can't resurrect the target.
        const live = await pool.query(`SELECT status FROM campaigns WHERE id = $1`, [campaign.id]);
        const liveStatus = String(live.rows[0]?.status || '').toUpperCase();
        const maxAttempts = campaign.max_attempts || 1;
        const isStopped = liveStatus === 'PAUSED' || liveStatus === 'CANCELED' || liveStatus === 'CANCELLED' || liveStatus === 'COMPLETED' || liveStatus === 'FAILED';
        if (isStopped || t.attempts + 1 >= maxAttempts) {
          await pool.query(
            `UPDATE campaign_targets SET status='FAILED', last_error=$1, outcome='failed' WHERE id=$2`,
            [errMsg.slice(0, 500), t.id],
          );
        } else {
          const delay = campaign.retry_delay_seconds || 900;
          await pool.query(
            `UPDATE campaign_targets
             SET status='PENDING', last_error=$1, next_attempt_after = NOW() + ($2 || ' seconds')::interval
             WHERE id=$3`,
            [errMsg.slice(0, 500), String(delay), t.id],
          );
        }
        return;
      }
      // Provider accepted the send. Communication_logs holds the granular
      // delivered/read state; campaign_target is just "did we hand it off?"
      await pool.query(
        `UPDATE campaign_targets
         SET status='COMPLETED', outcome='answered', last_error=NULL, conversation_id=NULL
         WHERE id=$1`,
        [t.id],
      );
      logger.info({ campaignId: campaign.id, targetId: t.id, to: t.phone_number, channel, logId: body?.log_id }, 'campaign message dispatched');
    } catch (err: any) {
      const msg = err?.message || `${channel} send failed`;
      logger.warn({ campaignId: campaign.id, targetId: t.id, channel, err: msg }, 'campaign message threw');
      const maxAttempts = campaign.max_attempts || 1;
      if (t.attempts + 1 >= maxAttempts) {
        await pool.query(
          `UPDATE campaign_targets SET status='FAILED', last_error=$1, outcome='failed' WHERE id=$2`,
          [msg.slice(0, 500), t.id],
        );
      } else {
        const delay = campaign.retry_delay_seconds || 900;
        await pool.query(
          `UPDATE campaign_targets
           SET status='PENDING', last_error=$1, next_attempt_after = NOW() + ($2 || ' seconds')::interval
           WHERE id=$3`,
          [msg.slice(0, 500), String(delay), t.id],
        );
      }
    }
  }));
}

async function processCampaign(campaignId: string): Promise<void> {
  const c = await pool.query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
  if (!c.rows.length) return;
  const campaign = c.rows[0];
  if (campaign.status !== 'RUNNING' && campaign.status !== 'WAITING') return;

  // If nothing left to dial or wait on, finalize before checking the window —
  // we don't want to park a finished campaign in WAITING overnight.
  const remaining = await pool.query(
    `SELECT COUNT(*)::int AS n FROM campaign_targets
     WHERE campaign_id = $1 AND status IN ('PENDING','IN_PROGRESS')`,
    [campaignId]
  );
  if (remaining.rows[0].n === 0) {
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

  // Calling-hours gate. Outside the configured window we don't dial — we
  // flip to WAITING and schedule a wake-up at the window-open boundary. When
  // back inside the window we restore RUNNING and dial normally.
  const win = evaluateCallWindow(campaign);
  if (!win.open) {
    if (campaign.status !== 'WAITING') {
      await pool.query(`UPDATE campaigns SET status='WAITING', updated_at=NOW() WHERE id=$1`, [campaignId]);
    }
    // Cap the sleep so a runtime restart can't strand a long-window campaign:
    // if window re-opens >10min from now, recheck after 10min to pick up edits.
    const wait = Math.min(win.msUntilOpen, 10 * 60 * 1000);
    setTimeout(() => void processCampaign(campaignId), wait);
    return;
  }
  if (campaign.status === 'WAITING') {
    await pool.query(`UPDATE campaigns SET status='RUNNING', updated_at=NOW() WHERE id=$1`, [campaignId]);
    campaign.status = 'RUNNING';
  }

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

  // Pull pending targets (eligible now). Exclude any target whose phone is on
  // the tenant's do-not-call list — those are silently FAILED with reason=dnc.
  const targets = await pool.query(
    `SELECT * FROM campaign_targets
     WHERE campaign_id = $1
       AND status = 'PENDING'
       AND (next_attempt_after IS NULL OR next_attempt_after <= NOW())
       AND NOT EXISTS (
         SELECT 1 FROM do_not_call_numbers d
         WHERE d.tenant_id = $3 AND d.phone_number = campaign_targets.phone_number
       )
     ORDER BY created_at ASC
     LIMIT $2`,
    [campaignId, canStart, campaign.tenant_id]
  );

  // Sweep DND'd targets to FAILED so they don't loop forever in PENDING.
  // Cheap one-off update; idempotent (only flips matching rows).
  try {
    await pool.query(
      `UPDATE campaign_targets
       SET status='FAILED', outcome='dnc', last_error='Phone number is on the do-not-call list'
       WHERE campaign_id = $1 AND status = 'PENDING'
         AND EXISTS (
           SELECT 1 FROM do_not_call_numbers d
           WHERE d.tenant_id = $2 AND d.phone_number = campaign_targets.phone_number
         )`,
      [campaignId, campaign.tenant_id]
    );
  } catch { /* non-fatal */ }

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

  // Provider self-correction: trust the actual phone_numbers.provider for
  // this from_number over campaign.provider. Without this, a campaign
  // created with from=Twilio-number but provider=plivo (wizard race) hits
  // a Plivo 400 "not a Plivo Number". One DB query per tick is cheap.
  let providerName = String(campaign.provider || 'plivo').toLowerCase();
  try {
    const pn = await pool.query(
      `SELECT provider FROM phone_numbers
       WHERE phone_number = $1 AND tenant_id = $2 AND is_active = TRUE
       ORDER BY deployed_at DESC NULLS LAST LIMIT 1`,
      [campaign.from_number, campaign.tenant_id],
    );
    const actual = pn.rows[0]?.provider;
    if (actual && actual.toLowerCase() !== providerName) {
      logger.warn(
        { campaignId: campaign.id, stored: providerName, actual, from: campaign.from_number },
        'campaign provider mismatch — using number\'s actual provider and persisting fix',
      );
      providerName = actual.toLowerCase();
      // Persist the correction so the UI + analytics line up.
      await pool.query(
        `UPDATE campaigns SET provider = $1, updated_at = NOW() WHERE id = $2`,
        [providerName, campaign.id],
      );
    }
  } catch { /* non-fatal — fall back to stored campaign.provider */ }

  // ── Channel branch ───────────────────────────────────────────────────────
  // Voice (PHONE, default) keeps the entire downstream block — agent gate,
  // initiateCall, calls-row insert, webhook-driven target finalize. SMS and
  // WHATSAPP run a message-dispatch path that hits conversation-service per
  // target and finalizes the target inline (no calls row, no agent needed).
  const channel = String(campaign.channel || 'PHONE').toUpperCase();
  if (channel === 'SMS' || channel === 'WHATSAPP') {
    await dispatchMessageBatch(campaign, targets.rows, channel as 'SMS' | 'WHATSAPP');
    // Pace the next tick the same way the voice path does — gives delivery
    // webhooks a beat to land and keeps the runner responsive to pause/edit.
    setTimeout(() => void processCampaign(campaignId), 5000);
    return;
  }

  const provider = getProvider(providerName);

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

      // Insert a calls row. metadata carries everything the WS handler needs to
      // personalize this dial: campaign_instruction (free-form note appended to
      // the system prompt), per-target name + vars (interpolated into greeting
      // + injected as CONTACT_CONTEXT), and the deployed snapshot id (so we
      // read the frozen agent config instead of the live one).
      await pool.query(
        `INSERT INTO calls (tenant_id, agent_id, direction, status, caller_number, called_number,
                            provider, provider_call_sid, metadata)
         VALUES ($1,$2,'OUTBOUND','RINGING',$3,$4,$5,$6,$7)
         ON CONFLICT (provider_call_sid) DO NOTHING`,
        [campaign.tenant_id, campaign.agent_id, campaign.from_number, t.phone_number,
         campaign.provider, result.providerCallId,
         JSON.stringify({
           campaign_id: campaignId,
           target_id: t.id,
           target_name: t.name,
           vars: t.variables,
           campaign_instruction: campaign.campaign_instruction || null,
           deployed_agent_config_id: campaign.deployed_agent_config_id || null,
         })]
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

      // Decide retry vs fail. Re-read the campaign status before requeuing — a
      // user PAUSE/CANCEL while this dial was in flight should NOT cause the
      // target to silently re-queue. Without this check, paused campaigns
      // resurrected themselves the moment a single dial failed.
      const live = await pool.query(`SELECT status FROM campaigns WHERE id = $1`, [campaignId]);
      const liveStatus = String(live.rows[0]?.status || '').toUpperCase();
      const maxAttempts = campaign.max_attempts || 1;
      const isStoppedState = liveStatus === 'PAUSED' || liveStatus === 'CANCELED' || liveStatus === 'CANCELLED' || liveStatus === 'COMPLETED' || liveStatus === 'FAILED';
      if (isStoppedState || t.attempts + 1 >= maxAttempts) {
        await pool.query(
          `UPDATE campaign_targets SET status = 'FAILED', last_error = $1 WHERE id = $2`,
          [(isStoppedState ? `${msg} (campaign ${liveStatus})` : msg).slice(0, 500), t.id]
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

    // Treat COMPLETED = COMPLETED; anything else = retry if attempts remain, otherwise FAILED.
    // Critical: PAUSED/CANCELED campaigns must NOT cause the failed-target to
    // re-queue — otherwise pausing a campaign mid-flight resurrects every call
    // that fails after the pause. We finalize the target as FAILED with a
    // 'campaign_stopped' outcome so the analytics view shows what happened.
    const campStatus = String(camp.status || '').toUpperCase();
    const isStoppedState = campStatus === 'PAUSED' || campStatus === 'CANCELED' || campStatus === 'CANCELLED' || campStatus === 'COMPLETED' || campStatus === 'FAILED';
    if (outcome === 'COMPLETED') {
      await pool.query(
        `UPDATE campaign_targets SET status = 'COMPLETED', outcome = 'answered', conversation_id = $1 WHERE id = $2`,
        [conversationId, target.id]
      );
    } else if (isStoppedState) {
      await pool.query(
        `UPDATE campaign_targets SET status = 'FAILED', outcome = $1, conversation_id = $2 WHERE id = $3`,
        [`campaign_${campStatus.toLowerCase()}`, conversationId, target.id]
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

    // Kick the runner to dial the next one if the campaign is still active.
    // WAITING means outside the calling-hours window — runner will gate again
    // and reschedule, but recomputing now also lets it finalize if this was
    // the last target.
    if (camp.status === 'RUNNING' || camp.status === 'WAITING') {
      void processCampaign(target.campaign_id).catch(() => {});
    }
  } catch (err: any) {
    logger.warn({ err: err.message, providerCallSid }, 'updateTargetFromCallEnd failed');
  }
}

// ---------- Schedule auto-start ----------

/**
 * Periodic poller: any campaign whose schedule_start_at has passed but is
 * still DRAFT or SCHEDULED gets auto-flipped to RUNNING and kicked. Without
 * this, schedule_start_at would be purely cosmetic — the user would have to
 * manually click Start at the scheduled time.
 *
 * Tick interval is 15s — close enough to honour minute-precision schedules
 * without hammering the DB. On a missed-tick (process restart), the next tick
 * still picks up overdue rows.
 */
async function scheduleTick(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT id FROM campaigns
       WHERE status IN ('DRAFT','SCHEDULED')
         AND schedule_start_at IS NOT NULL
         AND schedule_start_at <= NOW()`
    );
    for (const row of r.rows) {
      const upd = await pool.query(
        `UPDATE campaigns
         SET status='RUNNING', last_run_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status IN ('DRAFT','SCHEDULED')
         RETURNING id`,
        [row.id]
      );
      if (upd.rows.length) {
        logger.info({ campaignId: row.id }, 'campaign auto-started by schedule');
        void processCampaign(row.id).catch((e) =>
          logger.error({ campaignId: row.id, err: e.message }, 'auto-start processCampaign threw')
        );
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'scheduleTick failed');
  }
}

let scheduleTimer: NodeJS.Timeout | null = null;
export function startCampaignScheduler(): void {
  if (scheduleTimer) return;
  // First tick after 2s so logs settle on boot, then every 15s.
  setTimeout(() => {
    void scheduleTick();
    scheduleTimer = setInterval(() => void scheduleTick(), 15000);
  }, 2000);
  logger.info('campaign scheduler started (15s tick)');
}
