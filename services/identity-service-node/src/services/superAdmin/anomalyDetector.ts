import { Pool } from 'pg';
import { conversationPool } from '../../db/crossPools';
import { dispatchWebhooks } from './webhookDispatcher';

// Cron-driven anomaly detector. Cheap, threshold-based — no ML. Three rules
// for v1, all idempotent (the unique index on (kind, tenant_id, DATE(created_at))
// dedupes duplicate alerts within the same calendar day).

const SPIKE_MULTIPLIER = 5;       // today's calls > 5× rolling 7-day average
const FAILURE_RATE_PCT = 30;      // tenant failure rate > 30% over last 24h (min 5 calls)
const WALLET_LOW_INR  = 0;        // wallet at or below ₹0

export async function runAnomalyChecks(pool: Pool): Promise<{ inserted: number }> {
  const convPool = conversationPool();
  let inserted = 0;

  const insert = async (kind: string, severity: string, tenantId: string | null, message: string, metric: any) => {
    try {
      // Dedup in code: skip if we already wrote this kind+tenant alert today.
      // The anomaly cron runs single-instance every 10min so a SELECT-then-INSERT
      // race is acceptable — at worst we emit one duplicate per cycle.
      const dup = await pool.query(
        `SELECT 1 FROM super_admin_alerts
         WHERE kind = $1
           AND COALESCE(tenant_id::text,'') = COALESCE($2::text,'')
           AND created_at >= CURRENT_DATE
         LIMIT 1`,
        [kind, tenantId],
      );
      if (dup.rows.length) return;

      const r = await pool.query(
        `INSERT INTO super_admin_alerts (kind, severity, tenant_id, message, metric)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [kind, severity, tenantId, message, JSON.stringify(metric)],
      );
      if (r.rows.length) {
        inserted++;
        void dispatchWebhooks(pool, 'anomaly.created', { alert_id: r.rows[0].id, kind, severity, tenant_id: tenantId, message });
      }
    } catch {
      /* best-effort; never block */
    }
  };

  // Rule 1: call spike — today > 5x avg of previous 7 days
  try {
    const spike = await convPool.query(`
      WITH today AS (
        SELECT tenant_id, COUNT(*)::int AS n FROM conversations
        WHERE started_at >= CURRENT_DATE GROUP BY tenant_id
      ),
      prev AS (
        SELECT tenant_id, COUNT(*)::float8 / 7.0 AS avg_n FROM conversations
        WHERE started_at >= CURRENT_DATE - INTERVAL '7 days' AND started_at < CURRENT_DATE
        GROUP BY tenant_id
      )
      SELECT t.tenant_id, t.n, p.avg_n
      FROM today t JOIN prev p ON p.tenant_id = t.tenant_id
      WHERE t.n > $1 * p.avg_n AND t.n >= 10
    `, [SPIKE_MULTIPLIER]);
    for (const r of spike.rows) {
      await insert('call_spike', 'warn', r.tenant_id,
        `Call spike — ${r.n} today vs ${Math.round(r.avg_n * 10) / 10}/day avg`,
        { today: r.n, avg_per_day_7d: r.avg_n });
    }
  } catch { /* ignore */ }

  // Rule 2: failure rate
  try {
    const fail = await convPool.query(`
      SELECT tenant_id,
        COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
        COUNT(*)::int AS total
      FROM conversations
      WHERE started_at >= now() - INTERVAL '24 hours'
      GROUP BY tenant_id
      HAVING COUNT(*) >= 5
        AND (COUNT(*) FILTER (WHERE status = 'FAILED')::float / COUNT(*)) * 100 > $1
    `, [FAILURE_RATE_PCT]);
    for (const r of fail.rows) {
      const pct = Math.round((r.failed / r.total) * 100);
      await insert('failure_rate', 'critical', r.tenant_id,
        `Failure rate ${pct}% over last 24h (${r.failed}/${r.total})`,
        { failed: r.failed, total: r.total, pct });
    }
  } catch { /* ignore */ }

  // Rule 3: wallet at zero
  try {
    const dry = await pool.query(`
      SELECT tenant_id, balance::float8 AS balance FROM wallets
      WHERE balance <= $1
    `, [WALLET_LOW_INR]);
    for (const r of dry.rows) {
      await insert('wallet_zero', 'warn', r.tenant_id,
        `Wallet at ₹${r.balance.toFixed(2)} — calls will start failing`,
        { balance: r.balance });
    }
  } catch { /* ignore */ }

  return { inserted };
}

export function startAnomalyCron(pool: Pool): NodeJS.Timeout {
  // Every 10 minutes. Off-thread, errors swallowed.
  const tick = () => { void runAnomalyChecks(pool).catch(() => {}); };
  void tick();
  return setInterval(tick, 10 * 60 * 1000);
}
