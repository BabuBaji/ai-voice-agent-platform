import { pool } from '../index';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'crm-retry-sweeper' });

const TICK_MS = Number(process.env.CRM_RETRY_TICK_MS || 60_000);
const BATCH = Number(process.env.CRM_RETRY_BATCH || 10);
const MAX_ATTEMPTS = Number(process.env.CRM_RETRY_MAX_ATTEMPTS || 8);

/**
 * Exponential backoff in seconds, capped at 30 minutes. Attempt 1 = 1 min,
 * 2 = 2 min, 3 = 4 min, 4 = 8 min, 5 = 16 min, then capped. After
 * MAX_ATTEMPTS the row is marked FAILED for human follow-up.
 */
function nextDelaySec(attempts: number): number {
  const base = 60 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, 30 * 60);
}

/**
 * Background sweeper: every TICK_MS picks up to BATCH `PENDING` rows from
 * `crm_lead_retry_queue` whose `next_attempt_at` is due, retries the POST,
 * and either marks the row SUCCESS or schedules the next attempt with
 * exponential backoff. Rows that exceed MAX_ATTEMPTS land in FAILED status.
 *
 * Skips silently if the queue is empty. Errors during sweep don't propagate
 * — the next tick retries.
 */
export async function sweepCrmRetryQueue(): Promise<{ done: number; failed: number; reattempt: number }> {
  let done = 0; let failed = 0; let reattempt = 0;
  try {
    const due = await pool.query(
      `SELECT id, tenant_id, conversation_id, payload, kind, related_lead_id, attempts
       FROM crm_lead_retry_queue
       WHERE status = 'PENDING' AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC
       LIMIT $1`,
      [BATCH],
    );
    if (due.rows.length === 0) return { done, failed, reattempt };

    for (const row of due.rows) {
      const url = row.kind === 'appointment'
        ? `${config.crmServiceUrl}/appointments`
        : `${config.crmServiceUrl}/leads`;
      let ok = false;
      let status = 0;
      let body = '';
      let respLeadId: string | null = null;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': row.tenant_id },
          body: JSON.stringify(row.payload),
        });
        status = r.status;
        if (r.ok) {
          ok = true;
          try {
            const j: any = await r.json();
            respLeadId = j?.id || j?.data?.id || null;
          } catch { /* response body wasn't JSON — still a success */ }
        } else {
          body = (await r.text().catch(() => '')).slice(0, 500);
        }
      } catch (err: any) {
        body = `network: ${String(err?.message || err).slice(0, 400)}`;
      }

      if (ok) {
        await pool.query(
          `UPDATE crm_lead_retry_queue
           SET status = 'SUCCESS',
               attempts = attempts + 1,
               succeeded_at = NOW(),
               updated_at = NOW(),
               crm_response_lead_id = $1,
               last_status_code = $2,
               last_error = NULL
           WHERE id = $3`,
          [respLeadId, status, row.id],
        );
        // For 'lead' kind, also persist the resulting CRM lead id onto the
        // conversation's analysis JSONB so re-analyze doesn't create a
        // duplicate. Mirrors what the inline path does on first success.
        if (row.kind === 'lead' && respLeadId && row.conversation_id) {
          try {
            await pool.query(
              `UPDATE conversations
               SET analysis = COALESCE(analysis, '{}'::jsonb) || $1::jsonb
               WHERE id = $2 AND tenant_id = $3`,
              [JSON.stringify({ crm_lead_id: respLeadId, crm_recovered_via_retry: true }), row.conversation_id, row.tenant_id],
            );
          } catch { /* non-fatal */ }
        }
        done++;
      } else {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await pool.query(
            `UPDATE crm_lead_retry_queue
             SET status = 'FAILED',
                 attempts = $1,
                 updated_at = NOW(),
                 last_error = $2,
                 last_status_code = $3
             WHERE id = $4`,
            [nextAttempts, body || 'unknown', status || null, row.id],
          );
          failed++;
          logger.warn(
            { id: row.id, conv: row.conversation_id, kind: row.kind, attempts: nextAttempts, status, body: body.slice(0, 100) },
            'CRM retry queue: row PERMANENTLY FAILED — needs human follow-up',
          );
        } else {
          const delaySec = nextDelaySec(nextAttempts);
          await pool.query(
            `UPDATE crm_lead_retry_queue
             SET attempts = $1,
                 next_attempt_at = NOW() + ($2 || ' seconds')::interval,
                 updated_at = NOW(),
                 last_error = $3,
                 last_status_code = $4
             WHERE id = $5`,
            [nextAttempts, String(delaySec), body || 'unknown', status || null, row.id],
          );
          reattempt++;
        }
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'crm-retry sweeper tick failed');
  }
  if (done || failed || reattempt) {
    logger.info({ done, failed, reattempt }, 'CRM retry sweeper tick');
  }
  return { done, failed, reattempt };
}

export function startCrmRetrySweeper(): void {
  if (process.env.CRM_RETRY_SWEEPER === 'off') {
    logger.info('CRM retry sweeper disabled via CRM_RETRY_SWEEPER=off');
    return;
  }
  setTimeout(sweepCrmRetryQueue, 10_000).unref();
  setInterval(sweepCrmRetryQueue, TICK_MS).unref();
  logger.info({ tickMs: TICK_MS, batch: BATCH, maxAttempts: MAX_ATTEMPTS }, 'CRM retry sweeper started');
}
