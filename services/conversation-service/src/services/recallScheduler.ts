/**
 * Lead-recall scheduler — per-lead retry queue for the post-call admissions
 * follow-up loop. Distinct from `campaign_targets` (which is per-campaign).
 *
 * Cadence per the admissions spec:
 *   attempt 1 → +1 hour
 *   attempt 2 → +3 hours
 *   attempt 3 → next day at the lead's preferred_callback_time (default 10:00)
 *   attempt 4 → send WhatsApp + SMS (no dial)
 *   attempt 5 → mark UNREACHABLE + create a counselor follow_up_task
 *
 * Business hours: 9 AM – 9 PM IST. Anything that falls outside the window
 * gets pushed to the next 9 AM. Hot leads (lead_status=HOT_INTERESTED) cut
 * the +1h initial wait in half.
 *
 * Dial-out reuses telephony-adapter's POST /calls/initiate — same dialer
 * the campaign worker uses, so recordings/analyzer/CRM-retry all flow
 * through their existing pipelines.
 */
import { pool } from '../index';
import { config } from '../config';
import { sendWhatsApp, sendSms } from './communications';

const logger = {
  info: (...a: any[]) => console.info('[recall]', ...a),
  warn: (...a: any[]) => console.warn('[recall]', ...a),
};

const TICK_MS = 60_000;
const BUSINESS_START_HOUR = 9;   // 9 AM IST
const BUSINESS_END_HOUR = 21;    // 9 PM IST
const TZ_OFFSET_HOURS = 5.5;     // IST = UTC+5:30

let timer: NodeJS.Timeout | null = null;

export interface EnqueueOpts {
  tenant_id: string;
  lead_id: string;
  conversation_id?: string | null;
  agent_id?: string | null;
  phone_number: string;
  lead_status?: string | null;
  preferred_callback_time?: string | null; // 'HH:MM' (24h) — extracted from analyzer
}

/** Enqueue a brand-new lead for the recall loop. Idempotent on (tenant_id, lead_id). */
export async function enqueueLeadRecall(opts: EnqueueOpts): Promise<void> {
  try {
    // Compute the FIRST retry slot: hot leads get +30min, everyone else +1h.
    // Push into business hours if necessary.
    const hot = String(opts.lead_status || '').toUpperCase() === 'HOT_INTERESTED';
    const firstDelayMs = hot ? 30 * 60_000 : 60 * 60_000;
    const next = clampToBusinessHours(new Date(Date.now() + firstDelayMs));
    await pool.query(
      `INSERT INTO lead_recall_queue
         (tenant_id, lead_id, conversation_id, agent_id, phone_number, lead_status,
          retry_count, state, next_retry_at, preferred_callback_time)
       VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, 0, 'PENDING', $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        opts.tenant_id, opts.lead_id, opts.conversation_id || null, opts.agent_id || null,
        opts.phone_number, opts.lead_status || null, next.toISOString(),
        opts.preferred_callback_time || null,
      ],
    );
    logger.info(`enqueued lead=${opts.lead_id} phone=${opts.phone_number} next=${next.toISOString()}`);
  } catch (err: any) {
    logger.warn(`enqueue failed: ${err.message}`);
  }
}

/**
 * Update queue row after a call lifecycle event. Called from telephony-adapter
 * via direct DB write (both services share conversation_db). `callStatus` is
 * one of: CONNECTED, NO_ANSWER, BUSY, REJECTED, FAILED.
 */
export async function recordCallOutcome(
  phoneNumber: string, conversationId: string | null, callStatus: string,
): Promise<void> {
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return;
  try {
    if (callStatus === 'CONNECTED') {
      // Connected = recall loop succeeded. Stop further retries.
      await pool.query(
        `UPDATE lead_recall_queue
           SET state = 'COMPLETED', last_call_status = 'CONNECTED',
               last_attempt_at = NOW(), updated_at = NOW(), conversation_id = COALESCE($2::uuid, conversation_id)
         WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1
           AND state IN ('PENDING', 'IN_FLIGHT')`,
        [digits, conversationId],
      );
    } else {
      // No-answer / busy / rejected → bump retry_count, schedule next slot.
      await pool.query(
        `UPDATE lead_recall_queue
           SET last_call_status = $2,
               last_attempt_at = NOW(),
               state = 'PENDING',
               updated_at = NOW()
         WHERE regexp_replace(phone_number, '\\D', '', 'g') = $1
           AND state IN ('IN_FLIGHT')`,
        [digits, callStatus],
      );
    }
  } catch (err: any) {
    logger.warn(`recordCallOutcome failed: ${err.message}`);
  }
}

/**
 * 60-second tick: claim due rows, dispatch each based on retry_count.
 *  count<4: dial via telephony-adapter
 *  count=4: send WhatsApp + SMS
 *  count>=5: mark UNREACHABLE + create counselor follow_up_task
 */
async function tick(): Promise<void> {
  let due: any[] = [];
  try {
    const r = await pool.query(
      `SELECT * FROM lead_recall_queue
        WHERE state = 'PENDING'
          AND next_retry_at <= NOW()
        ORDER BY next_retry_at ASC LIMIT 20`,
    );
    due = r.rows;
  } catch (err: any) {
    logger.warn(`tick poll failed: ${err.message}`);
    return;
  }

  for (const row of due) {
    try {
      await dispatch(row);
    } catch (err: any) {
      logger.warn(`dispatch failed for recall=${row.id}: ${err.message}`);
    }
  }
}

async function dispatch(row: any): Promise<void> {
  const nextCount = (row.retry_count || 0) + 1;

  // Stop early for explicit not-interested status.
  if (String(row.lead_status || '').toUpperCase() === 'NOT_INTERESTED') {
    await pool.query(
      `UPDATE lead_recall_queue SET state = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    logger.info(`recall ${row.id} cancelled — lead NOT_INTERESTED`);
    return;
  }

  // Attempt 5+ → UNREACHABLE + counselor task.
  if (nextCount >= 5) {
    await markUnreachable(row);
    return;
  }

  // Attempt 4 → WhatsApp + SMS fallback (no dial).
  if (nextCount === 4) {
    await dispatchMessages(row, nextCount);
    return;
  }

  // Attempts 1-3 → dial via telephony-adapter.
  await dispatchDial(row, nextCount);
}

/**
 * Find an agent_id we can redial this lead with. Priority:
 *  1) the most recent conversation that called this phone (digits match)
 *  2) any active deployed agent in this tenant
 * Returns null when nothing matches — caller falls through to the message
 * fallback so we don't strand the lead.
 */
async function resolveAgentIdForRecall(tenantId: string, phoneNumber: string): Promise<string | null> {
  const digits = (phoneNumber || '').replace(/\D/g, '');
  try {
    if (digits) {
      const r = await pool.query(
        `SELECT agent_id FROM conversations
          WHERE tenant_id = $1
            AND agent_id IS NOT NULL
            AND regexp_replace(COALESCE(called_number, ''), '\\D', '', 'g') = $2
          ORDER BY created_at DESC LIMIT 1`,
        [tenantId, digits],
      );
      if (r.rows[0]?.agent_id) return r.rows[0].agent_id;
    }
    // Tenant-wide fallback: any agent we've seen on a recent conversation.
    const f = await pool.query(
      `SELECT agent_id FROM conversations
        WHERE tenant_id = $1 AND agent_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    return f.rows[0]?.agent_id || null;
  } catch {
    return null;
  }
}

async function dispatchDial(row: any, nextCount: number): Promise<void> {
  // Resolve agent_id if missing — the manual-brochure enqueue path doesn't
  // know which agent should call this lead back. Fall back to the most
  // recent conversation for this phone, then to the tenant's first agent.
  let agentId: string | null = row.agent_id;
  if (!agentId) {
    agentId = await resolveAgentIdForRecall(row.tenant_id, row.phone_number);
  }
  if (!agentId) {
    // No agent we can dial with. Skip dial and try the message fallback so
    // we still reach the customer; if that also fails the regular cadence
    // continues. Mark in DB so the row reflects what happened.
    await pool.query(
      `UPDATE lead_recall_queue
          SET last_call_status = 'NO_AGENT_AVAILABLE', last_attempt_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [row.id],
    );
    logger.warn(`recall ${row.id} has no agent — falling through to message dispatch`);
    await dispatchMessages(row, nextCount);
    return;
  }
  // Persist the resolved agent so subsequent retries skip the lookup.
  if (agentId !== row.agent_id) {
    await pool.query(
      `UPDATE lead_recall_queue SET agent_id = $2::uuid WHERE id = $1`,
      [row.id, agentId],
    );
  }

  // Mark IN_FLIGHT first so a slow ticker doesn't double-dispatch.
  await pool.query(
    `UPDATE lead_recall_queue
        SET state = 'IN_FLIGHT', retry_count = $2, last_attempt_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [row.id, nextCount],
  );

  const telephonyUrl = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:3002';
  let dialOk = false;
  let dialErr = '';
  try {
    const resp = await fetch(`${telephonyUrl}/api/v1/calls/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': row.tenant_id },
      // Thread the existing lead_id through call metadata so the recall
      // conversation links to THIS lead (analyzer's linked-lead path) instead
      // of spawning a duplicate. `recall: true` marks the call's origin.
      body: JSON.stringify({ to: row.phone_number, agent_id: agentId, metadata: { lead_id: row.lead_id, recall: true } }),
    });
    if (!resp.ok) dialErr = (await resp.text().catch(() => '')).slice(0, 300);
    else dialOk = true;
  } catch (err: any) {
    dialErr = err?.message || 'fetch_failed';
  }

  if (!dialOk) {
    // Couldn't even initiate (telephony down or rejected). Flip back to
    // PENDING with the next scheduled retry slot, don't burn the attempt.
    const next = computeNextSlot(nextCount, row.preferred_callback_time);
    await pool.query(
      `UPDATE lead_recall_queue
          SET state = 'PENDING', next_retry_at = $2,
              last_call_status = 'INITIATE_FAILED', retry_reason = $3, updated_at = NOW()
        WHERE id = $1`,
      [row.id, next.toISOString(), dialErr.slice(0, 250)],
    );
    logger.warn(`recall ${row.id} dial-initiate failed → rescheduled to ${next.toISOString()}: ${dialErr.slice(0, 100)}`);
    return;
  }

  // Dial initiated. The Plivo status webhook will call recordCallOutcome
  // once the call ends, which sets last_call_status. Then the *next* tick
  // schedules the next retry based on what came back.
  // To bridge the IN_FLIGHT → next slot, we also schedule a "safety" retry
  // slot now in case the webhook never lands.
  const safetyNext = computeNextSlot(nextCount, row.preferred_callback_time);
  await pool.query(
    `UPDATE lead_recall_queue
        SET next_retry_at = $2, updated_at = NOW()
      WHERE id = $1`,
    [row.id, safetyNext.toISOString()],
  );
  logger.info(`recall ${row.id} dial initiated → attempt ${nextCount}, safety-next=${safetyNext.toISOString()}`);
}

async function dispatchMessages(row: any, nextCount: number): Promise<void> {
  const brochureUrl = process.env.BROCHURE_DEFAULT_URL || 'https://dce.edu.in/';
  const messageBody = `Hi, we tried reaching you regarding B.Tech admissions but couldn't connect. Please find your brochure here: ${brochureUrl}. Reply with a good time to call back.`;
  const recipient = row.phone_number.startsWith('+') ? row.phone_number : `+${row.phone_number}`;

  const results = await Promise.allSettled([
    sendWhatsApp({
      tenant_id: row.tenant_id, lead_id: row.lead_id, conversation_id: row.conversation_id || undefined,
      recipient, message: messageBody, attachments: [{ name: 'Brochure', url: brochureUrl }],
    }),
    sendSms({
      tenant_id: row.tenant_id, lead_id: row.lead_id, conversation_id: row.conversation_id || undefined,
      recipient, message: messageBody,
    }),
  ]);
  const waOk = results[0].status === 'fulfilled' && (results[0].value as any)?.ok;
  const smsOk = results[1].status === 'fulfilled' && (results[1].value as any)?.ok;
  logger.info(`recall ${row.id} attempt-4 messages: whatsapp=${waOk ? 'ok' : 'fail'}, sms=${smsOk ? 'ok' : 'fail'}`);

  // After attempt 4 we either succeed (don't schedule attempt 5) or fail
  // both (schedule attempt 5 for next day so a counselor can take over).
  if (waOk || smsOk) {
    await pool.query(
      `UPDATE lead_recall_queue
          SET state = 'COMPLETED', retry_count = $2, last_call_status = 'MESSAGE_SENT',
              last_attempt_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [row.id, nextCount],
    );
  } else {
    const next = computeNextSlot(nextCount, row.preferred_callback_time);
    await pool.query(
      `UPDATE lead_recall_queue
          SET state = 'PENDING', retry_count = $2, last_call_status = 'MESSAGE_FAILED',
              next_retry_at = $3, last_attempt_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [row.id, nextCount, next.toISOString()],
    );
  }
}

async function markUnreachable(row: any): Promise<void> {
  await pool.query(
    `UPDATE lead_recall_queue
        SET state = 'UNREACHABLE', last_attempt_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [row.id],
  );
  // Create a counselor follow_up_task so a human takes over.
  try {
    await pool.query(
      `INSERT INTO follow_up_tasks
         (tenant_id, lead_id, conversation_id, task_type, scheduled_at, priority, status, notes)
       VALUES ($1, $2::uuid, $3::uuid, 'manual_followup', NOW() + INTERVAL '1 hour', 'high', 'pending', $4)`,
      [row.tenant_id, row.lead_id, row.conversation_id || null,
       'Auto-escalated from recall queue — 5 attempts exhausted, please call manually.'],
    );
  } catch (err: any) {
    logger.warn(`unreachable task create failed: ${err.message}`);
  }
  // Notify CRM. Best-effort.
  try {
    const crmUrl = config.crmServiceUrl;
    await fetch(`${crmUrl}/leads/${row.lead_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': row.tenant_id },
      body: JSON.stringify({ tags: ['unreachable', 'needs_review'] }),
    }).catch(() => {});
  } catch { /* non-fatal */ }
  logger.info(`recall ${row.id} marked UNREACHABLE — counselor task created`);
}

/** Compute the next slot after this attempt: 1→+1h, 2→+3h, 3→next-day pref. */
function computeNextSlot(attemptJustTried: number, preferredHHmm?: string | null): Date {
  let next: Date;
  if (attemptJustTried === 1) {
    next = new Date(Date.now() + 60 * 60_000);              // +1h
  } else if (attemptJustTried === 2) {
    next = new Date(Date.now() + 3 * 60 * 60_000);          // +3h
  } else if (attemptJustTried === 3) {
    // Next day at preferred_callback_time (default 10:00 IST).
    next = nextDayAt(preferredHHmm || '10:00');
  } else {
    // attempt 4 retried: next day at preferred time too
    next = nextDayAt(preferredHHmm || '10:00');
  }
  return clampToBusinessHours(next);
}

/** Push `d` into 9AM-9PM IST. Past-9PM → next 9AM. Before-9AM → today 9AM. */
function clampToBusinessHours(d: Date): Date {
  // Convert to IST clock by shifting; we treat the JS Date "wall" as UTC.
  const istNow = new Date(d.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  const h = istNow.getUTCHours();
  if (h < BUSINESS_START_HOUR) {
    istNow.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
  } else if (h >= BUSINESS_END_HOUR) {
    istNow.setUTCDate(istNow.getUTCDate() + 1);
    istNow.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
  }
  // Shift back to UTC for storage.
  return new Date(istNow.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
}

function nextDayAt(hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10) || 0);
  const istNow = new Date(Date.now() + TZ_OFFSET_HOURS * 3600 * 1000);
  istNow.setUTCDate(istNow.getUTCDate() + 1);
  istNow.setUTCHours(hh, mm, 0, 0);
  return new Date(istNow.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
}

export function startRecallScheduler(): void {
  if (timer) return;
  if ((process.env.AUTO_RECALL || 'on').toLowerCase() === 'off') {
    logger.info('AUTO_RECALL=off — scheduler not started');
    return;
  }
  // First tick after 5s so DB migration has run; then every 60s.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
  }, 5000);
  logger.info(`scheduler started (tick=${TICK_MS}ms, business hours 9-21 IST)`);
}
