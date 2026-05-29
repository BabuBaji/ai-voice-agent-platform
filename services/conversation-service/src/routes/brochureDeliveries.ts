/**
 * Brochure-delivery tracking REST API. Reads/writes lead_brochure_deliveries
 * (the additive tracking layer) and exposes the Sent / Not-Sent / Pending
 * queues + a per-lead timeline + manual send/retry/status endpoints.
 *
 * Mounted at /api/v1 in app.ts. All routes are tenant-scoped via x-tenant-id.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { sendEmail, sendWhatsApp, sendSms } from '../services/communications';
import {
  recordBrochureDelivery, isDuplicateBrochure, fetchLeadProfiles,
  SENT_STATUSES, NOT_SENT_STATUSES, PENDING_STATUSES,
} from '../services/brochureDelivery';

export const brochureDeliveryRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

/** Shared list query for a given status set (sent / not-sent / pending). */
async function listByStatuses(
  res: Response, tenantId: string, statuses: readonly string[], page: number, limit: number,
): Promise<void> {
  const offset = (page - 1) * limit;
  const placeholders = statuses.map((_, i) => `$${i + 2}`).join(', ');
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT * FROM lead_brochure_deliveries
        WHERE tenant_id = $1 AND send_status IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT $${statuses.length + 2} OFFSET $${statuses.length + 3}`,
      [tenantId, ...statuses, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*) FROM lead_brochure_deliveries
        WHERE tenant_id = $1 AND send_status IN (${placeholders})`,
      [tenantId, ...statuses],
    ),
  ]);
  // Enrich each delivery with the lead's profile (name/mobile/college/marks/
  // rank/score) from crm_db so the Follow-ups UI can show full details.
  const profiles = await fetchLeadProfiles(tenantId, rows.rows.map((r: any) => r.lead_id));
  const data = rows.rows.map((r: any) => ({ ...r, lead: profiles[r.lead_id] || null }));
  res.json({ data, total: parseInt(count.rows[0].count, 10), page, pageSize: limit });
}

function parsePaging(req: Request): { page: number; limit: number } {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  return { page, limit };
}

// ── Queues ────────────────────────────────────────────────────────────────
brochureDeliveryRouter.get('/brochures/deliveries/sent', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const { page, limit } = parsePaging(req);
    await listByStatuses(res, tenantId, SENT_STATUSES, page, limit);
  } catch (err) { next(err); }
});

brochureDeliveryRouter.get('/brochures/deliveries/not-sent', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const { page, limit } = parsePaging(req);
    await listByStatuses(res, tenantId, NOT_SENT_STATUSES, page, limit);
  } catch (err) { next(err); }
});

brochureDeliveryRouter.get('/brochures/deliveries/pending', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const { page, limit } = parsePaging(req);
    await listByStatuses(res, tenantId, PENDING_STATUSES, page, limit);
  } catch (err) { next(err); }
});

/** Lightweight counts for the tab badges / KPI strip. */
brochureDeliveryRouter.get('/brochures/deliveries/summary', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT send_status, COUNT(*)::int AS n
         FROM lead_brochure_deliveries WHERE tenant_id = $1 GROUP BY send_status`,
      [tenantId],
    );
    const bucket = { sent: 0, not_sent: 0, pending: 0 };
    for (const row of r.rows) {
      if ((SENT_STATUSES as readonly string[]).includes(row.send_status)) bucket.sent += row.n;
      else if ((NOT_SENT_STATUSES as readonly string[]).includes(row.send_status)) bucket.not_sent += row.n;
      else if ((PENDING_STATUSES as readonly string[]).includes(row.send_status)) bucket.pending += row.n;
    }
    res.json({ ...bucket, by_status: r.rows });
  } catch (err) { next(err); }
});

// ── Per-lead timeline ───────────────────────────────────────────────────────
brochureDeliveryRouter.get('/brochures/leads/:leadId/deliveries', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM lead_brochure_deliveries
        WHERE tenant_id = $1 AND lead_id = $2 ORDER BY created_at DESC`,
      [tenantId, req.params.leadId],
    );
    const profiles = await fetchLeadProfiles(tenantId, [req.params.leadId]);
    res.json({ data: r.rows, lead: profiles[req.params.leadId] || null });
  } catch (err) { next(err); }
});

// ── Manual send (multi-channel) + track ─────────────────────────────────────
const sendSchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'sms']),
  recipient: z.string().min(3),
  brochure_url: z.string().min(1),      // hosted file URL OR plain link
  brochure_id: z.string().uuid().optional(),
  brochure_name: z.string().optional(),
  college_name: z.string().optional(),
  course_name: z.string().optional(),
  branch_name: z.string().optional(),
  conversation_id: z.string().uuid().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
});

function toE164(raw: string): string {
  const s = String(raw).trim();
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^91\d{10}$/.test(d)) return `+${d}`;
  return `+${d}`;
}

brochureDeliveryRouter.post('/brochures/leads/:leadId/send', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const leadId = req.params.leadId;
    const d = sendSchema.parse(req.body || {});
    const name = d.brochure_name || 'Brochure';

    // Duplicate guard (same lead+brochure+channel within 24h).
    if (await isDuplicateBrochure(tenantId, leadId, d.brochure_id || null, d.channel)) {
      const id = await recordBrochureDelivery({
        tenantId, leadId, conversationId: d.conversation_id || null, channel: d.channel,
        recipientEmail: d.channel === 'email' ? d.recipient : null,
        recipientMobile: d.channel !== 'email' ? toE164(d.recipient) : null,
        brochureId: d.brochure_id || null, brochureName: name, brochureUrl: d.brochure_url,
        collegeName: d.college_name || null, courseName: d.course_name || null, branchName: d.branch_name || null,
        result: { ok: false }, forcedStatus: 'SKIPPED_DUPLICATE',
      });
      res.json({ ok: false, skipped: 'SKIPPED_DUPLICATE', delivery_id: id });
      return;
    }

    const body = d.message
      || `Here is the brochure${d.college_name ? ` for ${d.college_name}` : ''}: ${d.brochure_url}`;
    let result;
    if (d.channel === 'email') {
      result = await sendEmail({
        tenant_id: tenantId, lead_id: leadId, conversation_id: d.conversation_id,
        recipient: d.recipient, subject: d.subject || 'Your requested brochure', body,
        attachments: [{ name, url: d.brochure_url }],
      } as any);
    } else if (d.channel === 'whatsapp') {
      result = await sendWhatsApp({
        tenant_id: tenantId, lead_id: leadId, conversation_id: d.conversation_id,
        recipient: toE164(d.recipient), message: body, attachments: [{ name, url: d.brochure_url }],
      } as any);
    } else {
      result = await sendSms({
        tenant_id: tenantId, lead_id: leadId, conversation_id: d.conversation_id,
        recipient: toE164(d.recipient), message: body,
      } as any);
    }

    const deliveryId = await recordBrochureDelivery({
      tenantId, leadId, conversationId: d.conversation_id || null, channel: d.channel,
      recipientEmail: d.channel === 'email' ? d.recipient : null,
      recipientMobile: d.channel !== 'email' ? toE164(d.recipient) : null,
      brochureId: d.brochure_id || null, brochureName: name, brochureUrl: d.brochure_url,
      collegeName: d.college_name || null, courseName: d.course_name || null, branchName: d.branch_name || null,
      result,
    });
    res.json({ ...result, delivery_id: deliveryId });
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// ── Manual retry of a failed delivery ───────────────────────────────────────
brochureDeliveryRouter.post('/brochures/deliveries/:id/retry', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM lead_brochure_deliveries WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId],
    );
    const row = r.rows[0];
    if (!row) { res.status(404).json({ error: 'Not Found' }); return; }

    const url = row.brochure_url;
    const name = row.brochure_name || 'Brochure';
    const body = `Here is the brochure${row.college_name ? ` for ${row.college_name}` : ''}: ${url}`;
    let result;
    if (row.channel === 'email') {
      result = await sendEmail({
        tenant_id: tenantId, lead_id: row.lead_id, conversation_id: row.conversation_id,
        recipient: row.recipient_email, subject: 'Your requested brochure', body,
        attachments: url ? [{ name, url }] : undefined,
      } as any);
    } else if (row.channel === 'whatsapp') {
      result = await sendWhatsApp({
        tenant_id: tenantId, lead_id: row.lead_id, conversation_id: row.conversation_id,
        recipient: row.recipient_mobile, message: body, attachments: url ? [{ name, url }] : undefined,
      } as any);
    } else {
      result = await sendSms({
        tenant_id: tenantId, lead_id: row.lead_id, conversation_id: row.conversation_id,
        recipient: row.recipient_mobile, message: body,
      } as any);
    }

    const newStatus = result.ok ? 'SENT' : 'FAILED';
    await pool.query(
      `UPDATE lead_brochure_deliveries
          SET send_status = $1::text,
              failure_reason = $2,
              retry_count = retry_count + 1,
              sent_at = CASE WHEN $1::text = 'SENT' THEN NOW() ELSE sent_at END,
              communication_log_id = COALESCE($3, communication_log_id),
              next_retry_at = NULL,
              updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5`,
      [newStatus, result.ok ? null : (result.error || null), result.log_id || null, req.params.id, tenantId],
    );
    res.json({ ok: result.ok, send_status: newStatus, error: result.ok ? undefined : result.error });
  } catch (err) { next(err); }
});

// ── Status update (webhook / manual correction) ─────────────────────────────
const statusSchema = z.object({
  send_status: z.string().optional(),
  delivery_status: z.string().optional(),
  delivered_at: z.string().optional(),
  opened_at: z.string().optional(),
  read_at: z.string().optional(),
  failure_reason: z.string().optional(),
});
brochureDeliveryRouter.put('/brochures/deliveries/:id/status', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = statusSchema.parse(req.body || {});
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const [col, val] of Object.entries(d)) {
      if (val === undefined) continue;
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    }
    if (sets.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    vals.push(req.params.id, tenantId);
    const r = await pool.query(
      `UPDATE lead_brochure_deliveries SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
      vals,
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});
