import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { sendEmail, sendWhatsApp } from '../services/communications';

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
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    const wheres: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (channel) { params.push(channel); wheres.push(`channel = $${params.length}`); }
    if (leadId) { params.push(leadId); wheres.push(`lead_id = $${params.length}::uuid`); }
    if (status) { params.push(status); wheres.push(`status = $${params.length}`); }
    const r = await pool.query(
      `SELECT * FROM communication_logs WHERE ${wheres.join(' AND ')}
       ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    res.json({ data: r.rows });
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
postCallLeadRouter.post('/communications/email/brochure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = emailSendSchema.parse(req.body || {});
    const out = await sendEmail({ tenant_id: tenantId, ...data });
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
  template_id: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string().url() })).optional(),
});
postCallLeadRouter.post('/communications/whatsapp/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = whatsappSendSchema.parse(req.body || {});
    const out = await sendWhatsApp({ tenant_id: tenantId, ...data });
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
