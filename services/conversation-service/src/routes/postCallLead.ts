import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { sendEmail, sendWhatsApp, sendSms } from '../services/communications';
import { enqueueLeadRecall } from '../services/recallScheduler';

/**
 * Best-effort: when a brochure send succeeds on whatsapp/sms/email, push this
 * lead into the recall queue so we follow up. Looks up the lead's name/phone
 * from CRM when missing. Idempotent on (tenant_id, lead_id) at the DB level.
 */
async function enqueueRecallFromBrochureSend(
  tenantId: string,
  leadId: string | undefined,
  recipient: string,
  conversationId?: string | null,
): Promise<void> {
  if (!leadId) return;
  // Pull phone + lead_status from CRM (best-effort). If lookup fails, fall
  // back to the recipient address we sent the brochure to.
  let phone = recipient.startsWith('+') ? recipient : `+${recipient}`;
  let leadStatus: string | null = null;
  try {
    const crmUrl = process.env.CRM_SERVICE_URL || 'http://localhost:8081';
    const resp = await fetch(`${crmUrl}/leads/${leadId}`, {
      headers: { 'x-tenant-id': tenantId },
    });
    if (resp.ok) {
      const row: any = await resp.json();
      const data = row?.data || row;
      if (data?.phone) {
        const digits = String(data.phone).replace(/\D/g, '');
        phone = digits.length === 10 && /^[6-9]/.test(digits) ? `+91${digits}` : (data.phone.startsWith('+') ? data.phone : `+${digits}`);
      }
      leadStatus = data?.custom_fields?.extended_lead_status || null;
    }
  } catch { /* non-fatal */ }
  // Best-effort agent lookup: any prior conversation that talked to this phone.
  let agentId: string | null = null;
  try {
    const digits = phone.replace(/\D/g, '');
    const ag = await pool.query(
      `SELECT agent_id FROM conversations
        WHERE tenant_id = $1 AND agent_id IS NOT NULL
          AND regexp_replace(COALESCE(called_number, ''), '\\D', '', 'g') = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, digits],
    );
    agentId = ag.rows[0]?.agent_id || null;
  } catch { /* non-fatal */ }
  void enqueueLeadRecall({
    tenant_id: tenantId,
    lead_id: leadId,
    conversation_id: conversationId || null,
    agent_id: agentId,
    phone_number: phone,
    lead_status: leadStatus,
  });
}

export const postCallLeadRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

// =========================================================================
// FOLLOW-UP TASKS — /api/v1/follow-ups
// =========================================================================

postCallLeadRouter.get('/follow-ups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const status = (req.query.status as string) || '';
    const assignedTo = (req.query.assigned_to as string) || '';
    const priority = (req.query.priority as string) || '';
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || '0'), 10) || 0;

    const wheres: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (status) { params.push(status); wheres.push(`status = $${params.length}`); }
    if (assignedTo) { params.push(assignedTo); wheres.push(`assigned_to = $${params.length}::uuid`); }
    if (priority) { params.push(priority); wheres.push(`priority = $${params.length}`); }

    const sql = `
      SELECT t.id, t.lead_id, t.conversation_id, t.assigned_to, t.task_type,
             t.scheduled_at, t.priority, t.status, t.notes, t.completed_at,
             t.created_at, t.updated_at,
             c.name AS counselor_name, c.mobile AS counselor_mobile
      FROM follow_up_tasks t
      LEFT JOIN counselors c ON c.id = t.assigned_to
      WHERE ${wheres.join(' AND ')}
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
        t.scheduled_at ASC
      LIMIT ${limit} OFFSET ${offset}`;
    const r = await pool.query(sql, params);
    res.json({ data: r.rows, count: r.rows.length, limit, offset });
  } catch (err) { next(err); }
});

const updateTaskSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'done', 'cancelled', 'overdue']).optional(),
  scheduled_at: z.string().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
});
postCallLeadRouter.put('/follow-ups/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = updateTaskSchema.parse(req.body || {});
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    for (const k of Object.keys(data) as Array<keyof typeof data>) {
      if (data[k] === undefined) continue;
      params.push(data[k]);
      const cast = k === 'assigned_to' ? '::uuid' : k === 'scheduled_at' ? '::timestamptz' : '';
      sets.push(`${k} = $${params.length}${cast}`);
    }
    if (data.status === 'done') sets.push('completed_at = NOW()');
    params.push(req.params.id);
    params.push(tenantId);
    const r = await pool.query(
      `UPDATE follow_up_tasks SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING *`,
      params,
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// =========================================================================
// COUNSELORS — /api/v1/counselors
// =========================================================================

postCallLeadRouter.get('/counselors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT id, name, mobile, email, languages, assigned_colleges, assigned_courses,
              availability_status, active_task_count, last_assigned_at, created_at
       FROM counselors WHERE tenant_id = $1 ORDER BY name ASC`,
      [tenantId],
    );
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});

const counselorSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().max(20).optional(),
  email: z.string().email().optional(),
  languages: z.array(z.string()).optional(),
  assigned_colleges: z.array(z.string()).optional(),
  assigned_courses: z.array(z.string()).optional(),
  availability_status: z.enum(['available', 'busy', 'offline']).optional(),
});
postCallLeadRouter.post('/counselors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = counselorSchema.parse(req.body || {});
    const r = await pool.query(
      `INSERT INTO counselors
         (tenant_id, name, mobile, email, languages, assigned_colleges, assigned_courses, availability_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'available'))
       RETURNING *`,
      [
        tenantId, data.name, data.mobile || null, data.email || null,
        data.languages || null, data.assigned_colleges || null,
        data.assigned_courses || null, data.availability_status || null,
      ],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// =========================================================================
// COLLEGE BROCHURES — /api/v1/college-brochures
// =========================================================================

postCallLeadRouter.get('/college-brochures', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const college = (req.query.college as string) || '';
    const params: any[] = [tenantId];
    let where = 'tenant_id = $1';
    if (college) { params.push(`%${college}%`); where += ` AND college_name ILIKE $${params.length}`; }
    const r = await pool.query(
      `SELECT * FROM college_brochures WHERE ${where}
       ORDER BY verified_status DESC, college_name ASC LIMIT 100`,
      params,
    );
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});

const brochureSchema = z.object({
  college_name: z.string().min(1),
  course: z.string().optional(),
  branch: z.string().optional(),
  brochure_url: z.string().url().optional(),
  file_url: z.string().url().optional(),
  source: z.enum(['admin_upload', 'tavily_search', 'manual_entry']).optional(),
  source_url: z.string().url().optional(),
  verified_status: z.enum(['verified', 'unverified', 'rejected']).optional(),
});
postCallLeadRouter.post('/college-brochures', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = brochureSchema.parse(req.body || {});
    const r = await pool.query(
      `INSERT INTO college_brochures
         (tenant_id, college_name, course, branch, brochure_url, file_url,
          source, source_url, verified_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'unverified'))
       RETURNING *`,
      [
        tenantId, data.college_name, data.course || null, data.branch || null,
        data.brochure_url || null, data.file_url || null,
        data.source || 'manual_entry', data.source_url || null,
        data.verified_status || null,
      ],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// =========================================================================
// COMMUNICATION LOGS — /api/v1/communication-logs
// =========================================================================

postCallLeadRouter.get('/communication-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const channel = (req.query.channel as string) || '';
    const leadId = (req.query.lead_id as string) || '';
    const status = (req.query.status as string) || '';
    const provider = (req.query.provider as string) || '';
    const search = (req.query.search as string) || '';
    const since = (req.query.since as string) || '';   // ISO datetime
    const until = (req.query.until as string) || '';   // ISO datetime
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
    const wheres: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (channel)  { params.push(channel);  wheres.push(`channel = $${params.length}`); }
    if (leadId)   { params.push(leadId);   wheres.push(`lead_id = $${params.length}::uuid`); }
    if (status)   { params.push(status);   wheres.push(`status = $${params.length}`); }
    if (provider) { params.push(provider); wheres.push(`provider = $${params.length}`); }
    if (since)    { params.push(since);    wheres.push(`created_at >= $${params.length}::timestamptz`); }
    if (until)    { params.push(until);    wheres.push(`created_at <= $${params.length}::timestamptz`); }
    if (search) {
      params.push(`%${search}%`);
      wheres.push(`(recipient ILIKE $${params.length} OR message ILIKE $${params.length} OR subject ILIKE $${params.length})`);
    }
    const whereSql = wheres.join(' AND ');
    const [listResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, tenant_id, lead_id, conversation_id, channel, provider, recipient,
                subject, message, template_id, attachments, status, last_error,
                sent_at, delivered_at, read_at, created_at
           FROM communication_logs WHERE ${whereSql}
           ORDER BY created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM communication_logs WHERE ${whereSql}`, params),
    ]);
    res.json({
      data: listResult.rows,
      pagination: {
        total: countResult.rows[0].total,
        limit,
        offset,
        has_more: offset + listResult.rows.length < countResult.rows[0].total,
      },
    });
  } catch (err) { next(err); }
});

/**
 * Aggregate counters for the comms-logs page header. Returns:
 *   - by_status: { queued, sent, delivered, read, failed }      across all-time
 *   - by_channel: { email, sms, whatsapp, whatsapp_inbound }    across all-time
 *   - last_24h / last_7d / last_30d: { total, delivered, failed }
 * One round-trip; the page renders KPI cards from a single response.
 */
postCallLeadRouter.get('/communication-logs/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    // Three independent aggregates run in parallel — simpler + faster than a
    // single union-tagged CTE, and easier to evolve when new fields are added.
    const [statusRows, channelRows, windowRows] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS cnt
           FROM communication_logs WHERE tenant_id = $1 GROUP BY status`,
        [tenantId],
      ),
      pool.query(
        `SELECT channel, COUNT(*)::int AS cnt
           FROM communication_logs WHERE tenant_id = $1 GROUP BY channel`,
        [tenantId],
      ),
      pool.query(
        `SELECT
           label,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM (
           SELECT '24h' AS label, status FROM communication_logs
             WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
           UNION ALL
           SELECT '7d',  status FROM communication_logs
             WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
           UNION ALL
           SELECT '30d', status FROM communication_logs
             WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
         ) w
         GROUP BY label`,
        [tenantId],
      ),
    ]);
    const by_status: Record<string, number> = {};
    for (const r of statusRows.rows) by_status[r.status || 'unknown'] = r.cnt;
    const by_channel: Record<string, number> = {};
    for (const r of channelRows.rows) by_channel[r.channel || 'unknown'] = r.cnt;
    const windows: Record<string, { total: number; delivered: number; failed: number }> = {};
    for (const r of windowRows.rows) windows[r.label] = { total: r.total, delivered: r.delivered, failed: r.failed };
    res.json({ by_status, by_channel, windows });
  } catch (err) { next(err); }
});

postCallLeadRouter.get('/communication-logs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM communication_logs WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
      [req.params.id, tenantId],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

const emailSendSchema = z.object({
  lead_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  recipient: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  template_id: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string().url() })).optional(),
});

/**
 * GET /api/v1/communications/lead-context/:leadId
 *
 * One-stop endpoint that gathers every variable the brochure modal (or any
 * outbound message template) might interpolate for this lead:
 *   - name, college, course, branch, location (from CRM custom_fields)
 *   - callback_time (custom_fields.recommended_follow_up_time — what the agent
 *     verbally promised)
 *   - next_call_time (lead_recall_queue.next_retry_at — what the recall
 *     scheduler will actually act on; falls back to the earliest pending
 *     follow_up_tasks.scheduled_at; falls back to callback_time)
 *   - agent_name (looked up from the most recent conversation for this lead)
 *   - lead_status, parent_name, parent_mobile
 *
 * Returns ALL keys (null for missing) so the frontend can drive a stable
 * variable-chip palette regardless of which fields populated.
 */
postCallLeadRouter.get('/communications/lead-context/:leadId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const leadId = req.params.leadId;
    if (!leadId) { res.status(400).json({ error: 'Bad Request', message: 'leadId required' }); return; }

    // 1. Pull the lead from crm-service (which owns the leads table). Best-
    //    effort — if CRM is down the modal still works with the in-DB data.
    let leadRow: any = null;
    try {
      const crmUrl = process.env.CRM_SERVICE_URL || 'http://localhost:8081';
      const r = await fetch(`${crmUrl}/leads/${leadId}`, { headers: { 'x-tenant-id': tenantId } });
      if (r.ok) {
        const body: any = await r.json();
        leadRow = body?.data || body;
      }
    } catch { /* non-fatal */ }

    const cf = (leadRow?.custom_fields || {}) as Record<string, any>;
    const name = leadRow
      ? [leadRow.first_name, leadRow.last_name].filter(Boolean).join(' ').trim()
      : null;

    // 2. Earliest pending recall for this lead — that's the next call time the
    //    system will actually act on. We sort by next_retry_at ASC + state
    //    filter so cancelled / completed rows don't surface.
    let recallRow: any = null;
    try {
      const r = await pool.query(
        `SELECT next_retry_at, retry_count, last_call_status, state
           FROM lead_recall_queue
          WHERE tenant_id = $1 AND lead_id = $2 AND state = 'PENDING'
          ORDER BY next_retry_at ASC NULLS LAST
          LIMIT 1`,
        [tenantId, leadId],
      );
      recallRow = r.rows[0] || null;
    } catch { /* non-fatal */ }

    // 3. Earliest pending follow-up task — covers cases where the team
    //    scheduled a manual call without a recall queue row.
    let followUpRow: any = null;
    try {
      const r = await pool.query(
        `SELECT scheduled_at, priority, notes
           FROM follow_up_tasks
          WHERE tenant_id = $1 AND lead_id = $2 AND status = 'pending'
          ORDER BY scheduled_at ASC
          LIMIT 1`,
        [tenantId, leadId],
      );
      followUpRow = r.rows[0] || null;
    } catch { /* non-fatal */ }

    // 4. Agent name from the most recent conversation that touched this lead.
    //    Most lead-detail UIs already show this; included here so the message
    //    template can sign off as the agent ("— Priya from Admissions").
    let agentName: string | null = null;
    try {
      const r = await pool.query(
        `SELECT agent_id FROM conversations
          WHERE tenant_id = $1 AND lead_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [tenantId, leadId],
      );
      const agentId = r.rows[0]?.agent_id;
      if (agentId) {
        // agent-service lookup is async + non-critical. Skip the network hop
        // when the agent-service URL isn't reachable.
        const agentUrl = process.env.AGENT_SERVICE_URL || 'http://localhost:3001/api/v1';
        const a = await fetch(`${agentUrl}/agents/${agentId}`, { headers: { 'x-tenant-id': tenantId } });
        if (a.ok) {
          const ag: any = await a.json();
          agentName = ag?.name || null;
        }
      }
    } catch { /* non-fatal */ }

    // Pick the "next call time" with a clear priority order:
    //   1. Recall queue (system will dial automatically)
    //   2. Follow-up task (operator scheduled manually)
    //   3. Recommended follow-up time from analyzer (agent's verbal promise)
    const nextCallIso: string | null =
      recallRow?.next_retry_at?.toISOString?.() ||
      (recallRow?.next_retry_at ? new Date(recallRow.next_retry_at).toISOString() : null) ||
      followUpRow?.scheduled_at?.toISOString?.() ||
      (followUpRow?.scheduled_at ? new Date(followUpRow.scheduled_at).toISOString() : null) ||
      (cf.recommended_follow_up_time ? null : null);  // analyzer value is free-text, see below

    // Pretty-print for the message body. Format: "Thursday, May 21 at 4:30 PM".
    const nextCallHuman = nextCallIso
      ? new Date(nextCallIso).toLocaleString('en-IN', {
          weekday: 'long', month: 'long', day: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        })
      : (cf.recommended_follow_up_time || null);  // analyzer text is already human

    res.json({
      lead_id: leadId,
      name: name || cf.name || null,
      first_name: leadRow?.first_name || null,
      last_name: leadRow?.last_name || null,
      email: leadRow?.email || null,
      phone: leadRow?.phone || null,
      lead_status: leadRow?.status || null,

      // Admissions-specific. `city` is the candidate's home city; `location`
      // is their preferred study location — surfaced separately so templates
      // can say "We've seen many students from Gujarat enrol at our Chennai
      // campus." without conflating the two.
      college: cf.interested_university || null,
      course: cf.interested_course || null,
      branch: cf.interested_branch || null,
      location: cf.preferred_location || null,
      city: cf.city || null,
      parent_name: cf.parent_name || null,
      parent_mobile: cf.parent_mobile || null,

      // Call scheduling
      next_call_time: nextCallHuman,                          // human string for {{next_call_time}}
      next_call_time_iso: nextCallIso,                        // ISO for the UI to format
      next_call_source: recallRow ? 'recall_queue'
                       : followUpRow ? 'follow_up_task'
                       : cf.recommended_follow_up_time ? 'agent_promise'
                       : null,
      callback_requested: !!cf.callback_required,

      // Agent identity for sign-off
      agent_name: agentName,
    });
  } catch (err) { next(err); }
});

postCallLeadRouter.post('/communications/email/brochure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = emailSendSchema.parse(req.body || {});
    const out = await sendEmail({ tenant_id: tenantId, ...data });
    if (out.ok && data.lead_id) {
      void enqueueRecallFromBrochureSend(tenantId, data.lead_id, data.recipient, data.conversation_id);
    }
    res.json(out);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

const whatsappSendSchema = z.object({
  lead_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  recipient: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  message: z.string().min(1),
  /** Template name (e.g. 'brochure_v1') when sending via approved template.
   *  Omit for free-form session messages (only works inside 24h window). */
  template_id: z.string().optional(),
  template_language: z.string().optional(),
  /** When template_id is set, the server resolves the template's variable
   *  mapping against this context to build the positional params. Common
   *  keys: lead.name, brochure_url, callback_at. UI never has to know
   *  about variable_mapping. */
  context: z.record(z.any()).optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string().url() })).optional(),
});
postCallLeadRouter.post('/communications/whatsapp/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = whatsappSendSchema.parse(req.body || {});
    const recipient = toE164(data.recipient);

    // Server-side template variable resolution. The caller only needs to
    // pass `context` — we look up the template by name, walk its
    // variable_mapping, and produce positional params. This keeps the UI
    // (LeadsPage etc.) ignorant of per-template variable schemas.
    let template_params: string[] | undefined;
    if (data.template_id) {
      const tplLang = data.template_language || 'en_US';
      // Use require dynamics so the route file doesn't add a top-of-file
      // dependency on the templates module (which would create a small
      // cycle through communications.ts → templates).
      const { getTemplateByName } = await import('../services/whatsappTemplateStore');
      const { resolveTemplateVariables } = await import('../services/templateVariables');
      const tpl = await getTemplateByName(tenantId, data.template_id, tplLang);
      if (tpl) {
        const { params } = resolveTemplateVariables(tpl, data.context || {});
        template_params = params;
      }
    }

    const out = await sendWhatsApp({
      tenant_id: tenantId,
      lead_id: data.lead_id,
      conversation_id: data.conversation_id,
      recipient,
      message: data.message,
      template_id: data.template_id,
      template_language: data.template_language,
      template_params,
      attachments: data.attachments,
    });
    if (out.ok && data.lead_id) {
      void enqueueRecallFromBrochureSend(tenantId, data.lead_id, recipient, data.conversation_id);
    }
    res.json(out);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

const smsSendSchema = z.object({
  lead_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  recipient: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  message: z.string().min(1).max(1600),
  template_id: z.string().optional(),
});

/**
 * Normalize a phone string to E.164. The CRM stores Indian numbers as 10-digit
 * locals (no country code) — bare `+9493324795` is invalid. Heuristic:
 *  - 10 digits starting 6–9 → assume India, prefix +91
 *  - 12 digits starting "91" → add leading +
 *  - 11 digits starting "1"  → assume US, prefix +
 *  - already starts with +   → trust it
 * Falls through to `+digits` for anything else.
 */
function toE164(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return `+${d}`;
  if (/^1\d{10}$/.test(d)) return `+${d}`;
  return `+${d}`;
}

postCallLeadRouter.post('/communications/sms/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = smsSendSchema.parse(req.body || {});
    const recipient = toE164(data.recipient);
    const out = await sendSms({ tenant_id: tenantId, ...data, recipient });
    if (out.ok && data.lead_id) {
      void enqueueRecallFromBrochureSend(tenantId, data.lead_id, recipient, data.conversation_id);
    }
    res.json(out);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// =========================================================================
// POST-CALL ANALYSIS HISTORY — /api/v1/post-call/analysis
// =========================================================================

postCallLeadRouter.get('/post-call/analysis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const leadStatus = (req.query.lead_status as string) || '';
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    const wheres: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (leadStatus) { params.push(leadStatus); wheres.push(`lead_status = $${params.length}`); }
    const r = await pool.query(
      `SELECT id, conversation_id, call_id, campaign_id, lead_id, lead_status,
              interest_level, confidence_score, missing_fields, review_reasons,
              processor_version, processed_at
       FROM post_call_lead_analysis
       WHERE ${wheres.join(' AND ')}
       ORDER BY processed_at DESC LIMIT ${limit}`,
      params,
    );
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});

// =========================================================================
// LEAD RECALL QUEUE — /api/v1/recalls
// Powers the /admin/recalls dashboard. Filter on state + lead_status, plus
// per-row actions: retry-now (next_retry_at=NOW) and cancel.
// =========================================================================

postCallLeadRouter.get('/recalls', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const state = (req.query.state as string) || '';
    const leadStatus = (req.query.lead_status as string) || '';
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
    const wheres: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (state) { params.push(state); wheres.push(`state = $${params.length}`); }
    if (leadStatus) { params.push(leadStatus); wheres.push(`lead_status = $${params.length}`); }
    const r = await pool.query(
      `SELECT id, lead_id, conversation_id, agent_id, phone_number, lead_status,
              retry_count, last_call_status, last_attempt_at, next_retry_at,
              preferred_callback_time, state, retry_reason, created_at, updated_at
         FROM lead_recall_queue
        WHERE ${wheres.join(' AND ')}
        ORDER BY
          CASE state WHEN 'IN_FLIGHT' THEN 1 WHEN 'PENDING' THEN 2
                     WHEN 'UNREACHABLE' THEN 3 WHEN 'COMPLETED' THEN 4 ELSE 5 END,
          next_retry_at ASC NULLS LAST
        LIMIT ${limit}`,
      params,
    );
    const [stateRollup, leadRollup] = await Promise.all([
      pool.query(
        `SELECT state, COUNT(*)::int AS n
           FROM lead_recall_queue WHERE tenant_id = $1 GROUP BY state`,
        [tenantId],
      ),
      pool.query(
        `SELECT COALESCE(lead_status, 'UNKNOWN') AS lead_status, COUNT(*)::int AS n
           FROM lead_recall_queue WHERE tenant_id = $1 GROUP BY 1`,
        [tenantId],
      ),
    ]);
    const counts: Record<string, number> = {};
    for (const row of stateRollup.rows) counts[row.state] = row.n;
    const leadCounts: Record<string, number> = {};
    for (const row of leadRollup.rows) leadCounts[row.lead_status] = row.n;
    res.json({ data: r.rows, counts, leadCounts });
  } catch (err) { next(err); }
});

const recallActionSchema = z.object({
  action: z.enum(['retry_now', 'cancel', 'reset']),
});
postCallLeadRouter.patch('/recalls/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { action } = recallActionSchema.parse(req.body || {});
    let sql: string;
    if (action === 'retry_now') {
      sql = `UPDATE lead_recall_queue SET state='PENDING', next_retry_at=NOW(), updated_at=NOW()
              WHERE id=$1 AND tenant_id=$2 RETURNING *`;
    } else if (action === 'cancel') {
      sql = `UPDATE lead_recall_queue SET state='CANCELLED', updated_at=NOW()
              WHERE id=$1 AND tenant_id=$2 RETURNING *`;
    } else {
      sql = `UPDATE lead_recall_queue
                SET state='PENDING', retry_count=0, last_call_status=NULL,
                    retry_reason=NULL, next_retry_at=NOW() + INTERVAL '1 hour', updated_at=NOW()
              WHERE id=$1 AND tenant_id=$2 RETURNING *`;
    }
    const r = await pool.query(sql, [req.params.id, tenantId]);
    if (r.rows.length === 0) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});
