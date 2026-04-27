import { Pool } from 'pg';
import { DEFAULT_PLAN_ID, getPlan, Plan, migratePlanId } from './plans';

export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_name: string;
  price: number;
  currency: string;
  billing_cycle: string;
  status: string;
  auto_renew: boolean;
  current_period_start: string;
  next_renewal_date: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  plan?: Plan;
}

function addOneMonth(d: Date): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + 1);
  return next;
}

export async function ensureSubscription(pool: Pool, tenantId: string): Promise<Subscription> {
  const existing = await pool.query(
    `SELECT id, tenant_id, plan_id, plan_name, price::float8 AS price, currency, billing_cycle,
            status, auto_renew, current_period_start, next_renewal_date,
            cancel_at_period_end, canceled_at, created_at, updated_at
     FROM subscriptions
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId],
  );
  if (existing.rows.length > 0) {
    const sub = existing.rows[0] as Subscription;
    // Auto-migrate stale plan ids (legacy catalog) to the new 5-tier ones,
    // so existing tenants on jump_starter/early don't end up with a NULL plan.
    const migrated = migratePlanId(sub.plan_id);
    if (migrated !== sub.plan_id) {
      const np = getPlan(migrated)!;
      await pool.query(
        `UPDATE subscriptions SET plan_id = $1, plan_name = $2, price = $3, updated_at = now() WHERE id = $4`,
        [np.id, np.name, np.price, sub.id],
      );
      await pool.query(`UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2`, [np.id, tenantId]);
      sub.plan_id = np.id; sub.plan_name = np.name; sub.price = np.price;
    }
    sub.plan = getPlan(sub.plan_id);
    return sub;
  }

  const plan = getPlan(DEFAULT_PLAN_ID)!;
  const now = new Date();
  const ins = await pool.query(
    `INSERT INTO subscriptions
       (tenant_id, plan_id, plan_name, price, currency, billing_cycle, status, auto_renew, current_period_start, next_renewal_date)
     VALUES ($1, $2, $3, $4, 'INR', 'monthly', 'active', true, $5, $6)
     RETURNING id, tenant_id, plan_id, plan_name, price::float8 AS price, currency, billing_cycle,
               status, auto_renew, current_period_start, next_renewal_date,
               cancel_at_period_end, canceled_at, created_at, updated_at`,
    [tenantId, plan.id, plan.name, plan.price, now, addOneMonth(now)],
  );
  const sub = ins.rows[0] as Subscription;
  sub.plan = plan;

  // Mirror plan_id onto tenants.plan so existing UI that reads tenant.plan stays in sync.
  await pool.query('UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2', [plan.id, tenantId]);

  return sub;
}

export async function changePlan(
  pool: Pool,
  tenantId: string,
  planId: string,
): Promise<Subscription> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  await ensureSubscription(pool, tenantId);

  const upd = await pool.query(
    `UPDATE subscriptions
       SET plan_id = $1, plan_name = $2, price = $3, status = 'active',
           cancel_at_period_end = false, canceled_at = NULL, updated_at = now()
     WHERE tenant_id = $4
     RETURNING id, tenant_id, plan_id, plan_name, price::float8 AS price, currency, billing_cycle,
               status, auto_renew, current_period_start, next_renewal_date,
               cancel_at_period_end, canceled_at, created_at, updated_at`,
    [plan.id, plan.name, plan.price, tenantId],
  );
  const sub = upd.rows[0] as Subscription;
  sub.plan = plan;

  await pool.query('UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2', [plan.id, tenantId]);
  return sub;
}

export async function cancelSubscription(pool: Pool, tenantId: string): Promise<Subscription> {
  await ensureSubscription(pool, tenantId);
  const upd = await pool.query(
    `UPDATE subscriptions
       SET cancel_at_period_end = true, auto_renew = false, canceled_at = now(), updated_at = now()
     WHERE tenant_id = $1
     RETURNING id, tenant_id, plan_id, plan_name, price::float8 AS price, currency, billing_cycle,
               status, auto_renew, current_period_start, next_renewal_date,
               cancel_at_period_end, canceled_at, created_at, updated_at`,
    [tenantId],
  );
  const sub = upd.rows[0] as Subscription;
  sub.plan = getPlan(sub.plan_id);
  return sub;
}

export async function advanceRenewal(
  pool: Pool,
  subscriptionId: string,
): Promise<{ next_renewal_date: Date }> {
  const cur = await pool.query(
    'SELECT next_renewal_date FROM subscriptions WHERE id = $1',
    [subscriptionId],
  );
  const next = addOneMonth(new Date(cur.rows[0].next_renewal_date));
  await pool.query(
    `UPDATE subscriptions
       SET current_period_start = next_renewal_date, next_renewal_date = $1, updated_at = now()
     WHERE id = $2`,
    [next, subscriptionId],
  );
  return { next_renewal_date: next };
}
