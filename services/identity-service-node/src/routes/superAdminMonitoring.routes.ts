/**
 * Super Admin — Global Monitoring & Control (Phase 1).
 *
 * Additive, super-admin-only router mounted at /super-admin alongside the
 * existing superAdminRouter. Read endpoints aggregate the EXISTING queues,
 * jobs, communications and analytics tables (in conversation_db / crm_db) via
 * the read-only cross-DB pools — no new infrastructure, no changes to the
 * voice/AI-runtime path. Write actions only flip status/timestamps on existing
 * rows so the existing sweepers do the real work; every mutation is audited
 * via recordAction (super_admin_actions).
 *
 * All routes are gated by authMiddleware + requireSuperAdmin, so nothing here
 * is reachable by a tenant JWT.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.middleware';
import { conversationPool, crmPool } from '../db/crossPools';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Audit a super-admin mutation. Mirrors the helper in superAdmin.routes.ts.
 *  Non-fatal — never blocks the action. */
async function recordAction(
  pool: Pool, req: Request, action: string,
  opts: { targetTenantId?: string | null; targetResourceType?: string | null; targetResourceId?: string | null; payload?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO super_admin_actions
         (admin_user_id, admin_email, action, module, target_tenant_id,
          target_resource_type, target_resource_id, payload, ip, user_agent)
       VALUES ($1, $2, $3, 'monitoring', $4, $5, $6, $7, $8, $9)`,
      [
        (req as any).userId, (req as any).email, action,
        opts.targetTenantId ?? null, opts.targetResourceType ?? null, opts.targetResourceId ?? null,
        JSON.stringify(opts.payload ?? {}),
        (req.headers['x-forwarded-for'] as string) || req.ip || null,
        (req.headers['user-agent'] as string) || null,
      ],
    );
  } catch (err) {
    console.warn('[super-admin/monitoring] audit write failed', err);
  }
}

/** Turn [{k, count}] rows into { k: number } with numeric coercion. */
function tally(rows: Array<Record<string, any>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r[key])] = Number(r.count);
  return out;
}
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/** Resolve tenant_id → name from identity_db for sample hydration. Best-effort. */
async function tenantNames(idPool: Pool, ids: Array<string | null | undefined>): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  if (uniq.length === 0) return {};
  try {
    const r = await idPool.query(`SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`, [uniq]);
    const m: Record<string, string> = {};
    for (const row of r.rows) m[row.id] = row.name;
    return m;
  } catch { return {}; }
}

// ── router ───────────────────────────────────────────────────────────────────

export function superAdminMonitoringRouter(): Router {
  const router = Router();
  router.use(authMiddleware);
  router.use(requireSuperAdmin);

  // ── GET /queues — global queue & sweeper health ───────────────────────────
  router.get('/queues', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const cp = conversationPool();
      const [crmByStatus, crmAgg, recallByState, recallAgg, commRetry, waByStatus, fuByStatus, fuAgg] = await Promise.all([
        cp.query(`SELECT status, count(*)::int AS count FROM crm_lead_retry_queue GROUP BY status`),
        cp.query(`SELECT min(next_attempt_at) FILTER (WHERE status='PENDING') AS oldest_pending, max(updated_at) AS last_activity,
                         count(*) FILTER (WHERE status='PENDING' AND next_attempt_at<=NOW())::int AS due_now FROM crm_lead_retry_queue`),
        cp.query(`SELECT state, count(*)::int AS count FROM lead_recall_queue GROUP BY state`),
        cp.query(`SELECT min(next_retry_at) FILTER (WHERE state='PENDING') AS oldest_pending, max(updated_at) AS last_activity,
                         count(*) FILTER (WHERE state='PENDING' AND next_retry_at<=NOW())::int AS due_now FROM lead_recall_queue`),
        cp.query(`SELECT count(*) FILTER (WHERE status='failed')::int AS failed,
                         count(*) FILTER (WHERE status='failed' AND next_retry_at IS NOT NULL AND next_retry_at<=NOW())::int AS retry_due,
                         max(created_at) AS last_activity FROM communication_logs`),
        cp.query(`SELECT status, count(*)::int AS count FROM whatsapp_campaign_targets GROUP BY status`),
        cp.query(`SELECT status, count(*)::int AS count FROM follow_up_tasks GROUP BY status`),
        cp.query(`SELECT count(*) FILTER (WHERE status='pending' AND scheduled_at<=NOW())::int AS due_now, max(updated_at) AS last_activity FROM follow_up_tasks`),
      ]);

      const crm = tally(crmByStatus.rows, 'status');
      const recall = tally(recallByState.rows, 'state');
      const wa = tally(waByStatus.rows, 'status');
      const fu = tally(fuByStatus.rows, 'status');

      // recent failures sample across queues (for the drill-down table)
      const failSample = await cp.query(
        `SELECT id, tenant_id, 'crm_lead_retry' AS queue, kind AS detail, last_error, attempts, updated_at AS at
           FROM crm_lead_retry_queue WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 15`,
      );
      const names = await tenantNames(idPool, failSample.rows.map((r) => r.tenant_id));

      res.json({
        generated_at: new Date().toISOString(),
        queues: [
          { key: 'crm_lead_retry', label: 'CRM Lead Retry', by_status: crm,
            total: sum(crm), pending: crm.PENDING || 0, failed: crm.FAILED || 0,
            due_now: crmAgg.rows[0].due_now, oldest_pending_at: crmAgg.rows[0].oldest_pending, last_activity_at: crmAgg.rows[0].last_activity },
          { key: 'lead_recall', label: 'Lead Recall', by_status: recall,
            total: sum(recall), pending: recall.PENDING || 0, failed: recall.UNREACHABLE || 0,
            due_now: recallAgg.rows[0].due_now, oldest_pending_at: recallAgg.rows[0].oldest_pending, last_activity_at: recallAgg.rows[0].last_activity },
          { key: 'communication_retry', label: 'Communication Retry', by_status: { failed: commRetry.rows[0].failed },
            total: commRetry.rows[0].failed, pending: commRetry.rows[0].retry_due, failed: commRetry.rows[0].failed,
            due_now: commRetry.rows[0].retry_due, oldest_pending_at: null, last_activity_at: commRetry.rows[0].last_activity },
          { key: 'wa_campaign_targets', label: 'WhatsApp Campaign Targets', by_status: wa,
            total: sum(wa), pending: wa.queued || 0, failed: wa.failed || 0, due_now: wa.queued || 0, oldest_pending_at: null, last_activity_at: null },
          { key: 'follow_up_tasks', label: 'Follow-up Tasks', by_status: fu,
            total: sum(fu), pending: fu.pending || 0, failed: fu.overdue || 0,
            due_now: fuAgg.rows[0].due_now, oldest_pending_at: null, last_activity_at: fuAgg.rows[0].last_activity },
        ],
        recent_failures: failSample.rows.map((r) => ({ ...r, tenant_name: names[r.tenant_id] || null })),
      });
    } catch (err) { next(err); }
  });

  // ── GET /reminders — follow-up tasks + recall queue ───────────────────────
  router.get('/reminders', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const cp = conversationPool();
      const [byStatus, byPriority, overdue, recallByState, recallByRetry, sample] = await Promise.all([
        cp.query(`SELECT status, count(*)::int AS count FROM follow_up_tasks GROUP BY status`),
        cp.query(`SELECT priority, count(*)::int AS count FROM follow_up_tasks GROUP BY priority`),
        cp.query(`SELECT count(*) FILTER (WHERE status='pending' AND scheduled_at<NOW())::int AS overdue,
                         count(*) FILTER (WHERE status='pending' AND scheduled_at<=NOW())::int AS due_now FROM follow_up_tasks`),
        cp.query(`SELECT state, count(*)::int AS count FROM lead_recall_queue GROUP BY state`),
        cp.query(`SELECT retry_count, count(*)::int AS count FROM lead_recall_queue GROUP BY retry_count ORDER BY retry_count`),
        cp.query(`SELECT id, tenant_id, lead_id, task_type, priority, status, scheduled_at
                    FROM follow_up_tasks WHERE status IN ('pending','overdue') ORDER BY scheduled_at ASC LIMIT 25`),
      ]);
      const names = await tenantNames(idPool, sample.rows.map((r) => r.tenant_id));
      res.json({
        generated_at: new Date().toISOString(),
        follow_up_tasks: {
          by_status: tally(byStatus.rows, 'status'),
          by_priority: tally(byPriority.rows, 'priority'),
          overdue: overdue.rows[0].overdue,
          due_now: overdue.rows[0].due_now,
        },
        recall_queue: {
          by_state: tally(recallByState.rows, 'state'),
          by_retry_count: recallByRetry.rows.map((r) => ({ retry_count: Number(r.retry_count), count: r.count })),
        },
        upcoming: sample.rows.map((r) => ({ ...r, tenant_name: names[r.tenant_id] || null })),
      });
    } catch (err) { next(err); }
  });

  // ── GET /communications — delivery tracking ───────────────────────────────
  router.get('/communications', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const cp = conversationPool();
      const since = (req.query.since as string) || new Date(Date.now() - 7 * 86400000).toISOString();
      const [byChannelStatus, byProvider, totals, failures] = await Promise.all([
        cp.query(`SELECT channel, status, count(*)::int AS count FROM communication_logs WHERE created_at >= $1 GROUP BY channel, status`, [since]),
        cp.query(`SELECT provider, count(*)::int AS total, count(*) FILTER (WHERE status='failed')::int AS failed FROM communication_logs WHERE created_at >= $1 GROUP BY provider`, [since]),
        cp.query(`SELECT count(*)::int AS total,
                         count(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered,
                         count(*) FILTER (WHERE status='sent')::int AS sent,
                         count(*) FILTER (WHERE status='failed')::int AS failed,
                         count(*) FILTER (WHERE status='queued')::int AS queued FROM communication_logs WHERE created_at >= $1`, [since]),
        cp.query(`SELECT id, tenant_id, channel, provider, recipient, status, last_error, created_at
                    FROM communication_logs WHERE status='failed' AND created_at >= $1 ORDER BY created_at DESC LIMIT 25`, [since]),
      ]);
      const names = await tenantNames(idPool, failures.rows.map((r) => r.tenant_id));
      const t = totals.rows[0];
      const attempted = t.total - t.queued;
      const delivery_pct = attempted > 0 ? Math.round(((t.delivered + t.sent) / attempted) * 1000) / 10 : null;
      res.json({
        generated_at: new Date().toISOString(),
        since,
        totals: t,
        delivery_pct,
        by_channel_status: byChannelStatus.rows,
        by_provider: byProvider.rows.map((r) => ({ provider: r.provider, total: r.total, failed: r.failed,
          failure_pct: r.total > 0 ? Math.round((r.failed / r.total) * 1000) / 10 : 0 })),
        recent_failures: failures.rows.map((r) => ({ ...r, tenant_name: names[r.tenant_id] || null })),
      });
    } catch (err) { next(err); }
  });

  // ── GET /providers — provider status & health ─────────────────────────────
  router.get('/providers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cp = conversationPool();
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const [provFail, plivo, whatsapp] = await Promise.all([
        cp.query(`SELECT provider, count(*)::int AS total, count(*) FILTER (WHERE status='failed')::int AS failed
                    FROM communication_logs WHERE created_at >= $1 GROUP BY provider`, [since]),
        cp.query(`SELECT status, count(*)::int AS count, max(last_tested_at) AS last_tested FROM tenant_plivo_integrations GROUP BY status`),
        cp.query(`SELECT status, count(*)::int AS count, max(last_tested_at) AS last_tested FROM tenant_whatsapp_integrations GROUP BY status`),
      ]);
      const envKey = (k: string) => !!(process.env[k] && String(process.env[k]).trim());
      const failByProvider: Record<string, { total: number; failed: number }> = {};
      for (const r of provFail.rows) failByProvider[r.provider] = { total: r.total, failed: r.failed };
      res.json({
        generated_at: new Date().toISOString(),
        // Credential presence — read from this process env (started with the shared .env).
        credentials: {
          deepgram: envKey('DEEPGRAM_API_KEY'),
          sarvam: envKey('SARVAM_API_KEY'),
          gemini: envKey('GOOGLE_API_KEY') || envKey('GEMINI_API_KEY') || envKey('GOOGLE_GENERATIVE_AI_API_KEY'),
          openai: envKey('OPENAI_API_KEY'),
          anthropic: envKey('ANTHROPIC_API_KEY'),
          elevenlabs: envKey('ELEVENLABS_API_KEY'),
          plivo: envKey('PLIVO_AUTH_ID'),
          twilio: envKey('TWILIO_ACCOUNT_SID'),
          smtp: envKey('SMTP_HOST'),
        },
        delivery_by_provider: provFail.rows.map((r) => ({ provider: r.provider, total: r.total, failed: r.failed,
          failure_pct: r.total > 0 ? Math.round((r.failed / r.total) * 1000) / 10 : 0 })),
        tenant_integrations: {
          plivo: { by_status: tally(plivo.rows, 'status'), last_tested: plivo.rows[0]?.last_tested || null },
          whatsapp: { by_status: tally(whatsapp.rows, 'status'), last_tested: whatsapp.rows[0]?.last_tested || null },
        },
      });
    } catch (err) { next(err); }
  });

  // ── GET /analytics — global performance ───────────────────────────────────
  router.get('/analytics', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cp = conversationPool();
      const since = (req.query.since as string) || new Date(Date.now() - 30 * 86400000).toISOString();
      const [funnel, calls, latency, retryCrm, fu, campaigns] = await Promise.all([
        cp.query(`SELECT lead_status, count(*)::int AS count FROM post_call_lead_analysis WHERE created_at >= $1 GROUP BY lead_status`, [since]),
        cp.query(`SELECT count(*)::int AS total,
                         count(*) FILTER (WHERE outcome ILIKE '%no%answer%' OR outcome ILIKE '%no-answer%')::int AS no_answer,
                         count(*) FILTER (WHERE status='COMPLETED')::int AS completed,
                         avg(duration_seconds) FILTER (WHERE status='COMPLETED') AS avg_duration FROM conversations WHERE created_at >= $1`, [since]),
        cp.query(`SELECT avg(latency_ms)::int AS avg_latency_ms FROM messages WHERE role='assistant' AND latency_ms > 0 AND created_at >= $1`, [since]),
        cp.query(`SELECT count(*) FILTER (WHERE status='SUCCESS')::int AS success, count(*) FILTER (WHERE status='FAILED')::int AS failed FROM crm_lead_retry_queue`),
        cp.query(`SELECT count(*) FILTER (WHERE status='done')::int AS done, count(*)::int AS total FROM follow_up_tasks WHERE created_at >= $1`, [since]),
        cp.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered FROM whatsapp_campaign_targets WHERE created_at >= $1`, [since]),
      ]);
      // Leads live in crm_db — fail soft if unreachable.
      let leads = { total: 0, today: 0 };
      try {
        const lr = await crmPool().query(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at::date = NOW()::date)::int AS today FROM leads`);
        leads = lr.rows[0];
      } catch { /* crm_db unreachable — leave zeros */ }

      const funnelMap = tally(funnel.rows, 'lead_status');
      const interested = (funnelMap.HOT_INTERESTED || 0) + (funnelMap.INTERESTED || 0);
      const funnelTotal = sum(funnelMap);
      const c = calls.rows[0];
      const r = retryCrm.rows[0];
      const f = fu.rows[0];
      const cam = campaigns.rows[0];
      res.json({
        generated_at: new Date().toISOString(),
        since,
        leads,
        lead_funnel: funnelMap,
        conversion_pct: funnelTotal > 0 ? Math.round((interested / funnelTotal) * 1000) / 10 : null,
        calls: { total: c.total, completed: c.completed, no_answer: c.no_answer,
          no_answer_pct: c.total > 0 ? Math.round((c.no_answer / c.total) * 1000) / 10 : null,
          avg_duration_seconds: c.avg_duration ? Math.round(Number(c.avg_duration)) : null },
        ai_latency_ms: latency.rows[0].avg_latency_ms || null,
        retry_success_pct: (r.success + r.failed) > 0 ? Math.round((r.success / (r.success + r.failed)) * 1000) / 10 : null,
        followup_success_pct: f.total > 0 ? Math.round((f.done / f.total) * 1000) / 10 : null,
        campaign_delivery_pct: cam.total > 0 ? Math.round((cam.delivered / cam.total) * 1000) / 10 : null,
      });
    } catch (err) { next(err); }
  });

  // ── GET /ops-summary — extra dashboard KPI tiles ──────────────────────────
  router.get('/ops-summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cp = conversationPool();
      const [calls, comms, queues, reminders] = await Promise.all([
        cp.query(`SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,
                         count(*) FILTER (WHERE created_at::date=NOW()::date)::int AS today,
                         count(*) FILTER (WHERE status='FAILED' AND created_at::date=NOW()::date)::int AS failed_today,
                         avg(duration_seconds) FILTER (WHERE status='COMPLETED' AND created_at::date=NOW()::date) AS avg_duration_today FROM conversations`),
        cp.query(`SELECT channel, count(*) FILTER (WHERE status='failed' AND created_at::date=NOW()::date)::int AS failed_today FROM communication_logs GROUP BY channel`),
        cp.query(`SELECT (SELECT count(*) FROM crm_lead_retry_queue WHERE status='FAILED')::int AS crm_failed,
                         (SELECT count(*) FROM communication_logs WHERE status='failed' AND next_retry_at IS NOT NULL)::int AS comm_retry_pending,
                         (SELECT count(*) FROM lead_recall_queue WHERE state='PENDING' AND next_retry_at<=NOW())::int AS recall_due`),
        cp.query(`SELECT count(*) FILTER (WHERE status='pending' AND scheduled_at<=NOW())::int AS due_now,
                         count(*) FILTER (WHERE status='overdue')::int AS overdue FROM follow_up_tasks`),
      ]);
      const commFail: Record<string, number> = {};
      for (const r of comms.rows) commFail[r.channel] = r.failed_today;
      const q = queues.rows[0];
      res.json({
        generated_at: new Date().toISOString(),
        active_ai_calls: calls.rows[0].active,
        calls_today: calls.rows[0].today,
        calls_failed_today: calls.rows[0].failed_today,
        avg_call_duration_today: calls.rows[0].avg_duration_today ? Math.round(Number(calls.rows[0].avg_duration_today)) : null,
        comm_failures_today: commFail,
        queue_health: {
          crm_failed: q.crm_failed, comm_retry_pending: q.comm_retry_pending, recall_due: q.recall_due,
          flag: (q.crm_failed > 10 || q.comm_retry_pending > 25) ? 'red' : (q.crm_failed > 0 || q.comm_retry_pending > 0) ? 'yellow' : 'green',
        },
        reminders: { due_now: reminders.rows[0].due_now, overdue: reminders.rows[0].overdue },
      });
    } catch (err) { next(err); }
  });

  // ── POST /queues/retry — requeue failed/stuck jobs ────────────────────────
  router.post('/queues/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const cp = conversationPool();
      const { queue, id } = req.body || {};
      let affected = 0;
      if (queue === 'crm_lead_retry') {
        const r = id
          ? await cp.query(`UPDATE crm_lead_retry_queue SET status='PENDING', next_attempt_at=NOW(), updated_at=NOW() WHERE id=$1::uuid AND status='FAILED'`, [id])
          : await cp.query(`UPDATE crm_lead_retry_queue SET status='PENDING', next_attempt_at=NOW(), updated_at=NOW()
                            WHERE id IN (SELECT id FROM crm_lead_retry_queue WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 100)`);
        affected = r.rowCount || 0;
      } else if (queue === 'lead_recall') {
        const r = id
          ? await cp.query(`UPDATE lead_recall_queue SET state='PENDING', next_retry_at=NOW(), updated_at=NOW() WHERE id=$1::uuid AND state IN ('UNREACHABLE','CANCELLED')`, [id])
          : await cp.query(`UPDATE lead_recall_queue SET state='PENDING', next_retry_at=NOW(), updated_at=NOW()
                            WHERE id IN (SELECT id FROM lead_recall_queue WHERE state='UNREACHABLE' ORDER BY updated_at DESC LIMIT 100)`);
        affected = r.rowCount || 0;
      } else if (queue === 'communication') {
        const r = id
          ? await cp.query(`UPDATE communication_logs SET next_retry_at=NOW() WHERE id=$1::uuid AND status='failed'`, [id])
          : await cp.query(`UPDATE communication_logs SET next_retry_at=NOW()
                            WHERE id IN (SELECT id FROM communication_logs WHERE channel='whatsapp' AND status='failed' ORDER BY created_at DESC LIMIT 100)`);
        affected = r.rowCount || 0;
      } else {
        res.status(400).json({ error: "queue must be one of: crm_lead_retry | lead_recall | communication" });
        return;
      }
      await recordAction(idPool, req, 'queue.retry', { targetResourceType: queue, targetResourceId: id || null, payload: { affected } });
      res.json({ ok: true, queue, affected });
    } catch (err) { next(err); }
  });

  // ── POST /communications/:id/resend ───────────────────────────────────────
  router.post('/communications/:id/resend', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const cp = conversationPool();
      const r = await cp.query(
        `UPDATE communication_logs SET status='failed', next_retry_at=NOW() WHERE id=$1::uuid
         RETURNING tenant_id, channel`, [req.params.id]);
      if (r.rowCount === 0) { res.status(404).json({ error: 'communication log not found' }); return; }
      await recordAction(idPool, req, 'communication.resend', { targetTenantId: r.rows[0].tenant_id, targetResourceType: 'communication_log', targetResourceId: req.params.id });
      res.json({ ok: true, channel: r.rows[0].channel, note: 'WhatsApp re-sends automatically via the retry sweeper; email/SMS have no auto-retry sweeper.' });
    } catch (err) { next(err); }
  });

  // ── POST /campaigns/:id/pause | /resume ───────────────────────────────────
  const campaignAction = (to: 'PAUSED' | 'RUNNING', from: string) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const idPool: Pool = (req as any).pool;
        const cp = conversationPool();
        const r = await cp.query(
          `UPDATE whatsapp_campaigns SET status=$2, updated_at=NOW() WHERE id=$1::uuid AND status=$3 RETURNING tenant_id, name, status`,
          [req.params.id, to, from]);
        if (r.rowCount === 0) { res.status(409).json({ error: `campaign not found or not in '${from}' state` }); return; }
        await recordAction(idPool, req, `campaign.${to === 'PAUSED' ? 'pause' : 'resume'}`, { targetTenantId: r.rows[0].tenant_id, targetResourceType: 'whatsapp_campaign', targetResourceId: req.params.id });
        res.json({ ok: true, status: r.rows[0].status });
      } catch (err) { next(err); }
    };
  router.post('/campaigns/:id/pause', campaignAction('PAUSED', 'RUNNING'));
  router.post('/campaigns/:id/resume', campaignAction('RUNNING', 'PAUSED'));

  // ── POST /reminders/:id/requeue { kind: 'task' | 'recall' } ───────────────
  router.post('/reminders/:id/requeue', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const cp = conversationPool();
      const kind = (req.body?.kind as string) || 'task';
      let r;
      if (kind === 'recall') {
        r = await cp.query(`UPDATE lead_recall_queue SET state='PENDING', next_retry_at=NOW(), updated_at=NOW() WHERE id=$1::uuid RETURNING tenant_id`, [req.params.id]);
      } else {
        r = await cp.query(`UPDATE follow_up_tasks SET status='pending', updated_at=NOW() WHERE id=$1::uuid RETURNING tenant_id`, [req.params.id]);
      }
      if (r.rowCount === 0) { res.status(404).json({ error: 'reminder not found' }); return; }
      await recordAction(idPool, req, 'reminder.requeue', { targetTenantId: r.rows[0].tenant_id, targetResourceType: kind === 'recall' ? 'lead_recall_queue' : 'follow_up_task', targetResourceId: req.params.id });
      res.json({ ok: true, kind });
    } catch (err) { next(err); }
  });

  // ── POST /tenants/:id/automation — toggle tenant automation settings ──────
  router.post('/tenants/:id/automation', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idPool: Pool = (req as any).pool;
      const settings = req.body?.settings;
      if (!settings || typeof settings !== 'object') { res.status(400).json({ error: 'settings object required' }); return; }
      const r = await idPool.query(
        `UPDATE tenants SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1::uuid RETURNING settings`,
        [req.params.id, JSON.stringify(settings)]);
      if (r.rowCount === 0) { res.status(404).json({ error: 'tenant not found' }); return; }
      await recordAction(idPool, req, 'tenant.automation.update', { targetTenantId: req.params.id, targetResourceType: 'tenant_settings', payload: settings });
      res.json({ ok: true, settings: r.rows[0].settings });
    } catch (err) { next(err); }
  });

  return router;
}
