import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.middleware';
import { generateAccessToken, generateRefreshToken } from '../services/jwt.service';
import { agentPool, conversationPool, workflowPool, knowledgePool } from '../db/crossPools';
import { ensureWallet, creditWallet, debitWallet, listTransactions } from '../services/billing/wallet.service';
import { config } from '../config';
import { dispatchWebhooks } from '../services/superAdmin/webhookDispatcher';
import { runAnomalyChecks } from '../services/superAdmin/anomalyDetector';
import { generateBase32Secret, otpauthUrl, verifyTotp } from '../services/totp';

// ── helpers ───────────────────────────────────────────────────────────────

async function recordAction(
  pool: Pool,
  req: Request,
  action: string,
  module: string,
  opts: {
    targetTenantId?: string | null;
    targetResourceType?: string | null;
    targetResourceId?: string | null;
    payload?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO super_admin_actions
         (admin_user_id, admin_email, action, module, target_tenant_id,
          target_resource_type, target_resource_id, payload, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        (req as any).userId,
        (req as any).email,
        action,
        module,
        opts.targetTenantId ?? null,
        opts.targetResourceType ?? null,
        opts.targetResourceId ?? null,
        JSON.stringify(opts.payload ?? {}),
        (req.headers['x-forwarded-for'] as string) || req.ip || null,
        (req.headers['user-agent'] as string) || null,
      ],
    );
  } catch (err) {
    // Non-fatal — never let audit-write block the actual action.
    console.warn('[super-admin] audit write failed', err);
  }
}

function pageParams(req: Request): { limit: number; offset: number; page: number } {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
  return { limit, offset: (page - 1) * limit, page };
}

// ── router ────────────────────────────────────────────────────────────────

export function superAdminRouter(): Router {
  const router = Router();

  // All routes require auth + super-admin flag.
  router.use(authMiddleware);
  router.use(requireSuperAdmin);

  // ── 1. Dashboard ────────────────────────────────────────────────────────
  router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();

      const [tenantStats, walletStats, callsToday, callsMonth, failedCalls, agentStats] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE slug <> '__platform__') AS total,
            COUNT(*) FILTER (WHERE is_active = true AND slug <> '__platform__') AS active,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND slug <> '__platform__') AS new_today,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE) AND slug <> '__platform__') AS new_month
          FROM tenants
        `),
        pool.query(`
          SELECT
            COALESCE(SUM(balance), 0)::float8 AS total_wallet_balance,
            COUNT(*) AS wallet_count
          FROM wallets
        `),
        convPool.query(`
          SELECT
            COUNT(*) AS calls_today,
            COALESCE(SUM(duration_seconds), 0)::bigint AS minutes_today
          FROM conversations
          WHERE started_at >= CURRENT_DATE
        `),
        convPool.query(`
          SELECT
            COUNT(*) AS calls_month,
            COALESCE(SUM(duration_seconds), 0)::bigint AS seconds_month
          FROM conversations
          WHERE started_at >= date_trunc('month', CURRENT_DATE)
        `),
        convPool.query(`
          SELECT COUNT(*) AS failed_today
          FROM conversations
          WHERE started_at >= CURRENT_DATE
            AND (status = 'FAILED' OR outcome ILIKE '%failed%' OR outcome ILIKE '%dropped%')
        `),
        agPool.query(`
          SELECT
            COUNT(*) AS total_agents,
            COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_agents
          FROM agents
        `),
      ]);

      res.json({
        tenants: {
          total: Number(tenantStats.rows[0].total),
          active: Number(tenantStats.rows[0].active),
          new_today: Number(tenantStats.rows[0].new_today),
          new_month: Number(tenantStats.rows[0].new_month),
        },
        calls: {
          today: Number(callsToday.rows[0].calls_today),
          minutes_today: Math.round(Number(callsToday.rows[0].minutes_today) / 60),
          this_month: Number(callsMonth.rows[0].calls_month),
          minutes_month: Math.round(Number(callsMonth.rows[0].seconds_month) / 60),
          failed_today: Number(failedCalls.rows[0].failed_today),
        },
        agents: {
          total: Number(agentStats.rows[0].total_agents),
          active: Number(agentStats.rows[0].active_agents),
        },
        revenue: {
          // Wallet balance is what tenants have pre-paid; we surface it as a
          // working proxy for monetary state until invoice settlement lands.
          total_wallet_balance_inr: Number(walletStats.rows[0].total_wallet_balance),
          wallet_count: Number(walletStats.rows[0].wallet_count),
        },
        system_health: {
          identity: 'ok',
          conversation: 'ok',
          agent: 'ok',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 2. Dashboard time-series (calls per day, last 14 days) ──────────────
  router.get('/dashboard/timeseries', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const convPool = conversationPool();
      const series = await convPool.query(`
        SELECT
          date_trunc('day', started_at)::date AS day,
          COUNT(*) AS calls,
          COALESCE(SUM(duration_seconds), 0)::bigint AS seconds
        FROM conversations
        WHERE started_at >= CURRENT_DATE - INTERVAL '13 days'
        GROUP BY 1
        ORDER BY 1
      `);
      res.json({
        days: series.rows.map((r: any) => ({
          day: r.day,
          calls: Number(r.calls),
          minutes: Math.round(Number(r.seconds) / 60),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 3. Tenants list ─────────────────────────────────────────────────────
  router.get('/tenants', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { limit, offset } = pageParams(req);
      const search = String(req.query.search || '').trim();
      const plan = String(req.query.plan || '').trim();
      const status = String(req.query.status || '').trim(); // active | suspended | all

      const wheres: string[] = ["t.slug <> '__platform__'"];
      const params: any[] = [];
      if (search) {
        params.push(`%${search}%`);
        wheres.push(`(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length})`);
      }
      if (plan && plan !== 'all') {
        params.push(plan);
        wheres.push(`t.plan = $${params.length}`);
      }
      if (status === 'active') wheres.push('t.is_active = true');
      else if (status === 'suspended') wheres.push('t.is_active = false');

      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

      const total = await pool.query(`SELECT COUNT(*) FROM tenants t ${where}`, params);
      params.push(limit);
      params.push(offset);
      const rows = await pool.query(
        `SELECT
           t.id, t.name, t.slug, t.plan, t.is_active, t.created_at,
           COALESCE(w.balance, 0)::float8 AS wallet_balance,
           (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
           (SELECT MAX(last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login_at,
           (SELECT email FROM users u
             WHERE u.tenant_id = t.id
             ORDER BY u.created_at ASC
             LIMIT 1) AS owner_email
         FROM tenants t
         LEFT JOIN wallets w ON w.tenant_id = t.id
         ${where}
         ORDER BY t.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      res.json({
        total: Number(total.rows[0].count),
        data: rows.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 4. Tenant detail ────────────────────────────────────────────────────
  router.get('/tenants/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;
      const convPool = conversationPool();
      const agPool = agentPool();

      const [tenantRow, walletRow, txRows, callsAgg, agentsAgg] = await Promise.all([
        pool.query(
          `SELECT id, name, slug, plan, settings, is_active, created_at, updated_at
           FROM tenants WHERE id = $1`,
          [id],
        ),
        pool.query(
          `SELECT id, balance::float8 AS balance, currency, low_balance_threshold::float8 AS low_balance_threshold,
                  created_at, updated_at FROM wallets WHERE tenant_id = $1`,
          [id],
        ),
        pool.query(
          `SELECT id, amount::float8 AS amount, type, reason, balance_after::float8 AS balance_after, created_at
           FROM wallet_transactions WHERE tenant_id = $1
           ORDER BY created_at DESC LIMIT 10`,
          [id],
        ),
        convPool.query(
          `SELECT
             COUNT(*) AS total_calls,
             COALESCE(SUM(duration_seconds), 0)::bigint AS total_seconds,
             MAX(started_at) AS last_call_at
           FROM conversations WHERE tenant_id = $1`,
          [id],
        ),
        agPool.query(
          `SELECT
             COUNT(*) AS total_agents,
             COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_agents
           FROM agents WHERE tenant_id = $1`,
          [id],
        ),
      ]);

      if (tenantRow.rows.length === 0) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      const usersRows = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.last_login_at, u.created_at,
                COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1
         GROUP BY u.id
         ORDER BY u.created_at ASC`,
        [id],
      );

      res.json({
        tenant: tenantRow.rows[0],
        wallet: walletRow.rows[0] || null,
        recent_transactions: txRows.rows,
        calls: {
          total: Number(callsAgg.rows[0].total_calls),
          total_minutes: Math.round(Number(callsAgg.rows[0].total_seconds) / 60),
          last_call_at: callsAgg.rows[0].last_call_at,
        },
        agents: {
          total: Number(agentsAgg.rows[0].total_agents),
          active: Number(agentsAgg.rows[0].active_agents),
        },
        users: usersRows.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 5. Tenant status (suspend/activate) ─────────────────────────────────
  const statusSchema = z.object({ active: z.boolean(), reason: z.string().max(500).optional() });
  router.put('/tenants/:id/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;
      const { active, reason } = statusSchema.parse(req.body);

      const upd = await pool.query(
        `UPDATE tenants SET is_active = $1, updated_at = now()
         WHERE id = $2 AND slug <> '__platform__'
         RETURNING id, name, is_active`,
        [active, id],
      );
      if (upd.rows.length === 0) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      await recordAction(pool, req, active ? 'tenant.activate' : 'tenant.suspend', 'tenants', {
        targetTenantId: id,
        targetResourceType: 'tenant',
        targetResourceId: id,
        payload: { reason: reason || null },
      });
      void dispatchWebhooks(pool, active ? 'tenant.activated' : 'tenant.suspended', {
        tenant_id: id, tenant_name: upd.rows[0].name, reason,
      });

      res.json({ tenant: upd.rows[0] });
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        res.status(400).json({ error: 'Validation failed', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // ── 6. Tenant impersonation (mints tenant-scoped token) ─────────────────
  router.post('/tenants/:id/impersonate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;

      // Pick the tenant's first OWNER (or oldest user if no OWNER) to impersonate.
      const target = await pool.query(
        `SELECT u.id, u.tenant_id, u.email,
                COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1 AND u.status = 'ACTIVE'
         GROUP BY u.id
         ORDER BY (CASE WHEN 'OWNER' = ANY(array_agg(r.name)) THEN 0 ELSE 1 END), u.created_at
         LIMIT 1`,
        [id],
      );
      if (target.rows.length === 0) {
        res.status(404).json({ error: 'No active user found for tenant' });
        return;
      }
      const u = target.rows[0];
      const roles: string[] = Array.isArray(u.roles) ? u.roles : [];

      // Mint a tenant-scoped token. isPlatformAdmin is intentionally false so
      // the impersonated session can't access /super-admin/* — it acts like
      // any normal tenant login.
      const accessToken = generateAccessToken(u.id, u.tenant_id, u.email, roles, false);
      const refreshToken = await generateRefreshToken(pool, u.id);

      await recordAction(pool, req, 'tenant.impersonate', 'tenants', {
        targetTenantId: id,
        targetResourceType: 'user',
        targetResourceId: u.id,
        payload: { impersonated_email: u.email },
      });

      res.json({
        accessToken,
        refreshToken,
        expiresIn: config.jwt.accessExpiration,
        impersonating: { tenantId: u.tenant_id, userId: u.id, email: u.email, roles },
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 7. Calls list (cross-tenant) ────────────────────────────────────────
  router.get('/calls', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const { limit, offset } = pageParams(req);
      const tenantId = String(req.query.tenant_id || '').trim();
      const status = String(req.query.status || '').trim();
      const channel = String(req.query.channel || '').trim();
      const since = String(req.query.since || '').trim();

      const wheres: string[] = [];
      const params: any[] = [];
      if (tenantId) {
        params.push(tenantId);
        wheres.push(`tenant_id = $${params.length}`);
      }
      if (status && status !== 'all') {
        params.push(status.toUpperCase());
        wheres.push(`status = $${params.length}`);
      }
      if (channel && channel !== 'all') {
        params.push(channel.toUpperCase());
        wheres.push(`channel = $${params.length}`);
      }
      if (since) {
        params.push(since);
        wheres.push(`started_at >= $${params.length}`);
      }
      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

      const total = await convPool.query(`SELECT COUNT(*) FROM conversations ${where}`, params);
      params.push(limit);
      params.push(offset);
      const rows = await convPool.query(
        `SELECT id, tenant_id, agent_id, channel, status, caller_number, called_number,
                started_at, ended_at, duration_seconds, recording_url, outcome, sentiment
         FROM conversations
         ${where}
         ORDER BY started_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      // Hydrate tenant names so the UI doesn't need a second round-trip per row.
      const tenantIds = Array.from(new Set(rows.rows.map((r: any) => r.tenant_id).filter(Boolean)));
      const tenantNames = new Map<string, string>();
      if (tenantIds.length) {
        const tn = await pool.query(`SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds]);
        tn.rows.forEach((r: any) => tenantNames.set(r.id, r.name));
      }

      res.json({
        total: Number(total.rows[0].count),
        data: rows.rows.map((r: any) => ({ ...r, tenant_name: tenantNames.get(r.tenant_id) || null })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 8. Call detail ──────────────────────────────────────────────────────
  router.get('/calls/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const { id } = req.params;

      const conv = await convPool.query(`SELECT * FROM conversations WHERE id = $1`, [id]);
      if (conv.rows.length === 0) {
        res.status(404).json({ error: 'Call not found' });
        return;
      }
      const messages = await convPool.query(
        `SELECT id, role, content, audio_url, tokens_used, latency_ms, created_at
         FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [id],
      );

      const tenant = conv.rows[0].tenant_id
        ? await pool.query(`SELECT id, name, slug FROM tenants WHERE id = $1`, [conv.rows[0].tenant_id])
        : { rows: [] };

      res.json({
        conversation: conv.rows[0],
        tenant: tenant.rows[0] || null,
        messages: messages.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 9. Agents list (cross-tenant) ───────────────────────────────────────
  router.get('/agents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const agPool = agentPool();
      const convPool = conversationPool();
      const { limit, offset } = pageParams(req);
      const tenantId = String(req.query.tenant_id || '').trim();
      const status = String(req.query.status || '').trim();
      const search = String(req.query.search || '').trim();

      const wheres: string[] = [];
      const params: any[] = [];
      if (tenantId) {
        params.push(tenantId);
        wheres.push(`tenant_id = $${params.length}`);
      }
      if (status && status !== 'all') {
        params.push(status.toUpperCase());
        wheres.push(`status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        wheres.push(`name ILIKE $${params.length}`);
      }
      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

      const total = await agPool.query(`SELECT COUNT(*) FROM agents ${where}`, params);
      params.push(limit);
      params.push(offset);
      const rows = await agPool.query(
        `SELECT id, tenant_id, name, status, direction, llm_provider, llm_model,
                cost_per_min::float8 AS cost_per_min, created_at, updated_at
         FROM agents ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      const ids = rows.rows.map((r: any) => r.id);
      const callsByAgent = new Map<string, number>();
      if (ids.length) {
        const cs = await convPool.query(
          `SELECT agent_id, COUNT(*)::int AS n FROM conversations
           WHERE agent_id = ANY($1::uuid[]) GROUP BY agent_id`,
          [ids],
        );
        cs.rows.forEach((r: any) => callsByAgent.set(r.agent_id, Number(r.n)));
      }

      const tenantIds = Array.from(new Set(rows.rows.map((r: any) => r.tenant_id).filter(Boolean)));
      const tenantNames = new Map<string, string>();
      if (tenantIds.length) {
        const tn = await pool.query(`SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds]);
        tn.rows.forEach((r: any) => tenantNames.set(r.id, r.name));
      }

      res.json({
        total: Number(total.rows[0].count),
        data: rows.rows.map((r: any) => ({
          ...r,
          tenant_name: tenantNames.get(r.tenant_id) || null,
          total_calls: callsByAgent.get(r.id) ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 10. Billing overview ────────────────────────────────────────────────
  router.get('/billing', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const totals = await pool.query(`
        SELECT
          COALESCE(SUM(balance), 0)::float8 AS total_balance,
          COUNT(*) AS wallet_count,
          COUNT(*) FILTER (WHERE balance < low_balance_threshold) AS low_count
        FROM wallets
      `);
      const top = await pool.query(`
        SELECT w.tenant_id, t.name AS tenant_name, w.balance::float8 AS balance, w.currency
        FROM wallets w
        LEFT JOIN tenants t ON t.id = w.tenant_id
        WHERE t.slug <> '__platform__' OR t.id IS NULL
        ORDER BY w.balance DESC
        LIMIT 10
      `);
      const recent = await pool.query(`
        SELECT wt.id, wt.tenant_id, t.name AS tenant_name, wt.amount::float8 AS amount,
               wt.type, wt.reason, wt.balance_after::float8 AS balance_after, wt.created_at
        FROM wallet_transactions wt
        LEFT JOIN tenants t ON t.id = wt.tenant_id
        ORDER BY wt.created_at DESC
        LIMIT 25
      `);
      const planDist = await pool.query(`
        SELECT plan, COUNT(*) AS count FROM tenants
        WHERE slug <> '__platform__'
        GROUP BY plan ORDER BY count DESC
      `);

      res.json({
        totals: totals.rows[0],
        top_wallets: top.rows,
        recent_transactions: recent.rows,
        plan_distribution: planDist.rows.map((r: any) => ({ plan: r.plan, count: Number(r.count) })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 11. Wallet adjust (credit / debit) ──────────────────────────────────
  const adjustSchema = z.object({
    tenant_id: z.string().uuid(),
    amount: z.number().positive(),
    type: z.enum(['credit', 'debit']),
    reason: z.string().min(1).max(500),
  });
  router.post('/wallet/adjust', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const data = adjustSchema.parse(req.body);
      await ensureWallet(pool, data.tenant_id);

      const result = data.type === 'credit'
        ? await creditWallet(pool, data.tenant_id, data.amount, {
            reason: `[super-admin] ${data.reason}`,
            reference_type: 'super_admin_adjust',
            metadata: { admin_user_id: (req as any).userId, admin_email: (req as any).email },
          })
        : await debitWallet(pool, data.tenant_id, data.amount, {
            reason: `[super-admin] ${data.reason}`,
            reference_type: 'super_admin_adjust',
            allow_negative: true,
            metadata: { admin_user_id: (req as any).userId, admin_email: (req as any).email },
          });

      await recordAction(pool, req, `wallet.${data.type}`, 'billing', {
        targetTenantId: data.tenant_id,
        targetResourceType: 'wallet',
        payload: { amount: data.amount, reason: data.reason, balance_after: result.balance_after },
      });
      void dispatchWebhooks(pool, data.type === 'credit' ? 'wallet.credit' : 'wallet.debit', {
        tenant_id: data.tenant_id, amount: data.amount, reason: data.reason,
        balance_after: result.balance_after,
      });

      res.json({ result });
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        res.status(400).json({ error: 'Validation failed', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // ── 12. Tenant wallet detail (transactions for one tenant) ──────────────
  router.get('/tenants/:id/wallet', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;
      const wallet = await ensureWallet(pool, id);
      const txs = await listTransactions(pool, id, 100);
      res.json({ wallet, transactions: txs });
    } catch (err) {
      next(err);
    }
  });

  // ── 13. Audit log ───────────────────────────────────────────────────────
  router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { limit, offset } = pageParams(req);
      const moduleFilter = String(req.query.module || '').trim();
      const adminFilter = String(req.query.admin || '').trim();
      const targetTenantFilter = String(req.query.target_tenant_id || '').trim();

      const wheres: string[] = [];
      const params: any[] = [];
      if (moduleFilter && moduleFilter !== 'all') {
        params.push(moduleFilter);
        wheres.push(`module = $${params.length}`);
      }
      if (adminFilter) {
        params.push(`%${adminFilter}%`);
        wheres.push(`admin_email ILIKE $${params.length}`);
      }
      if (targetTenantFilter) {
        params.push(targetTenantFilter);
        wheres.push(`target_tenant_id = $${params.length}`);
      }
      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

      const total = await pool.query(`SELECT COUNT(*) FROM super_admin_actions ${where}`, params);
      params.push(limit);
      params.push(offset);
      const rows = await pool.query(
        `SELECT a.*, t.name AS target_tenant_name
         FROM super_admin_actions a
         LEFT JOIN tenants t ON t.id = a.target_tenant_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      res.json({
        total: Number(total.rows[0].count),
        data: rows.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 14. Integration health (env-key presence + summary) ─────────────────
  router.get('/integrations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;

      // Provider environment presence — quick "is the platform-level key set"
      // signal. Doesn't make a network call; that's a TODO for Phase 2.
      const providers = [
        { key: 'PLIVO_AUTH_TOKEN', name: 'Plivo', category: 'telephony' },
        { key: 'TWILIO_AUTH_TOKEN', name: 'Twilio', category: 'telephony' },
        { key: 'EXOTEL_API_TOKEN', name: 'Exotel', category: 'telephony' },
        { key: 'DEEPGRAM_API_KEY', name: 'Deepgram', category: 'stt' },
        { key: 'AZURE_SPEECH_KEY', name: 'Azure Speech', category: 'stt+tts' },
        { key: 'SARVAM_API_KEY', name: 'Sarvam AI', category: 'stt+tts+llm' },
        { key: 'ELEVENLABS_API_KEY', name: 'ElevenLabs', category: 'tts' },
        { key: 'OPENAI_API_KEY', name: 'OpenAI', category: 'llm' },
        { key: 'ANTHROPIC_API_KEY', name: 'Anthropic', category: 'llm' },
        { key: 'GOOGLE_API_KEY', name: 'Google AI', category: 'llm' },
      ].map((p) => ({
        ...p,
        configured: !!process.env[p.key],
      }));

      // Per-tenant integration installs (rows in identity_db.integrations).
      const installs = await pool.query(`
        SELECT provider, COUNT(*) AS install_count,
               COUNT(*) FILTER (WHERE enabled = true) AS enabled_count,
               COUNT(*) FILTER (WHERE test_status = 'ok') AS healthy_count,
               COUNT(*) FILTER (WHERE test_status = 'error') AS error_count
        FROM integrations
        GROUP BY provider
        ORDER BY install_count DESC
      `);

      res.json({
        providers,
        tenant_installs: installs.rows.map((r: any) => ({
          provider: r.provider,
          install_count: Number(r.install_count),
          enabled_count: Number(r.enabled_count),
          healthy_count: Number(r.healthy_count),
          error_count: Number(r.error_count),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 15. Tenant timeseries (calls/day, signups/day, txs/day for 30 days) ─
  router.get('/tenants/:id/timeseries', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;
      const convPool = conversationPool();

      const [calls, signups, txs] = await Promise.all([
        convPool.query(
          `SELECT date_trunc('day', started_at)::date AS day, COUNT(*) AS n,
                  COALESCE(SUM(duration_seconds), 0)::bigint AS seconds
           FROM conversations
           WHERE tenant_id = $1 AND started_at >= CURRENT_DATE - INTERVAL '29 days'
           GROUP BY 1 ORDER BY 1`,
          [id],
        ),
        pool.query(
          `SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS n
           FROM users WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '29 days'
           GROUP BY 1 ORDER BY 1`,
          [id],
        ),
        pool.query(
          `SELECT date_trunc('day', created_at)::date AS day,
                  COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END), 0)::float8 AS credit,
                  COALESCE(SUM(CASE WHEN type='debit'  THEN amount ELSE 0 END), 0)::float8 AS debit,
                  COUNT(*) AS n
           FROM wallet_transactions
           WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '29 days'
           GROUP BY 1 ORDER BY 1`,
          [id],
        ),
      ]);

      res.json({
        calls: calls.rows.map((r: any) => ({ day: r.day, count: Number(r.n), minutes: Math.round(Number(r.seconds) / 60) })),
        signups: signups.rows.map((r: any) => ({ day: r.day, count: Number(r.n) })),
        transactions: txs.rows.map((r: any) => ({ day: r.day, credit: Number(r.credit), debit: Number(r.debit), count: Number(r.n) })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 16. Per-tenant users (paginated, with activity aggregates) ──────────
  router.get('/tenants/:id/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();
      const { id } = req.params;
      const { limit, offset } = pageParams(req);

      const total = await pool.query(`SELECT COUNT(*) FROM users WHERE tenant_id = $1`, [id]);
      const rows = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.status, u.email_verified,
                u.is_platform_admin, u.last_login_at, u.created_at, u.updated_at,
                COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles,
                (SELECT COUNT(*) FROM refresh_tokens rt WHERE rt.user_id = u.id) AS login_count
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1
         GROUP BY u.id
         ORDER BY u.created_at ASC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );

      // Per-user activity: how many calls have they participated in (as the
      // creator of an agent that took the call) and how many agents do they own.
      const userIds = rows.rows.map((r: any) => r.id);
      const agentsByUser = new Map<string, number>();
      const callsByUser = new Map<string, number>();
      if (userIds.length) {
        const ag = await agPool.query(
          `SELECT created_by, COUNT(*)::int AS n FROM agents
           WHERE created_by = ANY($1::uuid[]) GROUP BY created_by`,
          [userIds],
        );
        ag.rows.forEach((r: any) => agentsByUser.set(r.created_by, Number(r.n)));
        // Calls handled = calls on agents this user created (best-proxy without per-message attribution).
        const cs = await agPool.query(
          `SELECT created_by, id FROM agents WHERE created_by = ANY($1::uuid[])`,
          [userIds],
        );
        const agentToUser = new Map<string, string>();
        cs.rows.forEach((r: any) => agentToUser.set(r.id, r.created_by));
        if (agentToUser.size) {
          const calls = await convPool.query(
            `SELECT agent_id, COUNT(*)::int AS n FROM conversations
             WHERE agent_id = ANY($1::uuid[]) GROUP BY agent_id`,
            [Array.from(agentToUser.keys())],
          );
          calls.rows.forEach((r: any) => {
            const u = agentToUser.get(r.agent_id);
            if (u) callsByUser.set(u, (callsByUser.get(u) ?? 0) + Number(r.n));
          });
        }
      }

      res.json({
        total: Number(total.rows[0].count),
        data: rows.rows.map((u: any) => ({
          ...u,
          login_count: Number(u.login_count),
          agents_owned: agentsByUser.get(u.id) ?? 0,
          calls_via_owned_agents: callsByUser.get(u.id) ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 17. Per-tenant calls (paginated) ────────────────────────────────────
  router.get('/tenants/:id/calls', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const convPool = conversationPool();
      const { id } = req.params;
      const { limit, offset } = pageParams(req);
      const total = await convPool.query(`SELECT COUNT(*) FROM conversations WHERE tenant_id = $1`, [id]);
      const rows = await convPool.query(
        `SELECT id, agent_id, channel, status, caller_number, called_number,
                started_at, ended_at, duration_seconds, recording_url, outcome, sentiment
         FROM conversations
         WHERE tenant_id = $1
         ORDER BY started_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      res.json({ total: Number(total.rows[0].count), data: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  // ── 18. Per-tenant agents (paginated) ───────────────────────────────────
  router.get('/tenants/:id/agents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agPool = agentPool();
      const convPool = conversationPool();
      const { id } = req.params;
      const { limit, offset } = pageParams(req);
      const total = await agPool.query(`SELECT COUNT(*) FROM agents WHERE tenant_id = $1`, [id]);
      const rows = await agPool.query(
        `SELECT id, name, status, direction, llm_provider, llm_model,
                cost_per_min::float8 AS cost_per_min, created_by, created_at, updated_at
         FROM agents WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      const ids = rows.rows.map((r: any) => r.id);
      const callMap = new Map<string, number>();
      if (ids.length) {
        const cs = await convPool.query(
          `SELECT agent_id, COUNT(*)::int AS n FROM conversations
           WHERE agent_id = ANY($1::uuid[]) GROUP BY agent_id`,
          [ids],
        );
        cs.rows.forEach((r: any) => callMap.set(r.agent_id, Number(r.n)));
      }
      res.json({
        total: Number(total.rows[0].count),
        data: rows.rows.map((r: any) => ({ ...r, total_calls: callMap.get(r.id) ?? 0 })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 19. Per-tenant resources (workflows, KB, phone, integrations, keys) ─
  router.get('/tenants/:id/resources', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const wfPool = workflowPool();
      const kbPool = knowledgePool();
      const { id } = req.params;

      const [workflows, knowledgeBases, phones, integrations, apiKeys, subscription] = await Promise.all([
        wfPool.query(
          `SELECT id, name, is_active, created_at, updated_at FROM workflows WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [id],
        ).catch(() => ({ rows: [] })),
        // knowledge_bases uses organization_id as text — match the tenant id string.
        kbPool.query(
          `SELECT id, name, document_count, created_at FROM knowledge_bases WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [id],
        ).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT id, number, country, provider, monthly_cost::float8 AS monthly_cost, status, agent_id,
                  next_renewal_date, last_charged_at
           FROM phone_number_rentals WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [id],
        ),
        pool.query(
          `SELECT id, provider, enabled, test_status, test_message, last_tested_at, connected_at
           FROM integrations WHERE tenant_id = $1 ORDER BY connected_at DESC`,
          [id],
        ),
        pool.query(
          `SELECT id, name, key_prefix, last_used_at, created_at, revoked_at
           FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [id],
        ),
        pool.query(
          `SELECT id, plan_id, plan_name, price::float8 AS price, currency, billing_cycle, status,
                  auto_renew, current_period_start, next_renewal_date, cancel_at_period_end,
                  canceled_at, created_at
           FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [id],
        ),
      ]);

      res.json({
        workflows: workflows.rows,
        knowledge_bases: knowledgeBases.rows,
        phone_numbers: phones.rows,
        integrations: integrations.rows,
        api_keys: apiKeys.rows,
        subscriptions: subscription.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 20. Per-tenant audit log (HTTP-level audit_log table) ───────────────
  router.get('/tenants/:id/audit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;
      const { limit, offset } = pageParams(req);
      const total = await pool.query(`SELECT COUNT(*) FROM audit_log WHERE tenant_id = $1`, [id]);
      const rows = await pool.query(
        `SELECT id, user_id, user_email, action, resource_type, resource_id,
                method, path, status_code, ip, user_agent, metadata, created_at
         FROM audit_log
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      res.json({ total: Number(total.rows[0].count), data: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  // ── 21. Per-tenant billing history ──────────────────────────────────────
  router.get('/tenants/:id/billing-history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const { id } = req.params;
      const { limit, offset } = pageParams(req);

      const [wallet, txs, subs, invoices] = await Promise.all([
        pool.query(
          `SELECT id, balance::float8 AS balance, currency, low_balance_threshold::float8 AS low_balance_threshold,
                  created_at, updated_at FROM wallets WHERE tenant_id = $1`,
          [id],
        ),
        pool.query(
          `SELECT id, amount::float8 AS amount, type, reason, reference_type, reference_id,
                  balance_after::float8 AS balance_after, metadata, created_at
           FROM wallet_transactions WHERE tenant_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [id, limit, offset],
        ),
        pool.query(
          `SELECT id, plan_id, plan_name, price::float8 AS price, billing_cycle, status, auto_renew,
                  current_period_start, next_renewal_date, canceled_at, created_at
           FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [id],
        ),
        pool.query(
          `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [id],
        ).catch(() => ({ rows: [] })),
      ]);

      const total = await pool.query(`SELECT COUNT(*) FROM wallet_transactions WHERE tenant_id = $1`, [id]);

      res.json({
        wallet: wallet.rows[0] || null,
        transactions: { total: Number(total.rows[0].count), data: txs.rows },
        subscriptions: subs.rows,
        invoices: invoices.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 22. Synthetic activity feed for one tenant ──────────────────────────
  // Combines events from every DB into a unified timeline. Fills the gap
  // until the audit middleware is mounted on every microservice — for now
  // every observable change in any DB row IS captured by sweeping this view.
  router.get('/tenants/:id/activity', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();
      const { id } = req.params;
      const limit = Math.min(200, Math.max(20, parseInt(String(req.query.limit || '100'), 10)));

      const [logins, audits, calls, agentChanges, txs, integrations] = await Promise.all([
        pool.query(
          `SELECT rt.created_at, u.email, u.id AS user_id
           FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           WHERE u.tenant_id = $1
           ORDER BY rt.created_at DESC LIMIT $2`,
          [id, limit],
        ),
        pool.query(
          `SELECT created_at, action, resource_type, resource_id, user_email, ip, status_code, method, path
           FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [id, limit],
        ),
        convPool.query(
          `SELECT id, started_at, channel, status, caller_number, called_number, agent_id, duration_seconds
           FROM conversations WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2`,
          [id, limit],
        ),
        agPool.query(
          `SELECT id, name, status, created_at, updated_at, created_by
           FROM agents WHERE tenant_id = $1 ORDER BY GREATEST(created_at, updated_at) DESC LIMIT $2`,
          [id, limit],
        ),
        pool.query(
          `SELECT id, amount::float8 AS amount, type, reason, balance_after::float8 AS balance_after, created_at
           FROM wallet_transactions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [id, limit],
        ),
        pool.query(
          `SELECT id, provider, enabled, test_status, last_tested_at, connected_at, updated_at
           FROM integrations WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT $2`,
          [id, limit],
        ),
      ]);

      type Event = { ts: string; kind: string; summary: string; meta: Record<string, unknown> };
      const events: Event[] = [];

      logins.rows.forEach((r: any) => events.push({
        ts: r.created_at, kind: 'login', summary: `${r.email} signed in`,
        meta: { user_id: r.user_id, email: r.email },
      }));
      audits.rows.forEach((r: any) => events.push({
        ts: r.created_at, kind: 'audit',
        summary: `${r.user_email || 'system'}: ${r.action} ${r.resource_type || ''}${r.resource_id ? ` (${String(r.resource_id).slice(0, 8)})` : ''}`,
        meta: { method: r.method, path: r.path, ip: r.ip, status_code: r.status_code },
      }));
      calls.rows.forEach((r: any) => events.push({
        ts: r.started_at, kind: 'call',
        summary: `${r.channel || 'CALL'} ${r.caller_number || '—'} → ${r.called_number || '—'} (${r.status})`,
        meta: { call_id: r.id, agent_id: r.agent_id, duration_seconds: r.duration_seconds },
      }));
      agentChanges.rows.forEach((r: any) => {
        const isNew = new Date(r.created_at).getTime() === new Date(r.updated_at).getTime();
        events.push({
          ts: r.updated_at, kind: isNew ? 'agent_create' : 'agent_update',
          summary: `agent ${isNew ? 'created' : 'updated'}: ${r.name} (${r.status})`,
          meta: { agent_id: r.id, created_by: r.created_by },
        });
      });
      txs.rows.forEach((r: any) => events.push({
        ts: r.created_at, kind: `wallet_${r.type}`,
        summary: `wallet ${r.type === 'credit' ? '+' : '−'}₹${r.amount.toFixed(2)} — ${r.reason}`,
        meta: { tx_id: r.id, balance_after: r.balance_after },
      }));
      integrations.rows.forEach((r: any) => events.push({
        ts: r.updated_at || r.connected_at, kind: 'integration',
        summary: `integration ${r.provider} ${r.enabled ? 'enabled' : 'disabled'} (${r.test_status || 'unknown'})`,
        meta: { provider: r.provider, last_tested_at: r.last_tested_at },
      }));

      events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      res.json({ events: events.slice(0, limit) });
    } catch (err) {
      next(err);
    }
  });

  // ── 23. Per-user activity ───────────────────────────────────────────────
  router.get('/users/:id/activity', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();
      const { id } = req.params;

      const userRow = await pool.query(
        `SELECT u.id, u.tenant_id, u.email, u.first_name, u.last_name, u.phone, u.status,
                u.email_verified, u.is_platform_admin, u.last_login_at, u.created_at,
                t.name AS tenant_name, t.slug AS tenant_slug,
                COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1
         GROUP BY u.id, t.name, t.slug`,
        [id],
      );
      if (userRow.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const user = userRow.rows[0];

      const [logins, audits, agentsOwned, callCount] = await Promise.all([
        pool.query(
          `SELECT created_at, expires_at, revoked FROM refresh_tokens
           WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
          [id],
        ),
        pool.query(
          `SELECT created_at, action, resource_type, resource_id, method, path, status_code, ip
           FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [id],
        ),
        agPool.query(
          `SELECT id, name, status, direction, created_at, updated_at
           FROM agents WHERE created_by = $1 ORDER BY created_at DESC LIMIT 50`,
          [id],
        ),
        agPool.query(
          `SELECT id FROM agents WHERE created_by = $1`,
          [id],
        ),
      ]);

      // Calls via this user's agents
      const agentIds = callCount.rows.map((r: any) => r.id);
      let callsHandled = 0;
      let recentCalls: any[] = [];
      if (agentIds.length) {
        const c = await convPool.query(
          `SELECT COUNT(*)::int AS n FROM conversations WHERE agent_id = ANY($1::uuid[])`,
          [agentIds],
        );
        callsHandled = Number(c.rows[0].n);
        const rc = await convPool.query(
          `SELECT id, started_at, channel, status, caller_number, called_number, duration_seconds
           FROM conversations WHERE agent_id = ANY($1::uuid[])
           ORDER BY started_at DESC LIMIT 25`,
          [agentIds],
        );
        recentCalls = rc.rows;
      }

      res.json({
        user,
        login_history: logins.rows,
        audit_trail: audits.rows,
        agents_owned: agentsOwned.rows,
        stats: { calls_handled: callsHandled, agents_owned: agentsOwned.rows.length },
        recent_calls_via_agents: recentCalls,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 24. Global activity feed (firehose across all tenants) ──────────────
  router.get('/activity-feed', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const limit = Math.min(200, Math.max(20, parseInt(String(req.query.limit || '100'), 10)));
      const sinceHours = Math.min(168, Math.max(1, parseInt(String(req.query.hours || '24'), 10)));
      const sinceClause = `>= now() - INTERVAL '${sinceHours} hours'`;

      const tenantNames = new Map<string, string>();
      const fetchTenantNames = async (ids: string[]) => {
        const missing = ids.filter((i) => i && !tenantNames.has(i));
        if (!missing.length) return;
        const r = await pool.query(`SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`, [missing]);
        r.rows.forEach((row: any) => tenantNames.set(row.id, row.name));
      };

      const [logins, audits, calls, txs] = await Promise.all([
        pool.query(
          `SELECT rt.created_at, u.id AS user_id, u.email, u.tenant_id
           FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
           WHERE rt.created_at ${sinceClause}
           ORDER BY rt.created_at DESC LIMIT $1`,
          [limit],
        ),
        pool.query(
          `SELECT created_at, tenant_id, user_email, action, resource_type, resource_id, ip, status_code
           FROM audit_log WHERE created_at ${sinceClause}
           ORDER BY created_at DESC LIMIT $1`,
          [limit],
        ),
        convPool.query(
          `SELECT id, started_at, tenant_id, channel, status, caller_number, called_number, duration_seconds
           FROM conversations WHERE started_at ${sinceClause}
           ORDER BY started_at DESC LIMIT $1`,
          [limit],
        ),
        pool.query(
          `SELECT id, created_at, tenant_id, amount::float8 AS amount, type, reason, balance_after::float8 AS balance_after
           FROM wallet_transactions WHERE created_at ${sinceClause}
           ORDER BY created_at DESC LIMIT $1`,
          [limit],
        ),
      ]);

      await fetchTenantNames([
        ...logins.rows.map((r: any) => r.tenant_id),
        ...audits.rows.map((r: any) => r.tenant_id),
        ...calls.rows.map((r: any) => r.tenant_id),
        ...txs.rows.map((r: any) => r.tenant_id),
      ]);

      type Event = { ts: string; kind: string; tenant_id: string | null; tenant_name: string | null; summary: string; meta: Record<string, unknown> };
      const events: Event[] = [];

      logins.rows.forEach((r: any) => events.push({
        ts: r.created_at, kind: 'login', tenant_id: r.tenant_id, tenant_name: tenantNames.get(r.tenant_id) || null,
        summary: `${r.email} signed in`,
        meta: { user_id: r.user_id, email: r.email },
      }));
      audits.rows.forEach((r: any) => events.push({
        ts: r.created_at, kind: 'audit', tenant_id: r.tenant_id, tenant_name: tenantNames.get(r.tenant_id) || null,
        summary: `${r.user_email || 'system'}: ${r.action} ${r.resource_type || ''}`,
        meta: { ip: r.ip, status_code: r.status_code },
      }));
      calls.rows.forEach((r: any) => events.push({
        ts: r.started_at, kind: 'call', tenant_id: r.tenant_id, tenant_name: tenantNames.get(r.tenant_id) || null,
        summary: `${r.channel} ${r.caller_number || '—'} → ${r.called_number || '—'} (${r.status})`,
        meta: { call_id: r.id, duration_seconds: r.duration_seconds },
      }));
      txs.rows.forEach((r: any) => events.push({
        ts: r.created_at, kind: `wallet_${r.type}`, tenant_id: r.tenant_id, tenant_name: tenantNames.get(r.tenant_id) || null,
        summary: `wallet ${r.type === 'credit' ? '+' : '−'}₹${r.amount.toFixed(2)} — ${r.reason}`,
        meta: { tx_id: r.id, balance_after: r.balance_after },
      }));

      events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      res.json({ events: events.slice(0, limit), since_hours: sinceHours });
    } catch (err) {
      next(err);
    }
  });

  // ── 25. Calls aggregations (analytics strip on /super-admin/calls) ──────
  // Mounted under /stats/* so Express doesn't try to match /calls/stats against
  // the earlier /calls/:id route (which would interpret "stats" as a UUID).
  router.get('/stats/calls', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const convPool = conversationPool();
      const [today, yesterday, week, byStatus, byChannel, top] = await Promise.all([
        convPool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(duration_seconds),0)::bigint s FROM conversations WHERE started_at >= CURRENT_DATE`),
        convPool.query(`SELECT COUNT(*)::int n FROM conversations WHERE started_at >= CURRENT_DATE - INTERVAL '1 day' AND started_at < CURRENT_DATE`),
        convPool.query(`SELECT COUNT(*)::int n FROM conversations WHERE started_at >= CURRENT_DATE - INTERVAL '7 days'`),
        convPool.query(`SELECT status, COUNT(*)::int n FROM conversations WHERE started_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY status`),
        convPool.query(`SELECT channel, COUNT(*)::int n FROM conversations WHERE started_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY channel`),
        convPool.query(`SELECT tenant_id, COUNT(*)::int n FROM conversations WHERE started_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY tenant_id ORDER BY n DESC LIMIT 5`),
      ]);
      res.json({
        today: { count: today.rows[0].n, minutes: Math.round(Number(today.rows[0].s) / 60) },
        yesterday: { count: yesterday.rows[0].n },
        last7days: { count: week.rows[0].n },
        by_status: byStatus.rows,
        by_channel: byChannel.rows,
        top_tenants_7d: top.rows,
      });
    } catch (err) { next(err); }
  });

  // ── 26. Tenant aggregations (analytics strip on /super-admin/tenants) ───
  router.get('/stats/tenants', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const [counts, planDist, newToday, newWeek, walletAgg] = await Promise.all([
        pool.query(`SELECT COUNT(*) FILTER (WHERE is_active=true) active, COUNT(*) FILTER (WHERE is_active=false) suspended FROM tenants WHERE slug <> '__platform__'`),
        pool.query(`SELECT plan, COUNT(*)::int n FROM tenants WHERE slug <> '__platform__' GROUP BY plan ORDER BY n DESC`),
        pool.query(`SELECT COUNT(*)::int n FROM tenants WHERE created_at >= CURRENT_DATE AND slug <> '__platform__'`),
        pool.query(`SELECT COUNT(*)::int n FROM tenants WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' AND slug <> '__platform__'`),
        pool.query(`SELECT COALESCE(SUM(balance),0)::float8 total, AVG(balance)::float8 avg, COUNT(*)::int n FROM wallets`),
      ]);
      res.json({
        active: Number(counts.rows[0].active),
        suspended: Number(counts.rows[0].suspended),
        new_today: newToday.rows[0].n,
        new_week: newWeek.rows[0].n,
        plan_distribution: planDist.rows,
        wallet: { total: walletAgg.rows[0].total, avg: walletAgg.rows[0].avg, count: walletAgg.rows[0].n },
      });
    } catch (err) { next(err); }
  });

  // ── F1: Global search ───────────────────────────────────────────────────
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();
      const q = String(req.query.q || '').trim();
      if (q.length < 2) { res.json({ results: [] }); return; }
      const isUuid = /^[a-f0-9-]{6,36}$/i.test(q);
      const like = `%${q}%`;
      const results: any[] = [];

      const [tenants, users, calls, agents] = await Promise.all([
        pool.query(
          `SELECT id, name, slug, plan, is_active FROM tenants
           WHERE slug <> '__platform__' AND (name ILIKE $1 OR slug ILIKE $1 OR id::text ILIKE $1)
           LIMIT 5`, [like],
        ),
        pool.query(
          `SELECT id, tenant_id, email, first_name, last_name, phone FROM users
           WHERE email ILIKE $1 OR phone ILIKE $1 OR id::text ILIKE $1
           LIMIT 5`, [like],
        ),
        isUuid ? convPool.query(
          `SELECT id, tenant_id, channel, status, started_at, caller_number, called_number FROM conversations
           WHERE id::text ILIKE $1 OR caller_number ILIKE $1 OR called_number ILIKE $1
           ORDER BY started_at DESC LIMIT 5`, [like],
        ) : convPool.query(
          `SELECT id, tenant_id, channel, status, started_at, caller_number, called_number FROM conversations
           WHERE caller_number ILIKE $1 OR called_number ILIKE $1
           ORDER BY started_at DESC LIMIT 5`, [like],
        ),
        agPool.query(
          `SELECT id, tenant_id, name, status FROM agents
           WHERE name ILIKE $1 OR id::text ILIKE $1
           LIMIT 5`, [like],
        ),
      ]);
      tenants.rows.forEach((r) => results.push({ kind: 'tenant', id: r.id, label: r.name, sub: `${r.slug} · ${r.plan}`, href: `/super-admin/tenants/${r.id}` }));
      users.rows.forEach((r) => results.push({ kind: 'user', id: r.id, label: `${r.first_name} ${r.last_name}`.trim() || r.email, sub: r.email, href: `/super-admin/users/${r.id}` }));
      calls.rows.forEach((r) => results.push({ kind: 'call', id: r.id, label: `${r.caller_number || '—'} → ${r.called_number || '—'}`, sub: `${r.channel} · ${r.status} · ${new Date(r.started_at).toLocaleDateString()}`, href: `/super-admin/calls/${r.id}` }));
      agents.rows.forEach((r) => results.push({ kind: 'agent', id: r.id, label: r.name, sub: `agent · ${r.status}`, href: `/super-admin/agents?tenant_id=${r.tenant_id}` }));

      res.json({ results });
    } catch (err) { next(err); }
  });

  // ── F3: Failed-call grouping (with full detail per row) ─────────────────
  router.get('/calls-failed/grouped', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();
      const since = String(req.query.since || '');
      const sinceClause = since ? `AND started_at >= '${since}'` : `AND started_at >= now() - INTERVAL '7 days'`;

      const [byTenant, byOutcome, byAgent, sample] = await Promise.all([
        convPool.query(`SELECT tenant_id, COUNT(*)::int n FROM conversations WHERE status = 'FAILED' ${sinceClause} GROUP BY tenant_id ORDER BY n DESC LIMIT 10`),
        convPool.query(`SELECT COALESCE(NULLIF(outcome,''),'(no outcome)') outcome, COUNT(*)::int n FROM conversations WHERE status = 'FAILED' ${sinceClause} GROUP BY 1 ORDER BY n DESC LIMIT 10`),
        convPool.query(`SELECT agent_id, COUNT(*)::int n FROM conversations WHERE status = 'FAILED' AND agent_id IS NOT NULL ${sinceClause} GROUP BY agent_id ORDER BY n DESC LIMIT 10`),
        // Full conversation row + analysis JSONB so the UI can show everything inline
        convPool.query(`
          SELECT id, tenant_id, agent_id, channel, status, language, sentiment,
                 caller_number, called_number, started_at, ended_at, duration_seconds,
                 recording_url, outcome, summary, analysis, metadata, interest_level, topics
          FROM conversations
          WHERE status = 'FAILED' ${sinceClause}
          ORDER BY started_at DESC LIMIT 50
        `),
      ]);

      // Tenant info — name, plan, status, wallet (so the user sees who's affected at a glance)
      const tenantIds = Array.from(new Set([...byTenant.rows, ...sample.rows].map((r: any) => r.tenant_id).filter(Boolean)));
      const tenants = new Map<string, any>();
      if (tenantIds.length) {
        const r = await pool.query(
          `SELECT t.id, t.name, t.slug, t.plan, t.is_active,
                  COALESCE(w.balance, 0)::float8 AS wallet_balance
           FROM tenants t
           LEFT JOIN wallets w ON w.tenant_id = t.id
           WHERE t.id = ANY($1::uuid[])`,
          [tenantIds],
        );
        r.rows.forEach((x: any) => tenants.set(x.id, x));
      }

      // Agent info — name, LLM provider/model, voice config so the user can identify the agent
      const agentIds = Array.from(new Set([...byAgent.rows, ...sample.rows].map((r: any) => r.agent_id).filter(Boolean)));
      const agents = new Map<string, any>();
      if (agentIds.length) {
        const r = await agPool.query(
          `SELECT id, name, llm_provider, llm_model, direction, status, voice_config
           FROM agents WHERE id = ANY($1::uuid[])`,
          [agentIds],
        );
        r.rows.forEach((x: any) => agents.set(x.id, x));
      }

      // Compute a human "why it failed" label per row from outcome + duration + analysis.
      // Pure derivation — no DB write, no extra round-trip.
      const classify = (r: any): { reason: string; severity: 'info' | 'warning' | 'critical' } => {
        const out = (r.outcome || '').toLowerCase();
        const dur = Number(r.duration_seconds || 0);
        const analysis = r.analysis || {};
        const risks: string[] = analysis.quality_risks || [];

        if (out === 'no-answer' || out === 'no_answer')             return { reason: 'Caller did not answer', severity: 'info' };
        if (out === 'dropped' || out === 'caller_hangup')            return { reason: 'Caller hung up', severity: 'warning' };
        if (out === 'voicemail')                                     return { reason: 'Reached voicemail', severity: 'info' };
        if (out === 'transferred')                                   return { reason: 'Transferred to human (incomplete)', severity: 'info' };
        if (out === 'busy')                                          return { reason: 'Line busy', severity: 'info' };
        if (out === 'cancelled' || out === 'canceled')               return { reason: 'Call cancelled before connect', severity: 'info' };
        if (dur === 0)                                               return { reason: 'Never connected (provider/network error)', severity: 'critical' };
        if (dur < 5)                                                 return { reason: `Disconnected after ${dur}s — likely no signal / wrong number`, severity: 'warning' };
        if (risks.length)                                            return { reason: `Quality risk: ${risks[0]}`, severity: 'warning' };
        if (out)                                                     return { reason: `Marked '${out}' by post-call analyzer`, severity: 'warning' };
        return { reason: 'Failed without explicit reason — check transcript', severity: 'warning' };
      };

      const total = byOutcome.rows.reduce((s: number, r: any) => s + r.n, 0);

      res.json({
        total_failed: total,
        by_tenant: byTenant.rows.map((r: any) => ({
          ...r, tenant_name: tenants.get(r.tenant_id)?.name || null,
        })),
        by_outcome: byOutcome.rows,
        by_agent: byAgent.rows.map((r: any) => ({
          ...r, agent_name: agents.get(r.agent_id)?.name || null,
        })),
        sample: sample.rows.map((r: any) => {
          const t = tenants.get(r.tenant_id);
          const a = agents.get(r.agent_id);
          const c = classify(r);
          // Strip noisy / large fields out of the analysis blob for transport — keep the
          // human-useful keys. Full analysis is still available on the call detail page.
          const a_full = r.analysis || {};
          const a_lite = {
            short_summary:    a_full.short_summary,
            sentiment:        a_full.sentiment,
            interest_level:   a_full.interest_level,
            quality_risks:    a_full.quality_risks,
            agent_performance_notes: a_full.agent_performance_notes,
            next_best_action: a_full.next_best_action,
          };
          return {
            ...r,
            failure_reason: c.reason,
            failure_severity: c.severity,
            tenant: t ? { id: t.id, name: t.name, slug: t.slug, plan: t.plan, is_active: t.is_active, wallet_balance: t.wallet_balance } : null,
            agent: a ? { id: a.id, name: a.name, llm_provider: a.llm_provider, llm_model: a.llm_model, direction: a.direction, status: a.status, voice: a.voice_config } : null,
            analysis: a_lite,
          };
        }),
      });
    } catch (err) { next(err); }
  });

  // ── F4: Tenant health scores (composite) ─────────────────────────────────
  router.get('/health-scores', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      // Per-tenant recent activity rollup
      const tenants = await pool.query(`
        SELECT t.id, t.name, t.is_active,
               COALESCE(w.balance, 0)::float8 AS balance,
               COALESCE(w.low_balance_threshold, 100)::float8 AS low_threshold,
               (SELECT MAX(rt.created_at) FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE u.tenant_id = t.id) AS last_login
        FROM tenants t
        LEFT JOIN wallets w ON w.tenant_id = t.id
        WHERE t.slug <> '__platform__'
      `);
      const ids = tenants.rows.map((r: any) => r.id);
      const callsAgg = ids.length ? await convPool.query(`
        SELECT tenant_id,
          COUNT(*)::int AS calls_7d,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_7d,
          MAX(started_at) AS last_call
        FROM conversations
        WHERE tenant_id = ANY($1::uuid[]) AND started_at >= now() - INTERVAL '7 days'
        GROUP BY tenant_id
      `, [ids]) : { rows: [] };
      const callMap = new Map<string, any>();
      callsAgg.rows.forEach((r: any) => callMap.set(r.tenant_id, r));

      const now = Date.now();
      const scored = tenants.rows.map((t: any) => {
        const c = callMap.get(t.id) || { calls_7d: 0, failed_7d: 0, last_call: null };
        const failureRate = c.calls_7d > 0 ? (c.failed_7d / c.calls_7d) * 100 : 0;
        const daysSinceLogin = t.last_login ? (now - new Date(t.last_login).getTime()) / 86400000 : 999;
        const reasons: string[] = [];
        let score = 100;
        if (!t.is_active)              { score -= 100; reasons.push('suspended'); }
        if (t.balance <= t.low_threshold) { score -= 25; reasons.push('low wallet'); }
        if (t.balance <= 0)            { score -= 25; reasons.push('zero wallet'); }
        if (failureRate > 30)          { score -= 30; reasons.push(`${Math.round(failureRate)}% failure rate`); }
        else if (failureRate > 15)     { score -= 15; reasons.push(`${Math.round(failureRate)}% failure rate`); }
        if (daysSinceLogin > 14)       { score -= 20; reasons.push('no logins in 14d'); }
        else if (daysSinceLogin > 7)   { score -= 10; reasons.push('no logins in 7d'); }
        if (c.calls_7d === 0 && t.is_active) { score -= 10; reasons.push('no calls in 7d'); }
        score = Math.max(0, Math.min(100, score));
        const flag = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
        return {
          tenant_id: t.id, tenant_name: t.name, score, flag, reasons,
          balance: t.balance, calls_7d: c.calls_7d, failed_7d: c.failed_7d,
          failure_rate_pct: Math.round(failureRate),
          days_since_login: Math.round(daysSinceLogin),
        };
      }).sort((a, b) => a.score - b.score);

      res.json({ data: scored });
    } catch (err) { next(err); }
  });

  // ── F5: SSE event stream ────────────────────────────────────────────────
  // Minimal SSE: every 5s, query the last tick's worth of events and push
  // any new ones. Cleaner than a full pub/sub for v1, and the polling burden
  // is tiny (single GROUP BY queries on indexed timestamps).
  router.get('/events/stream', async (req: Request, res: Response) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const pool: Pool = (req as any).pool;
    const convPool = conversationPool();
    let lastSent = new Date();
    res.write(`event: ready\ndata: {}\n\n`);

    const tick = async () => {
      try {
        const now = new Date();
        const [logins, calls, txs] = await Promise.all([
          pool.query(`SELECT rt.created_at, u.email, u.tenant_id FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.created_at > $1 ORDER BY rt.created_at`, [lastSent]),
          convPool.query(`SELECT id, tenant_id, channel, status, caller_number, called_number, started_at FROM conversations WHERE started_at > $1 ORDER BY started_at`, [lastSent]),
          pool.query(`SELECT id, tenant_id, amount::float8 amount, type, reason, created_at FROM wallet_transactions WHERE created_at > $1 ORDER BY created_at`, [lastSent]),
        ]);
        const events = [
          ...logins.rows.map((r: any) => ({ ts: r.created_at, kind: 'login', tenant_id: r.tenant_id, summary: `${r.email} signed in` })),
          ...calls.rows.map((r: any) => ({ ts: r.started_at, kind: 'call', tenant_id: r.tenant_id, summary: `${r.channel} ${r.caller_number || '—'} → ${r.called_number || '—'} (${r.status})` })),
          ...txs.rows.map((r: any) => ({ ts: r.created_at, kind: `wallet_${r.type}`, tenant_id: r.tenant_id, summary: `wallet ${r.type === 'credit' ? '+' : '−'}₹${r.amount.toFixed(2)} — ${r.reason}` })),
        ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        for (const e of events) {
          res.write(`event: activity\ndata: ${JSON.stringify(e)}\n\n`);
        }
        lastSent = now;
        res.write(`: ping ${now.toISOString()}\n\n`); // keep-alive comment
      } catch { /* swallow */ }
    };

    const interval = setInterval(tick, 5000);
    req.on('close', () => clearInterval(interval));
  });

  // ── F6: Anomaly alerts ──────────────────────────────────────────────────
  router.get('/alerts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const open = String(req.query.open || 'true') !== 'false';
      const where = open ? 'WHERE acknowledged = false' : '';
      const r = await pool.query(`
        SELECT a.*, t.name AS tenant_name FROM super_admin_alerts a
        LEFT JOIN tenants t ON t.id = a.tenant_id
        ${where}
        ORDER BY a.created_at DESC LIMIT 100
      `);
      res.json({ data: r.rows });
    } catch (err) { next(err); }
  });
  router.post('/alerts/:id/ack', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      await pool.query(
        `UPDATE super_admin_alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = now() WHERE id = $2`,
        [(req as any).userId, req.params.id],
      );
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
  router.post('/alerts/run-checks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await runAnomalyChecks((req as any).pool);
      res.json(r);
    } catch (err) { next(err); }
  });

  // ── F7: Saved views ─────────────────────────────────────────────────────
  router.get('/saved-views', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const r = await pool.query(`SELECT * FROM super_admin_saved_views WHERE user_id = $1 ORDER BY pinned DESC, created_at DESC`, [(req as any).userId]);
      res.json({ data: r.rows });
    } catch (err) { next(err); }
  });
  router.post('/saved-views', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const schema = z.object({ name: z.string().min(1).max(100), path: z.string().min(1), query: z.string().default(''), pinned: z.boolean().default(false) });
      const data = schema.parse(req.body);
      const r = await pool.query(
        `INSERT INTO super_admin_saved_views (user_id, name, path, query, pinned) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [(req as any).userId, data.name, data.path, data.query, data.pinned],
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { next(err); }
  });
  router.delete('/saved-views/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ((req as any).pool).query(`DELETE FROM super_admin_saved_views WHERE id = $1 AND user_id = $2`, [req.params.id, (req as any).userId]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ── F9: Webhooks CRUD ───────────────────────────────────────────────────
  router.get('/webhooks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await ((req as any).pool).query(`SELECT * FROM super_admin_webhooks ORDER BY created_at DESC`);
      res.json({ data: r.rows });
    } catch (err) { next(err); }
  });
  router.post('/webhooks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(100),
        url: z.string().url(),
        events: z.array(z.string()).min(1),
        secret: z.string().optional(),
        enabled: z.boolean().default(true),
      });
      const d = schema.parse(req.body);
      const r = await ((req as any).pool).query(
        `INSERT INTO super_admin_webhooks (name, url, events, secret, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [d.name, d.url, d.events, d.secret || null, d.enabled],
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { next(err); }
  });
  router.delete('/webhooks/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ((req as any).pool).query(`DELETE FROM super_admin_webhooks WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
  router.post('/webhooks/:id/test', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const r = await pool.query(`SELECT id FROM super_admin_webhooks WHERE id = $1`, [req.params.id]);
      if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      void dispatchWebhooks(pool, 'tenant.suspended', { test: true, fired_at: new Date().toISOString() });
      res.json({ ok: true, message: 'Test event dispatched (will appear in last_fired_at)' });
    } catch (err) { next(err); }
  });

  // ── F10: TOTP 2FA ───────────────────────────────────────────────────────
  router.post('/2fa/setup', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const userId = (req as any).userId;
      const email = (req as any).email;
      const secret = generateBase32Secret();
      await pool.query(`UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2`, [secret, userId]);
      const url = otpauthUrl(secret, email);
      // Free QR rendering — no extra dep needed in the browser, open this URL in <img>
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
      res.json({ secret, otpauth_url: url, qr_url: qrUrl });
    } catch (err) { next(err); }
  });
  router.post('/2fa/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const userId = (req as any).userId;
      const token = String(req.body?.token || '');
      const u = await pool.query(`SELECT totp_secret FROM users WHERE id = $1`, [userId]);
      if (!u.rows[0]?.totp_secret) { res.status(400).json({ error: 'No TOTP secret set; call /2fa/setup first' }); return; }
      if (!verifyTotp(u.rows[0].totp_secret, token)) { res.status(401).json({ error: 'Invalid code' }); return; }
      await pool.query(`UPDATE users SET totp_enabled = true WHERE id = $1`, [userId]);
      res.json({ ok: true, enabled: true });
    } catch (err) { next(err); }
  });
  router.post('/2fa/disable', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ((req as any).pool).query(`UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1`, [(req as any).userId]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ── F11: Plan upgrade/downgrade ─────────────────────────────────────────
  router.put('/tenants/:id/plan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const schema = z.object({ plan: z.string().min(1).max(50), reason: z.string().max(500).optional() });
      const data = schema.parse(req.body);
      const upd = await pool.query(
        `UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2 AND slug <> '__platform__' RETURNING id, name, plan`,
        [data.plan, req.params.id],
      );
      if (!upd.rows.length) { res.status(404).json({ error: 'Tenant not found' }); return; }
      await recordAction(pool, req, 'tenant.plan_change', 'tenants', {
        targetTenantId: req.params.id, targetResourceType: 'tenant',
        payload: { new_plan: data.plan, reason: data.reason || null },
      });
      res.json({ tenant: upd.rows[0] });
    } catch (err: any) {
      if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation failed', details: err.errors }); return; }
      next(err);
    }
  });

  // ── F12: Broadcasts CRUD ────────────────────────────────────────────────
  router.get('/broadcasts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await ((req as any).pool).query(`SELECT * FROM tenant_broadcasts ORDER BY created_at DESC`);
      res.json({ data: r.rows });
    } catch (err) { next(err); }
  });
  router.post('/broadcasts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const schema = z.object({
        message: z.string().min(1).max(500),
        severity: z.enum(['info', 'warning', 'critical']).default('info'),
        expires_at: z.string().datetime().optional(),
      });
      const d = schema.parse(req.body);
      const r = await pool.query(
        `INSERT INTO tenant_broadcasts (message, severity, expires_at, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [d.message, d.severity, d.expires_at || null, (req as any).userId],
      );
      void dispatchWebhooks(pool, 'broadcast.created', { message: d.message, severity: d.severity });
      res.status(201).json(r.rows[0]);
    } catch (err) { next(err); }
  });
  router.delete('/broadcasts/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ((req as any).pool).query(`UPDATE tenant_broadcasts SET active = false WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ── Cross-tenant subscriptions overview ────────────────────────────────
  // Powers the "Subscriptions" page in the super-admin shell. Returns the
  // current subscription row for every tenant (one row per tenant — most
  // recent), plus aggregates so the page can show MRR, paid-tenant count,
  // plan distribution, and upcoming renewals at a glance.
  router.get('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const planFilter   = String(req.query.plan   || '').trim();
      const statusFilter = String(req.query.status || '').trim();

      // Most-recent subscription per tenant. DISTINCT ON pulls one row per
      // tenant_id ordered by created_at DESC so we get the active sub.
      const wheres: string[] = [`t.slug <> '__platform__'`];
      const params: any[] = [];
      if (planFilter)   { params.push(planFilter);   wheres.push(`s.plan_id = $${params.length}`); }
      if (statusFilter) { params.push(statusFilter); wheres.push(`s.status  = $${params.length}`); }

      const rowsSql = `
        SELECT * FROM (
          SELECT DISTINCT ON (s.tenant_id)
            s.id, s.tenant_id, s.plan_id, s.plan_name,
            s.price::float8 AS price, s.currency, s.billing_cycle, s.status,
            s.auto_renew, s.current_period_start, s.next_renewal_date,
            s.cancel_at_period_end, s.canceled_at, s.created_at, s.updated_at,
            t.name AS tenant_name, t.slug AS tenant_slug, t.is_active AS tenant_active,
            COALESCE(w.balance, 0)::float8 AS wallet_balance,
            (SELECT email FROM users u WHERE u.tenant_id = t.id ORDER BY u.created_at ASC LIMIT 1) AS owner_email,
            (SELECT MAX(last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login_at
          FROM tenants t
          LEFT JOIN subscriptions s ON s.tenant_id = t.id
          LEFT JOIN wallets w ON w.tenant_id = t.id
          WHERE ${wheres.join(' AND ')}
          ORDER BY s.tenant_id, s.created_at DESC
        ) sub
        ORDER BY price DESC NULLS LAST, created_at DESC
      `;
      const rows = await pool.query(rowsSql, params);

      // Aggregations
      const [planDist, totals, upcoming, newestPaid, recentChanges] = await Promise.all([
        pool.query(`
          SELECT s.plan_id, s.plan_name, COUNT(DISTINCT s.tenant_id)::int AS tenant_count,
                 SUM(s.price)::float8 AS mrr_contribution
          FROM subscriptions s
          INNER JOIN tenants t ON t.id = s.tenant_id AND t.slug <> '__platform__'
          WHERE s.status = 'active'
          GROUP BY s.plan_id, s.plan_name
          ORDER BY mrr_contribution DESC NULLS LAST
        `),
        pool.query(`
          SELECT
            COUNT(DISTINCT s.tenant_id) FILTER (WHERE s.status = 'active' AND s.price > 0)::int AS paid_count,
            COUNT(DISTINCT s.tenant_id) FILTER (WHERE s.status = 'active' AND s.price = 0)::int AS free_count,
            COUNT(DISTINCT s.tenant_id) FILTER (WHERE s.status = 'canceled')::int AS canceled_count,
            COALESCE(SUM(s.price) FILTER (WHERE s.status = 'active'), 0)::float8 AS mrr,
            COALESCE(SUM(s.price * 12) FILTER (WHERE s.status = 'active' AND s.billing_cycle = 'monthly'), 0)::float8 AS arr
          FROM subscriptions s
          INNER JOIN tenants t ON t.id = s.tenant_id AND t.slug <> '__platform__'
        `),
        pool.query(`
          SELECT s.tenant_id, t.name AS tenant_name, s.plan_name, s.price::float8 AS price, s.next_renewal_date
          FROM subscriptions s
          INNER JOIN tenants t ON t.id = s.tenant_id AND t.slug <> '__platform__'
          WHERE s.status = 'active' AND s.auto_renew = true
            AND s.next_renewal_date BETWEEN now() AND now() + INTERVAL '7 days'
          ORDER BY s.next_renewal_date ASC
          LIMIT 10
        `),
        pool.query(`
          SELECT s.tenant_id, t.name AS tenant_name, s.plan_name, s.price::float8 AS price, s.created_at
          FROM subscriptions s
          INNER JOIN tenants t ON t.id = s.tenant_id AND t.slug <> '__platform__'
          WHERE s.price > 0
          ORDER BY s.created_at DESC LIMIT 10
        `),
        // Recent plan changes: subs whose updated_at > created_at means a change happened
        pool.query(`
          SELECT s.tenant_id, t.name AS tenant_name, s.plan_id, s.plan_name, s.price::float8 AS price, s.updated_at
          FROM subscriptions s
          INNER JOIN tenants t ON t.id = s.tenant_id AND t.slug <> '__platform__'
          WHERE s.updated_at > s.created_at + INTERVAL '1 minute'
          ORDER BY s.updated_at DESC LIMIT 10
        `),
      ]);

      res.json({
        data: rows.rows,
        plan_distribution: planDist.rows,
        totals: totals.rows[0],
        upcoming_renewals: upcoming.rows,
        newest_paid_subscriptions: newestPaid.rows,
        recent_plan_changes: recentChanges.rows,
      });
    } catch (err) { next(err); }
  });

  // ── F13: Cost optimization ──────────────────────────────────────────────
  router.get('/cost-analysis', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool: Pool = (req as any).pool;
      const convPool = conversationPool();
      const agPool = agentPool();
      // Rough cost-to-serve = SUM(call_minutes * agent.cost_per_min) over last 30d
      // Revenue proxy = SUM of credits in last 30d (real revenue model lives in invoices when wired)
      const calls = await convPool.query(`
        SELECT tenant_id, agent_id,
               SUM(COALESCE(duration_seconds,0))::bigint AS seconds,
               COUNT(*)::int AS n
        FROM conversations
        WHERE started_at >= now() - INTERVAL '30 days'
        GROUP BY tenant_id, agent_id
      `);
      const agentIds = Array.from(new Set(calls.rows.map((r: any) => r.agent_id).filter(Boolean)));
      const costMap = new Map<string, number>();
      const tenantNames = new Map<string, string>();
      if (agentIds.length) {
        const a = await agPool.query(`SELECT id, cost_per_min::float8 c FROM agents WHERE id = ANY($1::uuid[])`, [agentIds]);
        a.rows.forEach((r: any) => costMap.set(r.id, r.c || 2));
      }
      const perTenant = new Map<string, { cost: number; calls: number; minutes: number }>();
      calls.rows.forEach((r: any) => {
        const minutes = Number(r.seconds) / 60;
        const cost = minutes * (r.agent_id ? (costMap.get(r.agent_id) ?? 2) : 2);
        const cur = perTenant.get(r.tenant_id) || { cost: 0, calls: 0, minutes: 0 };
        cur.cost += cost; cur.calls += r.n; cur.minutes += minutes;
        perTenant.set(r.tenant_id, cur);
      });
      const ids = Array.from(perTenant.keys());
      let revenue = new Map<string, number>();
      if (ids.length) {
        const t = await pool.query(`SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`, [ids]);
        t.rows.forEach((r: any) => tenantNames.set(r.id, r.name));
        const rev = await pool.query(
          `SELECT tenant_id, SUM(amount)::float8 AS r FROM wallet_transactions
           WHERE type = 'credit' AND tenant_id = ANY($1::uuid[]) AND created_at >= now() - INTERVAL '30 days'
           GROUP BY tenant_id`,
          [ids],
        );
        rev.rows.forEach((r: any) => revenue.set(r.tenant_id, r.r));
      }
      const data = Array.from(perTenant.entries()).map(([tenantId, v]) => {
        const rev = revenue.get(tenantId) || 0;
        return {
          tenant_id: tenantId,
          tenant_name: tenantNames.get(tenantId) || null,
          calls: v.calls,
          minutes: Math.round(v.minutes),
          cost_inr: Math.round(v.cost * 100) / 100,
          revenue_inr: Math.round(rev * 100) / 100,
          margin_inr: Math.round((rev - v.cost) * 100) / 100,
          margin_pct: rev > 0 ? Math.round(((rev - v.cost) / rev) * 100) : null,
        };
      }).sort((a, b) => a.margin_inr - b.margin_inr);
      res.json({ window_days: 30, data });
    } catch (err) { next(err); }
  });

  // ── 27. Agent aggregations (analytics strip on /super-admin/agents) ─────
  router.get('/stats/agents', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const agPool = agentPool();
      const convPool = conversationPool();
      const [byStatus, byProvider, topTenants, costAgg] = await Promise.all([
        agPool.query(`SELECT status, COUNT(*)::int n FROM agents GROUP BY status`),
        agPool.query(`SELECT llm_provider, COUNT(*)::int n FROM agents WHERE llm_provider IS NOT NULL GROUP BY llm_provider ORDER BY n DESC LIMIT 5`),
        agPool.query(`SELECT tenant_id, COUNT(*)::int n FROM agents GROUP BY tenant_id ORDER BY n DESC LIMIT 5`),
        agPool.query(`SELECT AVG(cost_per_min)::float8 avg, MIN(cost_per_min)::float8 min, MAX(cost_per_min)::float8 max FROM agents WHERE cost_per_min IS NOT NULL`),
      ]);
      // Top agents by call count
      const topAgents = await convPool.query(
        `SELECT agent_id, COUNT(*)::int n FROM conversations
         WHERE agent_id IS NOT NULL AND started_at >= CURRENT_DATE - INTERVAL '7 days'
         GROUP BY agent_id ORDER BY n DESC LIMIT 5`,
      );
      res.json({
        by_status: byStatus.rows,
        by_provider: byProvider.rows,
        top_tenants: topTenants.rows,
        cost_per_min: costAgg.rows[0],
        top_agents_7d: topAgents.rows,
      });
    } catch (err) { next(err); }
  });

  return router;
}
