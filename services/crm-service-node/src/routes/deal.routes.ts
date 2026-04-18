import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';
import { getDealsPaginated } from '../services/lead.service';

const router = Router();

const createDealSchema = z.object({
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  lead_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  value: z.number().min(0).optional(),
  currency: z.string().max(10).optional(),
  expected_close_date: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  status: z.string().max(50).optional(),
});

const updateDealSchema = createDealSchema.partial();

const moveDealSchema = z.object({
  stageId: z.string().uuid(),
});

// GET /deals
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sort = (req.query.sort as string) || 'created_at';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';

    const result = await getDealsPaginated(
      req.tenantId,
      { page, limit, sort, order },
      {
        status: req.query.status as string | undefined,
        pipelineId: req.query.pipelineId as string | undefined,
        stageId: req.query.stageId as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /deals
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createDealSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO deals (tenant_id, pipeline_id, stage_id, lead_id, contact_id, title, value, currency, expected_close_date, assigned_to, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.tenantId,
        parsed.pipeline_id,
        parsed.stage_id,
        parsed.lead_id || null,
        parsed.contact_id || null,
        parsed.title,
        parsed.value || 0,
        parsed.currency || 'INR',
        parsed.expected_close_date || null,
        parsed.assigned_to || null,
        parsed.status || 'OPEN',
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

// GET /deals/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT d.*, ps.name as stage_name, ps.color as stage_color, p.name as pipeline_name
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
       LEFT JOIN pipelines p ON p.id = d.pipeline_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /deals/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateDealSchema.parse(req.body);
    const fields: string[] = [];
    const values: any[] = [req.params.id, req.tenantId];
    let paramIdx = 3;

    const fieldMap: Record<string, any> = {
      pipeline_id: parsed.pipeline_id,
      stage_id: parsed.stage_id,
      lead_id: parsed.lead_id,
      contact_id: parsed.contact_id,
      title: parsed.title,
      value: parsed.value,
      currency: parsed.currency,
      expected_close_date: parsed.expected_close_date,
      assigned_to: parsed.assigned_to,
      status: parsed.status,
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

    fields.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE deals SET ${fields.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
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

// PUT /deals/:id/move
router.put('/:id/move', async (req: Request, res: Response) => {
  try {
    const parsed = moveDealSchema.parse(req.body);
    const result = await pool.query(
      `UPDATE deals SET stage_id = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.tenantId, parsed.stageId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
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

// DELETE /deals/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM deals WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenantId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
