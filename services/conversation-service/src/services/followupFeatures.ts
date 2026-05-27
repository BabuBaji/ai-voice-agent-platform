import { Pool } from 'pg';
import pino from 'pino';
import { sendEmail, sendWhatsApp, sendSms } from './communications';

const logger = pino({ transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined });
const TELEPHONY_URL = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:3002';
const CRM_DB_URL = process.env.CRM_DB_URL || 'postgresql://voiceagent:voiceagent_dev@localhost:5432/crm_db';
let crmPool: Pool | null = null;
function getCrmPool(): Pool { if (!crmPool) crmPool = new Pool({ connectionString: CRM_DB_URL }); return crmPool; }

// ─── 1. Multi-Channel Follow-up ─────────────────────────────────────────────

export async function attemptMultiChannel(pool: Pool, opts: {
  tenantId: string; leadId: string; agentId?: string; followupTaskId: string; message: string;
}): Promise<{ channel: string; success: boolean }> {
  const crm = getCrmPool();
  const lead = (await crm.query(`SELECT * FROM leads WHERE id = $1`, [opts.leadId])).rows[0];
  if (!lead) return { channel: 'none', success: false };
  const phone = lead.phone ? (lead.phone.startsWith('+') ? lead.phone : `+91${lead.phone.replace(/\D/g, '')}`) : '';
  const email = lead.email || '';

  // Try call
  if (phone && opts.agentId) {
    try {
      const r = await fetch(`${TELEPHONY_URL}/api/v1/calls/initiate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-id': opts.tenantId },
        body: JSON.stringify({ to: phone, agent_id: opts.agentId, provider: 'plivo', metadata: { followup_task_id: opts.followupTaskId, contact_name: `${lead.first_name} ${lead.last_name}`.trim() } }),
      });
      if (r.ok) { logger.info({ channel: 'call', leadId: opts.leadId }, 'Multi-channel: call succeeded'); return { channel: 'call', success: true }; }
    } catch {}
  }
  // Try WhatsApp
  if (phone) {
    try {
      const r = await sendWhatsApp({ tenant_id: opts.tenantId, recipient: phone, message: opts.message });
      if (r.ok) { logger.info({ channel: 'whatsapp', leadId: opts.leadId }, 'Multi-channel: WhatsApp succeeded'); return { channel: 'whatsapp', success: true }; }
    } catch {}
  }
  // Try SMS
  if (phone) {
    try {
      const r = await sendSms({ tenant_id: opts.tenantId, recipient: phone, message: opts.message });
      if (r.ok) { logger.info({ channel: 'sms', leadId: opts.leadId }, 'Multi-channel: SMS succeeded'); return { channel: 'sms', success: true }; }
    } catch {}
  }
  // Try email
  if (email) {
    try {
      const r = await sendEmail({ tenant_id: opts.tenantId, recipient: email, subject: 'Follow-up from MyLeadX', body: opts.message });
      if (r.ok) { logger.info({ channel: 'email', leadId: opts.leadId }, 'Multi-channel: email succeeded'); return { channel: 'email', success: true }; }
    } catch {}
  }
  return { channel: 'none', success: false };
}

// ─── 2. Custom Follow-up Sequences ──────────────────────────────────────────

export type SequenceStep = { dayOffset: number; channel: 'call' | 'whatsapp' | 'sms' | 'email'; type: string; message?: string };

export const DEFAULT_SEQUENCE: SequenceStep[] = [
  { dayOffset: 0, channel: 'call', type: 'admission_interest' },
  { dayOffset: 1, channel: 'call', type: 'admission_interest' },
  { dayOffset: 3, channel: 'whatsapp', type: 'brochure_reminder', message: 'Hi {name}! Did you review the brochure for {university}? Our team is ready to help.' },
  { dayOffset: 5, channel: 'call', type: 'counselor_scheduling' },
  { dayOffset: 7, channel: 'email', type: 'admission_interest', message: 'Dear {name}, you showed interest in {course} at {university}. Schedule a campus visit?' },
  { dayOffset: 14, channel: 'sms', type: 'feedback_collection', message: 'Hi {name}, this is MyLeadX. We would love your feedback. Reply YES if interested.' },
];

export async function createSequenceForLead(pool: Pool, opts: {
  tenantId: string; leadId: string; agentId?: string; sequence?: SequenceStep[];
}): Promise<string[]> {
  const seq = opts.sequence || DEFAULT_SEQUENCE;
  const crm = getCrmPool();
  const lead = (await crm.query(`SELECT * FROM leads WHERE id = $1`, [opts.leadId])).rows[0];
  const cf = lead?.custom_fields || {};
  const name = `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim() || 'Student';
  const ids: string[] = [];
  const baseDate = new Date(lead?.created_at || Date.now());

  for (let i = 0; i < seq.length; i++) {
    const step = seq[i];
    const scheduledAt = new Date(baseDate.getTime() + step.dayOffset * 86400000);
    const msg = (step.message || '').replace(/\{name\}/g, name).replace(/\{university\}/g, cf.interested_university || '').replace(/\{course\}/g, cf.interested_course || '');
    const r = await pool.query(
      `INSERT INTO followup_tasks (tenant_id, lead_id, agent_id, type, scheduled_at, preferred_channel, sequence_step, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [opts.tenantId, opts.leadId, opts.agentId || null, step.type, scheduledAt, step.channel, i, msg || null],
    );
    ids.push(r.rows[0].id);
  }
  logger.info({ leadId: opts.leadId, steps: ids.length }, 'Follow-up sequence created');
  return ids;
}

// ─── 3. WhatsApp/SMS Reminders ───────────────────────────────────────────────

export async function sendReminder(pool: Pool, opts: {
  tenantId: string; leadId: string; channel: 'whatsapp' | 'sms' | 'email'; type: string; message: string;
  visitScheduleId?: string; followupTaskId?: string;
}): Promise<boolean> {
  const crm = getCrmPool();
  const lead = (await crm.query(`SELECT * FROM leads WHERE id = $1`, [opts.leadId])).rows[0];
  if (!lead) return false;
  const phone = lead.phone ? `+91${lead.phone.replace(/\D/g, '')}` : '';
  let ok = false;
  try {
    if (opts.channel === 'whatsapp' && phone) ok = (await sendWhatsApp({ tenant_id: opts.tenantId, recipient: phone, message: opts.message })).ok;
    else if (opts.channel === 'sms' && phone) ok = (await sendSms({ tenant_id: opts.tenantId, recipient: phone, message: opts.message })).ok;
    else if (opts.channel === 'email' && lead.email) ok = (await sendEmail({ tenant_id: opts.tenantId, recipient: lead.email, subject: 'Reminder from MyLeadX', body: opts.message })).ok;
  } catch {}
  await pool.query(
    `INSERT INTO reminder_logs (tenant_id, lead_id, visit_schedule_id, followup_task_id, type, channel, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.tenantId, opts.leadId, opts.visitScheduleId || null, opts.followupTaskId || null, opts.type, opts.channel, ok ? 'SENT' : 'FAILED'],
  );
  return ok;
}

// ─── 4. Auto-Reschedule ─────────────────────────────────────────────────────

export async function autoRescheduleVisit(pool: Pool, opts: { visitScheduleId: string; tenantId: string; reason: string }): Promise<Date> {
  const v = (await pool.query(`SELECT * FROM visit_schedules WHERE id = $1`, [opts.visitScheduleId])).rows[0];
  let newDate = new Date(v.visit_date);
  newDate.setDate(newDate.getDate() + 2);
  while (newDate.getDay() === 0 || newDate.getDay() === 6) newDate.setDate(newDate.getDate() + 1);
  await pool.query(
    `UPDATE visit_schedules SET visit_date = $1, status = 'RESCHEDULED', reschedule_count = reschedule_count + 1,
       reminder_24h_sent = FALSE, reminder_2h_sent = FALSE, notes = COALESCE(notes,'') || $2, updated_at = NOW() WHERE id = $3`,
    [newDate.toISOString().slice(0, 10), `\nAuto-rescheduled: ${opts.reason}`, opts.visitScheduleId],
  );
  logger.info({ visitId: opts.visitScheduleId, newDate }, 'Visit auto-rescheduled');
  return newDate;
}

// ─── 5. Counselor Auto-Assignment ────────────────────────────────────────────

export async function assignCounselor(pool: Pool, opts: { tenantId: string; visitScheduleId: string }): Promise<{ name: string; phone: string } | null> {
  try {
    const r = await pool.query(
      `SELECT id, name, COALESCE(mobile, '') as phone FROM counselors
       WHERE tenant_id = $1 AND availability_status = 'available'
       ORDER BY active_task_count ASC, last_assigned_at ASC NULLS FIRST LIMIT 1`, [opts.tenantId]);
    if (!r.rows.length) return null;
    const c = r.rows[0];
    await pool.query(`UPDATE visit_schedules SET counselor_name = $1, counselor_phone = $2, updated_at = NOW() WHERE id = $3`, [c.name, c.phone, opts.visitScheduleId]);
    await pool.query(`UPDATE counselors SET active_task_count = active_task_count + 1, last_assigned_at = NOW() WHERE id = $1`, [c.id]);
    logger.info({ counselor: c.name, visitId: opts.visitScheduleId }, 'Counselor assigned');
    return { name: c.name, phone: c.phone };
  } catch { return null; }
}

// ─── 6. Lead Score Updater ───────────────────────────────────────────────────

const SCORE_DELTAS: Record<string, number> = { call_answered: 10, visit_confirmed: 20, feedback_positive: 15, no_response: -5, not_interested: -20 };

export async function updateLeadScore(pool: Pool, opts: { leadId: string; tenantId: string; event: string }): Promise<number> {
  const crm = getCrmPool();
  const lead = (await crm.query(`SELECT score FROM leads WHERE id = $1`, [opts.leadId])).rows[0];
  const prev = lead?.score || 50;
  const delta = SCORE_DELTAS[opts.event] || 0;
  const newScore = Math.max(0, Math.min(100, prev + delta));
  await crm.query(`UPDATE leads SET score = $1, updated_at = NOW() WHERE id = $2`, [newScore, opts.leadId]);
  await pool.query(`INSERT INTO lead_score_history (tenant_id, lead_id, previous_score, new_score, event) VALUES ($1,$2,$3,$4,$5)`,
    [opts.tenantId, opts.leadId, prev, newScore, opts.event]);
  logger.info({ leadId: opts.leadId, prev, newScore, event: opts.event }, 'Lead score updated');
  return newScore;
}

// ─── 7. Holiday/Weekend Skip ─────────────────────────────────────────────────

export function getNextBusinessDay(from: Date, holidays?: string[]): Date {
  const d = new Date(from);
  const holidaySet = new Set(holidays || []);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6 || holidaySet.has(d.toISOString().slice(0, 10))) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(10, 0, 0, 0); // 10 AM IST
  return d;
}

// ─── 8. Priority Escalation ──────────────────────────────────────────────────

export async function escalateHotLead(pool: Pool, opts: { tenantId: string; leadId: string; agentId?: string }): Promise<string> {
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
  const r = await pool.query(
    `INSERT INTO followup_tasks (tenant_id, lead_id, agent_id, type, scheduled_at, priority, notes)
     VALUES ($1, $2, $3, 'counselor_scheduling', $4, 1, 'HOT LEAD — escalated for immediate follow-up') RETURNING id`,
    [opts.tenantId, opts.leadId, opts.agentId || null, scheduledAt],
  );
  // Send immediate WhatsApp
  try {
    const crm = getCrmPool();
    const lead = (await crm.query(`SELECT * FROM leads WHERE id = $1`, [opts.leadId])).rows[0];
    if (lead?.phone) {
      const phone = lead.phone.startsWith('+') ? lead.phone : `+91${lead.phone.replace(/\D/g, '')}`;
      await sendWhatsApp({ tenant_id: opts.tenantId, recipient: phone, message: `Hi ${lead.first_name || 'there'}! Our senior counselor will call you shortly to help with your admission process.` });
    }
  } catch {}
  logger.info({ leadId: opts.leadId, taskId: r.rows[0].id }, 'Hot lead escalated — 2h priority follow-up created');
  return r.rows[0].id;
}

// ─── 9. Team Notifications ───────────────────────────────────────────────────

export async function notifyTeam(pool: Pool, opts: { tenantId: string; event: string; leadId: string; details: string }): Promise<void> {
  const adminEmail = process.env.ADMIN_REPORT_EMAIL || process.env.SMTP_FROM_EMAIL || '';
  if (!adminEmail) return;
  const subject = `[MyLeadX Alert] ${opts.event.replace(/_/g, ' ')}`;
  try {
    await sendEmail({ tenant_id: opts.tenantId, recipient: adminEmail, subject, body: `${opts.details}\n\nLead ID: ${opts.leadId}\nEvent: ${opts.event}\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` });
    await pool.query(`INSERT INTO team_notification_logs (tenant_id, event, lead_id, channel, recipient, details) VALUES ($1,$2,$3,'email',$4,$5)`,
      [opts.tenantId, opts.event, opts.leadId, adminEmail, opts.details]);
    logger.info({ event: opts.event, leadId: opts.leadId }, 'Team notification sent');
  } catch (err: any) { logger.warn({ err: err.message }, 'Team notification failed'); }
}

// ─── 10. Follow-up Analytics ─────────────────────────────────────────────────

export async function getFollowupAnalytics(pool: Pool, opts: { tenantId: string; dateFrom?: string; dateTo?: string }) {
  const from = opts.dateFrom || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = opts.dateTo || new Date().toISOString().slice(0, 10);
  const [funnel, attempts, channels, weekly] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='COMPLETED') as completed, COUNT(*) FILTER (WHERE status='PENDING') as pending,
      COUNT(*) FILTER (WHERE status='FAILED') as failed FROM followup_tasks WHERE tenant_id=$1 AND created_at>=$2 AND created_at<=$3`, [opts.tenantId, from, to + ' 23:59:59']),
    pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='COMPLETED') as successful, AVG(attempt_number) as avg
      FROM call_attempt_logs WHERE tenant_id=$1 AND initiated_at>=$2`, [opts.tenantId, from]),
    pool.query(`SELECT channel, COUNT(*) as cnt, COUNT(*) FILTER (WHERE status IN ('SENT','delivered')) as ok
      FROM reminder_logs WHERE tenant_id=$1 AND sent_at>=$2 GROUP BY channel`, [opts.tenantId, from]),
    pool.query(`SELECT DATE_TRUNC('week',created_at)::date as week, COUNT(*) as total, COUNT(*) FILTER (WHERE status='COMPLETED') as completed
      FROM followup_tasks WHERE tenant_id=$1 AND created_at>=$2 GROUP BY week ORDER BY week`, [opts.tenantId, from]),
  ]);
  return {
    period: { from, to }, funnel: funnel.rows[0],
    calls: { total: parseInt(attempts.rows[0]?.total || '0'), successful: parseInt(attempts.rows[0]?.successful || '0'), avgAttempts: parseFloat(attempts.rows[0]?.avg || '0').toFixed(1) },
    channels: channels.rows.map((r: any) => ({ channel: r.channel, attempts: parseInt(r.cnt), delivered: parseInt(r.ok), rate: r.cnt > 0 ? Math.round(parseInt(r.ok) / parseInt(r.cnt) * 100) : 0 })),
    weeklyTrend: weekly.rows.map((r: any) => ({ week: r.week, total: parseInt(r.total), completed: parseInt(r.completed) })),
  };
}
