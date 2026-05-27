import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { createFollowupForLead } from '../services/followupScheduler';

export const followupRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) { res.status(400).json({ error: 'x-tenant-id required' }); return null; }
  return t;
}

// POST /followups — Create follow-up
const createSchema = z.object({
  lead_id: z.string().uuid(),
  type: z.string().optional(),
  scheduled_at: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  priority: z.number().min(1).max(10).optional(),
  notes: z.string().optional(),
});

followupRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = createSchema.parse(req.body);
    const id = await createFollowupForLead(pool, {
      tenantId, leadId: d.lead_id, type: d.type, agentId: d.agent_id,
      scheduledAt: d.scheduled_at ? new Date(d.scheduled_at) : undefined,
      priority: d.priority, notes: d.notes,
    });
    const row = await pool.query(`SELECT * FROM followup_tasks WHERE id = $1`, [id]);
    res.status(201).json(row.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// GET /followups — List with filters
followupRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const status = req.query.status as string;
    const type = req.query.type as string;
    const leadId = req.query.lead_id as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    let where = 'tenant_id = $1';
    const params: any[] = [tenantId];
    let idx = 2;
    if (status) { where += ` AND status = $${idx++}`; params.push(status); }
    if (type) { where += ` AND type = $${idx++}`; params.push(type); }
    if (leadId) { where += ` AND lead_id = $${idx++}`; params.push(leadId); }

    const [data, count] = await Promise.all([
      pool.query(`SELECT * FROM followup_tasks WHERE ${where} ORDER BY scheduled_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM followup_tasks WHERE ${where}`, params),
    ]);
    res.json({ data: data.rows, total: parseInt(count.rows[0].count), page, limit });
  } catch (err) { next(err); }
});

// GET /followups/:id (skip non-UUID paths like /stats, /report)
followupRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) { next(); return; }
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const [task, attempts, visit] = await Promise.all([
      pool.query(`SELECT * FROM followup_tasks WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]),
      pool.query(`SELECT * FROM call_attempt_logs WHERE followup_task_id = $1 ORDER BY initiated_at DESC`, [req.params.id]),
      pool.query(`SELECT * FROM visit_schedules WHERE followup_task_id = $1 LIMIT 1`, [req.params.id]),
    ]);
    if (!task.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json({ ...task.rows[0], attempts: attempts.rows, visit: visit.rows[0] || null });
  } catch (err) { next(err); }
});

// PUT /followups/:id — Update
const updateSchema = z.object({
  status: z.string().optional(),
  scheduled_at: z.string().optional(),
  notes: z.string().optional(),
  priority: z.number().optional(),
});

followupRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  if (!/^[0-9a-f]{8}-/i.test(req.params.id)) { next(); return; }
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = updateSchema.parse(req.body);
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let idx = 1;
    if (d.status) { sets.push(`status = $${idx++}`); params.push(d.status); }
    if (d.scheduled_at) { sets.push(`scheduled_at = $${idx++}`); params.push(new Date(d.scheduled_at)); }
    if (d.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(d.notes); }
    if (d.priority) { sets.push(`priority = $${idx++}`); params.push(d.priority); }
    params.push(req.params.id, tenantId);
    const r = await pool.query(
      `UPDATE followup_tasks SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`, params,
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

// DELETE /followups/:id — Cancel
followupRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    await pool.query(
      `UPDATE followup_tasks SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId],
    );
    res.json({ cancelled: true });
  } catch (err) { next(err); }
});

// ─── Visits ──────────────────────────────────────────────────────────────────

const visitSchema = z.object({
  lead_id: z.string().uuid(),
  followup_task_id: z.string().uuid().optional(),
  visit_date: z.string(),
  visit_time: z.string().optional(),
  location: z.string().optional(),
  counselor_name: z.string().optional(),
  counselor_phone: z.string().optional(),
});

followupRouter.post('/visits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = visitSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO visit_schedules (tenant_id, lead_id, followup_task_id, visit_date, visit_time, location, counselor_name, counselor_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, d.lead_id, d.followup_task_id || null, d.visit_date, d.visit_time || null, d.location || null, d.counselor_name || null, d.counselor_phone || null],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

followupRouter.get('/visits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const status = req.query.status as string;
    const leadId = req.query.lead_id as string;
    let where = 'tenant_id = $1';
    const params: any[] = [tenantId];
    let idx = 2;
    if (status) { where += ` AND status = $${idx++}`; params.push(status); }
    if (leadId) { where += ` AND lead_id = $${idx++}`; params.push(leadId); }
    const r = await pool.query(`SELECT * FROM visit_schedules WHERE ${where} ORDER BY visit_date DESC LIMIT 50`, params);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

followupRouter.put('/visits/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `UPDATE visit_schedules SET status = 'CONFIRMED', customer_confirmed = TRUE, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`, [req.params.id, tenantId],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

followupRouter.put('/visits/:id/reschedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const { new_date, new_time, reason } = req.body;
    if (!new_date) { res.status(400).json({ error: 'new_date required' }); return; }
    const r = await pool.query(
      `UPDATE visit_schedules SET visit_date = $1, visit_time = $2, status = 'RESCHEDULED',
         reschedule_count = reschedule_count + 1, notes = COALESCE(notes, '') || $3,
         reminder_24h_sent = FALSE, reminder_2h_sent = FALSE, customer_confirmed = FALSE, updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [new_date, new_time || null, reason ? `\nRescheduled: ${reason}` : '', req.params.id, tenantId],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ─── Feedback ────────────────────────────────────────────────────────────────

const feedbackSchema = z.object({
  lead_id: z.string().uuid(),
  followup_task_id: z.string().uuid().optional(),
  call_id: z.string().uuid().optional(),
  rating: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']),
  rating_score: z.number().min(1).max(5).optional(),
  reason: z.string().optional(),
  feedback_text: z.string().optional(),
  requires_escalation: z.boolean().optional(),
});

followupRouter.post('/feedback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = feedbackSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO feedback_logs (tenant_id, lead_id, followup_task_id, call_id, rating, rating_score, reason, feedback_text, requires_escalation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tenantId, d.lead_id, d.followup_task_id || null, d.call_id || null, d.rating, d.rating_score || null, d.reason || null, d.feedback_text || null, d.requires_escalation || false],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

followupRouter.get('/feedback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const leadId = req.query.lead_id as string;
    const rating = req.query.rating as string;
    let where = 'tenant_id = $1';
    const params: any[] = [tenantId];
    let idx = 2;
    if (leadId) { where += ` AND lead_id = $${idx++}`; params.push(leadId); }
    if (rating) { where += ` AND rating = $${idx++}`; params.push(rating); }
    const r = await pool.query(`SELECT * FROM feedback_logs WHERE ${where} ORDER BY collected_at DESC LIMIT 50`, params);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

// ─── Reports & Stats ─────────────────────────────────────────────────────────

followupRouter.get('/report/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

    const [tasks, visits, feedback] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'COMPLETED' AND DATE(completed_at) = $2) as completed,
          COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
          COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
          COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress
        FROM followup_tasks WHERE tenant_id = $1`, [tenantId, date]),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'SCHEDULED') as scheduled,
          COUNT(*) FILTER (WHERE status = 'CONFIRMED') as confirmed,
          COUNT(*) FILTER (WHERE status = 'NO_SHOW') as no_show,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed
        FROM visit_schedules WHERE tenant_id = $1`, [tenantId]),
      pool.query(`
        SELECT rating, COUNT(*) as count FROM feedback_logs
        WHERE tenant_id = $1 AND DATE(collected_at) = $2 GROUP BY rating`, [tenantId, date]),
    ]);

    const fb: Record<string, number> = {};
    for (const r of feedback.rows) fb[r.rating] = parseInt(r.count);

    res.json({
      date,
      followups: tasks.rows[0] || {},
      visits: visits.rows[0] || {},
      feedback_summary: { positive: fb.POSITIVE || 0, neutral: fb.NEUTRAL || 0, negative: fb.NEGATIVE || 0 },
    });
  } catch (err) { next(err); }
});

followupRouter.get('/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const { getFollowupAnalytics } = await import('../services/followupFeatures');
    const data = await getFollowupAnalytics(pool, { tenantId, dateFrom: req.query.date_from as string, dateTo: req.query.date_to as string });
    res.json(data);
  } catch (err) { next(err); }
});

followupRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING' AND scheduled_at <= NOW()) as overdue,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND DATE(scheduled_at) = CURRENT_DATE) as pending_today,
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND DATE(completed_at) = CURRENT_DATE) as completed_today,
        COUNT(*) FILTER (WHERE status IN ('PENDING', 'IN_PROGRESS')) as total_active
      FROM followup_tasks WHERE tenant_id = $1`, [tenantId]);
    const visits = await pool.query(`
      SELECT COUNT(*) as this_week FROM visit_schedules
      WHERE tenant_id = $1 AND visit_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`, [tenantId]);
    res.json({ ...r.rows[0], visits_this_week: parseInt(visits.rows[0]?.this_week || '0') });
  } catch (err) { next(err); }
});
