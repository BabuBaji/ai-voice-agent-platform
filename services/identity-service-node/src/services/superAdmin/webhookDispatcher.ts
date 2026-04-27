import { Pool } from 'pg';
import crypto from 'crypto';

// Lightweight outbound dispatcher. Fire-and-forget HTTP POST to every enabled
// webhook subscribed to the given event. Records failure_count + last_status
// so the UI can show health. Intentionally does NOT retry — for v1 we want
// observability over delivery guarantees.

export type SuperAdminEvent =
  | 'tenant.suspended' | 'tenant.activated'
  | 'wallet.credit'    | 'wallet.debit'
  | 'anomaly.created'
  | 'broadcast.created'
  | 'tenant.impersonated';

export async function dispatchWebhooks(
  pool: Pool,
  event: SuperAdminEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  let hooks: Array<{ id: string; url: string; secret: string | null }>;
  try {
    const r = await pool.query(
      `SELECT id, url, secret FROM super_admin_webhooks
       WHERE enabled = true AND $1 = ANY(events)`,
      [event],
    );
    hooks = r.rows;
  } catch {
    return;
  }
  if (!hooks.length) return;

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  // Fire all in parallel; awaiting them blocks the original request, so we
  // detach to background. Errors are logged to the row, not bubbled.
  void Promise.all(hooks.map(async (h) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (h.secret) {
      const sig = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
      headers['X-Signature-256'] = `sha256=${sig}`;
    }
    let status: number | null = null;
    try {
      const resp = await fetch(h.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
      status = resp.status;
      const ok = resp.ok;
      await pool.query(
        `UPDATE super_admin_webhooks
         SET last_fired_at = now(), last_status = $1,
             failure_count = CASE WHEN $2 THEN 0 ELSE failure_count + 1 END
         WHERE id = $3`,
        [status, ok, h.id],
      );
    } catch {
      await pool.query(
        `UPDATE super_admin_webhooks
         SET last_fired_at = now(), last_status = NULL, failure_count = failure_count + 1
         WHERE id = $1`,
        [h.id],
      ).catch(() => {});
    }
  }));
}
