import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';

const router = Router();

const createTaskSchema = z.object({
  lead_id: z.string().uuid().optional().nullable(),
  deal_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  description: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  assigned_to: z.string().uuid().optional().nullable(),
});

const updateTaskSchema = createTaskSchema.partial();

// GET /tasks
router.get('/', async (req: Request, res: Response) => {
  try {
    const conditions: string[] = ['tenant_id = $1'];
    const values: any[] = [req.tenantId];
    let paramIdx = 2;

    if (req.query.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(req.query.status);
    }
    if (req.query.priority) {
      conditions.push(`priority = $${paramIdx++}`);
      values.push(req.query.priority);
    }
    if (req.query.assignedTo) {
      conditions.push(`assigned_to = $${paramIdx++}`);
      values.push(req.query.assignedTo);
    }

    const where = conditions.join(' AND ');
    const result = await pool.query(
      `SELECT * FROM tasks WHERE ${where} ORDER BY due_date ASC NULLS LAST, created_at DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /tasks
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createTaskSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO tasks (tenant_id, lead_id, deal_id, title, description, due_date, priority, status, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.tenantId,
        parsed.lead_id || null,
        parsed.deal_id || null,
        parsed.title,
        parsed.description || null,
        parsed.due_date || null,
        parsed.priority || 'MEDIUM',
        parsed.status || 'TODO',
        parsed.assigned_to || null,
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

// PUT /tasks/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateTaskSchema.parse(req.body);
    const fields: string[] = [];
    const values: any[] = [req.params.id, req.tenantId];
    let paramIdx = 3;

    const fieldMap: Record<string, any> = {
      lead_id: parsed.lead_id,
      deal_id: parsed.deal_id,
      title: parsed.title,
      description: parsed.description,
      due_date: parsed.due_date,
      priority: parsed.priority,
      status: parsed.status,
      assigned_to: parsed.assigned_to,
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
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
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

// DELETE /tasks/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
