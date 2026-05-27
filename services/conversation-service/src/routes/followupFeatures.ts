import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';

export const followupFeaturesRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) { res.status(400).json({ error: 'x-tenant-id required' }); return null; }
  return t;
}

// ─── Sequences ───────────────────────────────────────────────────────────────

followupFeaturesRouter.get('/sequences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(`SELECT * FROM followup_sequences WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

const seqSchema = z.object({
  name: z.string().min(1).max(100),
  steps: z.array(z.object({
    dayOffset: z.number().min(0),
    channel: z.enum(['call', 'whatsapp', 'sms', 'email']),
    type: z.string(),
    message: z.string().optional(),
  })).min(1),
});

followupFeaturesRouter.post('/sequences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = seqSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO followup_sequences (tenant_id, name, steps) VALUES ($1, $2, $3::jsonb) RETURNING *`,
      [tenantId, d.name, JSON.stringify(d.steps)],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

followupFeaturesRouter.put('/sequences/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = seqSchema.parse(req.body);
    const r = await pool.query(
      `UPDATE followup_sequences SET name = $1, steps = $2::jsonb, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [d.name, JSON.stringify(d.steps), req.params.id, tenantId],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not Found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

followupFeaturesRouter.delete('/sequences/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    await pool.query(`UPDATE followup_sequences SET is_active = FALSE WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ deactivated: true });
  } catch (err) { next(err); }
});

// ─── Counselors ──────────────────────────────────────────────────────────────

followupFeaturesRouter.get('/counselors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM counselors WHERE tenant_id = $1 AND availability_status = 'available' ORDER BY name`, [tenantId],
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

const counselorSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  specialization: z.string().optional(),
  max_visits_per_day: z.number().min(1).max(20).optional(),
});

followupFeaturesRouter.post('/counselors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const d = counselorSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO counselors (tenant_id, name, phone, email, specialization, max_visits_per_day) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, d.name, d.phone || null, d.email || null, d.specialization || null, d.max_visits_per_day || 8],
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

followupFeaturesRouter.delete('/counselors/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    await pool.query(`UPDATE counselors SET availability_status = 'unavailable' WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ deactivated: true });
  } catch (err) { next(err); }
});

// ─── Holidays ────────────────────────────────────────────────────────────────

followupFeaturesRouter.get('/holidays', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM holiday_calendar WHERE tenant_id = $1 ORDER BY holiday_date`, [tenantId],
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

followupFeaturesRouter.post('/holidays', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const { date, name } = req.body;
    if (!date) { res.status(400).json({ error: 'date required' }); return; }
    const r = await pool.query(
      `INSERT INTO holiday_calendar (tenant_id, holiday_date, name) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, holiday_date) DO UPDATE SET name = $3 RETURNING *`,
      [tenantId, date, name || null],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

followupFeaturesRouter.delete('/holidays/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    await pool.query(`DELETE FROM holiday_calendar WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── Lead Score History ──────────────────────────────────────────────────────

followupFeaturesRouter.get('/scores/:leadId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM lead_score_history WHERE tenant_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [tenantId, req.params.leadId],
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

// ─── Team Notifications ──────────────────────────────────────────────────────

followupFeaturesRouter.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res); if (!tenantId) return;
    const r = await pool.query(
      `SELECT * FROM team_notification_logs WHERE tenant_id = $1 ORDER BY sent_at DESC LIMIT 50`, [tenantId],
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});
