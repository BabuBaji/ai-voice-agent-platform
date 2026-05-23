/**
 * whatsappRetrySweeper — retries failed WhatsApp `communication_logs` rows
 * with explicit 5 / 15 / 30-minute backoffs, max 3 attempts total.
 *
 * Why it lives on communication_logs (not a separate queue table):
 *   The log already carries every field needed to re-construct the send
 *   (recipient, template_id, template_language, template_params, attachments).
 *   A parallel queue table would duplicate state and need to stay in sync;
 *   one source of truth is simpler and the queries are cheap thanks to
 *   idx_comm_retry_due.
 *
 * Backoff schedule:
 *   attempt 0 → original send (immediate)
 *   attempt 1 → first retry, 5 minutes after the original failure
 *   attempt 2 → second retry, 15 minutes after attempt 1
 *   attempt 3 → final retry, 30 minutes after attempt 2
 *   After 3 retries: status stays 'failed', next_retry_at cleared.
 *
 * Permanent failures (auth/template/allow-list) skip the queue from the
 * start — see isPermanentFailure() in communications.ts. The sweeper
 * only runs on rows that have a non-null next_retry_at.
 *
 * Concurrency: SELECT ... FOR UPDATE SKIP LOCKED so two sweeper instances
 * (or a sweeper + a manual force-retry) can't double-fire the same row.
 */
import pino from 'pino';
import { pool } from '../index';

const logger = pino({ name: 'wa-retry-sweeper' });

const TICK_MS = Number(process.env.WA_RETRY_TICK_MS || 60_000);
const MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES: ReadonlyArray<number> = [5, 15, 30];

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startRetrySweeper(): void {
  if (timer) return;
  logger.info({ tick_ms: TICK_MS, max_attempts: MAX_ATTEMPTS, backoff: BACKOFF_MINUTES }, 'wa-retry-sweeper started');
  timer = setInterval(() => {
    void tick().catch((err) => logger.error({ err: err?.message }, 'tick failed'));
  }, TICK_MS);
}

export function stopRetrySweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const claimed = await claimDueBatch(20);
    if (claimed.length === 0) return;
    logger.info({ count: claimed.length }, 'claimed retry batch');
    for (const row of claimed) {
      await retryOne(row).catch((err) =>
        logger.warn({ id: row.id, err: err?.message }, 'retry one threw'),
      );
    }
  } finally {
    running = false;
  }
}

interface RetryRow {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  recipient: string;
  message: string;
  template_id: string | null;
  template_language: string | null;
  template_params: any[] | null;
  attachments: any[] | null;
  retry_attempts: number;
  last_error: string | null;
}

async function claimDueBatch(limit: number): Promise<RetryRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, tenant_id, lead_id, conversation_id, recipient, message,
              template_id, template_language, template_params, attachments,
              retry_attempts, last_error
       FROM communication_logs
       WHERE channel = 'whatsapp'
         AND status = 'failed'
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= NOW()
         AND retry_attempts < $1
       ORDER BY next_retry_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );
    if (r.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }
    // Clear next_retry_at while we hold the row so two ticks don't both
    // grab the same id. We'll reset it on retry failure below.
    const ids = r.rows.map((row) => row.id);
    await client.query(
      `UPDATE communication_logs SET next_retry_at = NULL WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await client.query('COMMIT');
    return r.rows as RetryRow[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function retryOne(row: RetryRow): Promise<void> {
  // Re-call the send path directly via the existing sendWhatsApp orchestrator
  // — that respects per-tenant provider resolution (Plivo/Twilio/Meta), DLT
  // templates, etc. But sendWhatsApp INSERTS a new log row. We need a path
  // that UPDATES this row instead.
  //
  // Easiest: call sendWhatsApp, then merge the new row's outcome into the
  // original row and delete the dup. That keeps lead-side audit pointing
  // at the original log id (campaign target / workflow run already linked).
  const { sendWhatsApp } = await import('./communications');
  const result = await sendWhatsApp({
    tenant_id: row.tenant_id,
    lead_id: row.lead_id || undefined,
    conversation_id: row.conversation_id || undefined,
    recipient: row.recipient,
    message: row.message,
    template_id: row.template_id,
    template_language: row.template_language,
    template_params: row.template_params || undefined,
    attachments: row.attachments || undefined,
  });
  const nextAttempt = row.retry_attempts + 1; // we're recording this attempt
  const stillHasRetries = nextAttempt < MAX_ATTEMPTS;
  const newBackoffMin = stillHasRetries ? BACKOFF_MINUTES[nextAttempt] || 30 : null;

  if (result.ok) {
    // Promote the original row to 'sent' using the new attempt's wamid + log.
    await pool.query(
      `UPDATE communication_logs SET
         status = 'sent',
         sent_at = NOW(),
         retry_attempts = $2,
         next_retry_at = NULL,
         last_error = NULL,
         provider_message_id = COALESCE(provider_message_id, (
           SELECT provider_message_id FROM communication_logs WHERE id = $3
         )),
         provider_response = COALESCE(provider_response, '{}'::jsonb) ||
                            jsonb_build_object('retry_attempt', $2,
                                               'retry_log_id', $3::text)
       WHERE id = $1`,
      [row.id, nextAttempt, result.log_id],
    );
  } else {
    // Schedule next retry or mark permanent fail.
    if (stillHasRetries) {
      await pool.query(
        `UPDATE communication_logs SET
           retry_attempts = $2,
           next_retry_at = NOW() + ($3 || ' minutes')::interval,
           last_error = $4
         WHERE id = $1`,
        [row.id, nextAttempt, String(newBackoffMin), result.error || row.last_error || 'unknown'],
      );
    } else {
      await pool.query(
        `UPDATE communication_logs SET
           retry_attempts = $2,
           next_retry_at = NULL,
           last_error = $3
         WHERE id = $1`,
        [row.id, nextAttempt, `MAX_RETRIES_EXHAUSTED: ${result.error || row.last_error || 'unknown'}`],
      );
    }
  }

  // Delete the dup row that sendWhatsApp inserted — its outcome has been
  // merged into the original. Only delete if we got a log_id back (we did)
  // and it's different from the original.
  if (result.log_id && result.log_id !== row.id) {
    await pool.query(`DELETE FROM communication_logs WHERE id = $1`, [result.log_id]);
  }
  logger.info({
    id: row.id, attempt: nextAttempt, ok: result.ok,
    next_in_min: result.ok ? null : newBackoffMin,
  }, 'retry done');
}

/** Force a retry NOW from the UI. Returns the new row state. */
export async function forceRetry(logId: string, tenantId: string): Promise<RetryRow | null> {
  const r = await pool.query(
    `UPDATE communication_logs
        SET next_retry_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status = 'failed' AND retry_attempts < $3
      RETURNING id, tenant_id, lead_id, conversation_id, recipient, message,
                template_id, template_language, template_params, attachments,
                retry_attempts, last_error`,
    [logId, tenantId, MAX_ATTEMPTS],
  );
  return (r.rows[0] as RetryRow) || null;
}

/** Permanently skip — UI button for "give up". */
export async function skipRetry(logId: string, tenantId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE communication_logs
        SET next_retry_at = NULL,
            retry_attempts = $3
      WHERE id = $1 AND tenant_id = $2 AND status = 'failed'`,
    [logId, tenantId, MAX_ATTEMPTS],
  );
  return (r.rowCount ?? 0) > 0;
}
