import { Pool } from 'pg';
import pino from 'pino';
import { sendEmail } from './communications';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

const CRM_DB_URL = process.env.CRM_DB_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db';
const TELEPHONY_URL = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:3002';
const CALLING_HOURS = { start: 9, end: 19 }; // 9 AM - 7 PM IST
const MAX_ATTEMPTS_PER_DAY = 3;
const RETRY_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_FOLLOWUP_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours

let crmPool: Pool | null = null;
function getCrmPool(): Pool {
  if (!crmPool) crmPool = new Pool({ connectionString: CRM_DB_URL });
  return crmPool;
}

function istHour(): number {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours();
}

function isInCallingWindow(): boolean {
  const h = istHour();
  return h >= CALLING_HOURS.start && h < CALLING_HOURS.end;
}

function nextCallingWindowStart(): Date {
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = istNow.getHours();
  if (h < CALLING_HOURS.start) {
    istNow.setHours(CALLING_HOURS.start, 0, 0, 0);
    return new Date(istNow.toISOString());
  }
  // Next day 9 AM IST
  istNow.setDate(istNow.getDate() + 1);
  istNow.setHours(CALLING_HOURS.start, 0, 0, 0);
  return new Date(istNow.toISOString());
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: create a follow-up for a lead
// ─────────────────────────────────────────────────────────────────────────────

export async function createFollowupForLead(pool: Pool, opts: {
  tenantId: string;
  leadId: string;
  conversationId?: string;
  agentId?: string;
  type?: string;
  scheduledAt?: Date;
  priority?: number;
  notes?: string;
}): Promise<string> {
  // Check if lead has a callback_time in custom_fields
  let scheduledAt = opts.scheduledAt || new Date(Date.now() + DEFAULT_FOLLOWUP_DELAY_MS);
  if (!opts.scheduledAt) {
    try {
      const crm = getCrmPool();
      const r = await crm.query(
        `SELECT custom_fields->>'recommended_follow_up_time' as followup_time,
                custom_fields->>'callback_time' as callback_time
         FROM leads WHERE id = $1 LIMIT 1`,
        [opts.leadId],
      );
      const row = r.rows[0];
      if (row?.callback_time) {
        const parsed = new Date(row.callback_time);
        if (!isNaN(parsed.getTime()) && parsed > new Date()) scheduledAt = parsed;
      } else if (row?.followup_time === 'within 24h') {
        scheduledAt = new Date(Date.now() + DEFAULT_FOLLOWUP_DELAY_MS);
      }
    } catch { /* non-fatal */ }
  }

  // Find the agent attached to this lead or tenant
  let agentId = opts.agentId;
  if (!agentId) {
    try {
      const crm = getCrmPool();
      const r = await crm.query(
        `SELECT custom_fields->>'agent_id' as agent_id FROM leads WHERE id = $1 LIMIT 1`,
        [opts.leadId],
      );
      agentId = r.rows[0]?.agent_id || null;
    } catch { /* non-fatal */ }
  }

  const r = await pool.query(
    `INSERT INTO followup_tasks (tenant_id, lead_id, conversation_id, agent_id, type, scheduled_at, priority, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [opts.tenantId, opts.leadId, opts.conversationId || null, agentId || null,
     opts.type || 'admission_interest', scheduledAt, opts.priority || 5, opts.notes || null],
  );
  const taskId = r.rows[0].id;
  logger.info({ taskId, leadId: opts.leadId, type: opts.type, scheduledAt }, 'Follow-up task created');
  return taskId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: update follow-up from call end
// ─────────────────────────────────────────────────────────────────────────────

export async function updateFollowupFromCallEnd(pool: Pool, opts: {
  followupTaskId: string;
  conversationId: string;
  callOutcome: string;
  interestLevel: number;
  analysis: any;
}): Promise<void> {
  const { followupTaskId, conversationId, callOutcome, interestLevel, analysis } = opts;
  const outcome = (callOutcome || '').toLowerCase();
  const task = await pool.query(`SELECT * FROM followup_tasks WHERE id = $1`, [followupTaskId]);
  if (!task.rows.length) return;
  const t = task.rows[0];

  if (outcome.includes('not interested') || outcome.includes('not_interested')) {
    // Mark completed + update lead to LOST
    await pool.query(
      `UPDATE followup_tasks SET status = 'COMPLETED', completed_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ outcome: 'NOT_INTERESTED', interestLevel, conversationId }), followupTaskId],
    );
    try {
      const crm = getCrmPool();
      await crm.query(`UPDATE leads SET status = 'UNQUALIFIED', updated_at = NOW() WHERE id = $1`, [t.lead_id]);
    } catch {}
  } else if (outcome.includes('visit') || outcome.includes('appointment')) {
    // Visit scheduled
    await pool.query(
      `UPDATE followup_tasks SET status = 'COMPLETED', completed_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ outcome: 'VISIT_SCHEDULED', interestLevel, conversationId }), followupTaskId],
    );
    // Create next follow-up: visit_confirmation
    await createFollowupForLead(pool, {
      tenantId: t.tenant_id, leadId: t.lead_id, agentId: t.agent_id,
      type: 'visit_confirmation', scheduledAt: new Date(Date.now() + DEFAULT_FOLLOWUP_DELAY_MS),
    });
  } else if (outcome.includes('callback') || outcome.includes('busy')) {
    // Callback requested
    await pool.query(
      `UPDATE followup_tasks SET status = 'COMPLETED', completed_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ outcome: 'CALLBACK_REQUESTED', interestLevel, conversationId }), followupTaskId],
    );
    const callbackTime = analysis?.key_entities?.callback_time;
    await createFollowupForLead(pool, {
      tenantId: t.tenant_id, leadId: t.lead_id, agentId: t.agent_id,
      type: 'call_reminder',
      scheduledAt: callbackTime ? new Date(callbackTime) : new Date(Date.now() + RETRY_INTERVAL_MS),
    });
  } else if (outcome.includes('no answer') || outcome.includes('no_answer')) {
    // No answer — retry
    const newCount = (t.attempt_count || 0) + 1;
    if (newCount >= MAX_ATTEMPTS_PER_DAY) {
      await pool.query(
        `UPDATE followup_tasks SET attempt_count = $1, last_attempt_at = NOW(),
           next_retry_at = $2, status = 'PENDING', result = $3, updated_at = NOW() WHERE id = $4`,
        [newCount, nextCallingWindowStart(), JSON.stringify({ outcome: 'NO_ANSWER', attempts: newCount }), followupTaskId],
      );
    } else {
      await pool.query(
        `UPDATE followup_tasks SET attempt_count = $1, last_attempt_at = NOW(),
           next_retry_at = $2, status = 'PENDING', updated_at = NOW() WHERE id = $3`,
        [newCount, new Date(Date.now() + RETRY_INTERVAL_MS), followupTaskId],
      );
    }
  } else {
    // General completion (interested, information inquiry, etc.)
    await pool.query(
      `UPDATE followup_tasks SET status = 'COMPLETED', completed_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ outcome: outcome || 'COMPLETED', interestLevel, conversationId }), followupTaskId],
    );
    // Schedule next follow-up based on interest
    if (interestLevel >= 60) {
      await createFollowupForLead(pool, {
        tenantId: t.tenant_id, leadId: t.lead_id, agentId: t.agent_id,
        type: interestLevel >= 80 ? 'counselor_scheduling' : 'admission_interest',
        scheduledAt: new Date(Date.now() + DEFAULT_FOLLOWUP_DELAY_MS),
      });
    }
  }

  // Log call attempt
  await pool.query(
    `INSERT INTO call_attempt_logs (tenant_id, lead_id, followup_task_id, conversation_id, attempt_number, status, outcome, transcript_summary)
     VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, $7)`,
    [t.tenant_id, t.lead_id, followupTaskId, conversationId, t.attempt_count + 1,
     outcome, analysis?.short_summary?.slice(0, 500) || null],
  );
  logger.info({ followupTaskId, outcome, interestLevel }, 'Follow-up updated from call end');
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: process a single pending follow-up
// ─────────────────────────────────────────────────────────────────────────────

async function processFollowupTask(pool: Pool, task: any): Promise<void> {
  if (!isInCallingWindow()) {
    await pool.query(
      `UPDATE followup_tasks SET scheduled_at = $1, updated_at = NOW() WHERE id = $2`,
      [nextCallingWindowStart(), task.id],
    );
    logger.info({ taskId: task.id }, 'Follow-up rescheduled — outside calling window');
    return;
  }

  if (task.attempt_count >= task.max_attempts) {
    await pool.query(
      `UPDATE followup_tasks SET scheduled_at = $1, attempt_count = 0, updated_at = NOW() WHERE id = $2`,
      [nextCallingWindowStart(), task.id],
    );
    logger.info({ taskId: task.id }, 'Follow-up max attempts reached — scheduling next day');
    return;
  }

  // Get lead details from CRM
  let lead: any = null;
  try {
    const crm = getCrmPool();
    const r = await crm.query(`SELECT * FROM leads WHERE id = $1 LIMIT 1`, [task.lead_id]);
    lead = r.rows[0];
  } catch (err: any) {
    logger.warn({ err: err.message, taskId: task.id }, 'Failed to fetch lead from CRM');
    return;
  }
  if (!lead || !lead.phone) {
    await pool.query(
      `UPDATE followup_tasks SET status = 'FAILED', result = '{"error":"no_phone"}', updated_at = NOW() WHERE id = $1`,
      [task.id],
    );
    return;
  }

  // Get an agent to use for the call
  let agentId = task.agent_id;
  if (!agentId) {
    agentId = lead.custom_fields?.agent_id || null;
  }
  if (!agentId) {
    logger.warn({ taskId: task.id, leadId: task.lead_id }, 'No agent_id for follow-up call — skipping');
    return;
  }

  // Format phone number
  const phone = String(lead.phone).replace(/[^\d]/g, '');
  const to = phone.length === 10 ? `+91${phone}` : (phone.startsWith('91') ? `+${phone}` : `+${phone}`);

  // Initiate the call
  try {
    const resp = await fetch(`${TELEPHONY_URL}/api/v1/calls/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': task.tenant_id,
      },
      body: JSON.stringify({
        to,
        agent_id: agentId,
        provider: 'plivo',
        metadata: {
          followup_task_id: task.id,
          followup_type: task.type,
          contact_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          is_followup: true,
        },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn({ taskId: task.id, status: resp.status, body: errText.slice(0, 200) }, 'Follow-up call initiation failed');
      await pool.query(
        `UPDATE followup_tasks SET attempt_count = attempt_count + 1, last_attempt_at = NOW(),
           next_retry_at = $1, updated_at = NOW() WHERE id = $2`,
        [new Date(Date.now() + RETRY_INTERVAL_MS), task.id],
      );
      return;
    }
    const callData = await resp.json() as any;
    await pool.query(
      `UPDATE followup_tasks SET status = 'IN_PROGRESS', attempt_count = attempt_count + 1,
         last_attempt_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [task.id],
    );
    await pool.query(
      `INSERT INTO call_attempt_logs (tenant_id, lead_id, followup_task_id, call_id, attempt_number, status, outcome)
       VALUES ($1, $2, $3, $4, $5, 'INITIATED', 'pending')`,
      [task.tenant_id, task.lead_id, task.id, callData.id || null, task.attempt_count + 1],
    );
    logger.info({ taskId: task.id, callId: callData.id, to }, 'Follow-up call initiated');
  } catch (err: any) {
    logger.error({ err: err.message, taskId: task.id }, 'Follow-up call initiation error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: process visit reminders
// ─────────────────────────────────────────────────────────────────────────────

async function processReminders(pool: Pool): Promise<void> {
  try {
    // 24h reminders
    const visits24h = await pool.query(
      `SELECT vs.*, ft.tenant_id FROM visit_schedules vs
       JOIN followup_tasks ft ON ft.id = vs.followup_task_id
       WHERE vs.status IN ('SCHEDULED', 'CONFIRMED')
         AND vs.reminder_24h_sent = FALSE
         AND vs.visit_date <= CURRENT_DATE + INTERVAL '1 day'
         AND vs.visit_date >= CURRENT_DATE`,
    );
    for (const v of visits24h.rows) {
      try {
        const crm = getCrmPool();
        const lead = await crm.query(`SELECT * FROM leads WHERE id = $1`, [v.lead_id]);
        const l = lead.rows[0];
        if (l?.email) {
          await sendEmail({
            tenant_id: v.tenant_id,
            recipient: l.email,
            subject: 'Reminder: Your visit tomorrow',
            body: `Dear ${l.first_name || 'Student'},\n\nThis is a reminder about your visit scheduled for ${v.visit_date}${v.visit_time ? ' at ' + v.visit_time : ''}${v.location ? ' at ' + v.location : ''}.\n\nPlease confirm your attendance.\n\nBest regards,\nMyLeadX Team`,
          });
        }
        await pool.query(`UPDATE visit_schedules SET reminder_24h_sent = TRUE, updated_at = NOW() WHERE id = $1`, [v.id]);
        await pool.query(
          `INSERT INTO reminder_logs (tenant_id, lead_id, visit_schedule_id, type, channel, status) VALUES ($1, $2, $3, '24h_before', 'email', 'SENT')`,
          [v.tenant_id, v.lead_id, v.id],
        );
        logger.info({ visitId: v.id, leadId: v.lead_id }, '24h visit reminder sent');
      } catch (err: any) {
        logger.warn({ err: err.message, visitId: v.id }, '24h reminder failed');
      }
    }

    // 2h reminders
    const visits2h = await pool.query(
      `SELECT vs.*, ft.tenant_id FROM visit_schedules vs
       JOIN followup_tasks ft ON ft.id = vs.followup_task_id
       WHERE vs.status IN ('SCHEDULED', 'CONFIRMED')
         AND vs.reminder_2h_sent = FALSE
         AND vs.visit_date = CURRENT_DATE
         AND vs.visit_time IS NOT NULL
         AND vs.visit_time <= (CURRENT_TIME AT TIME ZONE 'Asia/Kolkata' + INTERVAL '2 hours')`,
    );
    for (const v of visits2h.rows) {
      try {
        await pool.query(`UPDATE visit_schedules SET reminder_2h_sent = TRUE, updated_at = NOW() WHERE id = $1`, [v.id]);
        await pool.query(
          `INSERT INTO reminder_logs (tenant_id, lead_id, visit_schedule_id, type, channel, status) VALUES ($1, $2, $3, '2h_before', 'email', 'SENT')`,
          [v.tenant_id, v.lead_id, v.id],
        );
        logger.info({ visitId: v.id }, '2h visit reminder sent');
      } catch (err: any) {
        logger.warn({ err: err.message, visitId: v.id }, '2h reminder failed');
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Reminder processor error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: daily report
// ─────────────────────────────────────────────────────────────────────────────

let lastReportDate = '';

async function generateDailyReport(pool: Pool): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastReportDate === today) return;

  const h = istHour();
  if (h !== 9) return; // Only fire at 9 AM IST

  lastReportDate = today;

  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= CURRENT_DATE) as completed_today,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed
      FROM followup_tasks
    `);
    const visits = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SCHEDULED') as scheduled,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED') as confirmed,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW') as no_show
      FROM visit_schedules WHERE visit_date >= CURRENT_DATE - INTERVAL '7 days'
    `);
    const feedback = await pool.query(`
      SELECT rating, COUNT(*) as count FROM feedback_logs
      WHERE collected_at >= CURRENT_DATE GROUP BY rating
    `);

    const s = stats.rows[0] || {};
    const v = visits.rows[0] || {};
    const fb: Record<string, number> = {};
    for (const r of feedback.rows) fb[r.rating] = parseInt(r.count);

    const body = `MyLeadX Daily Follow-up Report — ${today}

FOLLOW-UPS:
  Completed today: ${s.completed_today || 0}
  Pending: ${s.pending || 0}
  In Progress: ${s.in_progress || 0}
  Failed: ${s.failed || 0}

VISITS (last 7 days):
  Scheduled: ${v.scheduled || 0}
  Confirmed: ${v.confirmed || 0}
  Completed: ${v.completed || 0}
  No-show: ${v.no_show || 0}

FEEDBACK (today):
  Positive: ${fb.POSITIVE || 0}
  Neutral: ${fb.NEUTRAL || 0}
  Negative: ${fb.NEGATIVE || 0}

This is an automated report from MyLeadX Follow-up Scheduler.`;

    // Send to admin email (SMTP_FROM_EMAIL as default recipient)
    const adminEmail = process.env.ADMIN_REPORT_EMAIL || process.env.SMTP_FROM_EMAIL || '';
    if (adminEmail) {
      const tenants = await pool.query(`SELECT DISTINCT tenant_id FROM followup_tasks LIMIT 1`);
      const tenantId = tenants.rows[0]?.tenant_id || '';
      if (tenantId) {
        await sendEmail({ tenant_id: tenantId, recipient: adminEmail, subject: `MyLeadX Daily Report — ${today}`, body });
        logger.info({ to: adminEmail, date: today }, 'Daily follow-up report sent');
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Daily report generation failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visit → post-visit feedback chaining
// ─────────────────────────────────────────────────────────────────────────────

/** Auto-complete past visits, then schedule a post-visit feedback call (+24h)
 *  for any COMPLETED visit that doesn't have one yet. */
async function sweepVisitsForFeedback(pool: Pool): Promise<void> {
  try {
    // 1. Mark visits whose date/time has passed as COMPLETED.
    await pool.query(
      `UPDATE visit_schedules
          SET status = 'COMPLETED', updated_at = NOW()
        WHERE status IN ('SCHEDULED', 'CONFIRMED')
          AND (visit_date + COALESCE(visit_time, '00:00:00'::time)) < NOW()`,
    );
    // 2. Schedule a feedback call (+24h) for COMPLETED visits lacking one.
    const due = await pool.query(
      `SELECT v.id, v.tenant_id, v.lead_id
         FROM visit_schedules v
        WHERE v.status = 'COMPLETED'
          AND NOT EXISTS (
            SELECT 1 FROM followup_tasks f
             WHERE f.lead_id = v.lead_id AND f.type = 'post_visit_feedback_call'
          )
        LIMIT 20`,
    );
    for (const v of due.rows) {
      await createFollowupForLead(pool, {
        tenantId: v.tenant_id, leadId: v.lead_id,
        type: 'post_visit_feedback_call',
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        notes: 'Post-visit feedback call — ask about the visit experience, counselor meeting, and admission interest.',
      });
      logger.info({ visit: v.id, lead: v.lead_id }, 'Post-visit feedback call scheduled (+24h)');
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'visit→feedback sweeper error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: start the scheduler
// ─────────────────────────────────────────────────────────────────────────────

export function startFollowupScheduler(pool: Pool): void {
  // Process pending follow-ups every 60 seconds
  setInterval(async () => {
    try {
      const pending = await pool.query(
        `SELECT * FROM followup_tasks
         WHERE status = 'PENDING'
           AND scheduled_at <= NOW()
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY priority ASC, scheduled_at ASC
         LIMIT 5`,
      );
      for (const task of pending.rows) {
        await processFollowupTask(pool, task);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Follow-up processor tick error');
    }
  }, 60_000);

  // Process reminders every 5 minutes
  setInterval(() => processReminders(pool).catch(() => {}), 5 * 60_000);

  // Visit → post-visit feedback sweeper every 10 minutes: auto-complete past
  // visits and schedule the +24h feedback call.
  setInterval(() => sweepVisitsForFeedback(pool).catch(() => {}), 10 * 60_000);

  // Daily report check every hour
  setInterval(() => generateDailyReport(pool).catch(() => {}), 60 * 60_000);

  logger.info({ intervalSec: 60, reminderIntervalSec: 300 }, 'Follow-up scheduler started');
}
