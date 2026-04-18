import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';

const router = Router();

const createAppointmentSchema = z.object({
  lead_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  scheduled_at: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  booked_by: z.string().max(50).optional(),
  conversation_id: z.string().uuid().optional().nullable(),
});

const updateAppointmentSchema = createAppointmentSchema.partial();

// GET /appointments
router.get('/', async (req: Request, res: Response) => {
  try {
    const conditions: string[] = ['tenant_id = $1'];
    const values: any[] = [req.tenantId];
    let paramIdx = 2;

    if (req.query.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(req.query.status);
    }
    if (req.query.from) {
      conditions.push(`scheduled_at >= $${paramIdx++}`);
      values.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push(`scheduled_at <= $${paramIdx++}`);
      values.push(req.query.to);
    }

    const where = conditions.join(' AND ');
    const result = await pool.query(
      `SELECT * FROM appointments WHERE ${where} ORDER BY scheduled_at ASC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /appointments
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createAppointmentSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO appointments (tenant_id, lead_id, contact_id, title, scheduled_at, duration_minutes, location, notes, status, booked_by, conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.tenantId,
        parsed.lead_id || null,
        parsed.contact_id || null,
        parsed.title,
        parsed.scheduled_at,
        parsed.duration_minutes || 30,
        parsed.location || null,
        parsed.notes || null,
        parsed.status || 'SCHEDULED',
        parsed.booked_by || 'MANUAL',
        parsed.conversation_id || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /appointments/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateAppointmentSchema.parse(req.body);
    const fields: string[] = [];
    const values: any[] = [req.params.id, req.tenantId];
    let paramIdx = 3;

    const fieldMap: Record<string, any> = {
      lead_id: parsed.lead_id,
      contact_id: parsed.contact_id,
      title: parsed.title,
      scheduled_at: parsed.scheduled_at,
      duration_minutes: parsed.duration_minutes,
      location: parsed.location,
      notes: parsed.notes,
      status: parsed.status,
      booked_by: parsed.booked_by,
      conversation_id: parsed.conversation_id,
    };

    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        fields.push(`${col} = $${paramIdx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const result = await pool.query(
      `UPDATE appointments SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /appointments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM appointments WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
