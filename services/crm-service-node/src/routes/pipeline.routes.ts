import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';

const router = Router();

const stageSchema = z.object({
  name: z.string().min(1).max(255),
  position: z.number().int().min(0),
  color: z.string().max(20).optional(),
});

const createPipelineSchema = z.object({
  name: z.string().min(1).max(255),
  is_default: z.boolean().optional(),
  stages: z.array(stageSchema).min(1),
});

// GET /pipelines
router.get('/', async (req: Request, res: Response) => {
  try {
    const pipelines = await pool.query(
      'SELECT * FROM pipelines WHERE tenant_id = $1 ORDER BY created_at',
      [req.tenantId]
    );

    const result = [];
    for (const pipeline of pipelines.rows) {
      const stages = await pool.query(
        'SELECT * FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
        [pipeline.id]
      );
      result.push({ ...pipeline, stages: stages.rows });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /pipelines
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createPipelineSchema.parse(req.body);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // If setting as default, unset other defaults
      if (parsed.is_default) {
        await client.query(
          'UPDATE pipelines SET is_default = false WHERE tenant_id = $1',
          [req.tenantId]
        );
      }

      const pipelineRes = await client.query(
        'INSERT INTO pipelines (tenant_id, name, is_default) VALUES ($1, $2, $3) RETURNING *',
        [req.tenantId, parsed.name, parsed.is_default || false]
      );
      const pipeline = pipelineRes.rows[0];

      const stages = [];
      for (const stage of parsed.stages) {
        const stageRes = await client.query(
          'INSERT INTO pipeline_stages (pipeline_id, name, position, color) VALUES ($1, $2, $3, $4) RETURNING *',
          [pipeline.id, stage.name, stage.position, stage.color || null]
        );
        stages.push(stageRes.rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json({ ...pipeline, stages });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /pipelines/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pipelineRes = await pool.query(
      'SELECT * FROM pipelines WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (pipelineRes.rows.length === 0) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    const stages = await pool.query(
      'SELECT * FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
      [req.params.id]
    );

    res.json({ ...pipelineRes.rows[0], stages: stages.rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /pipelines/:id/board
router.get('/:id/board', async (req: Request, res: Response) => {
  try {
    const pipelineRes = await pool.query(
      'SELECT * FROM pipelines WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (pipelineRes.rows.length === 0) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }

    const stages = await pool.query(
      'SELECT * FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
      [req.params.id]
    );

    const board = [];
    for (const stage of stages.rows) {
      const deals = await pool.query(
        `SELECT d.*, l.first_name as lead_first_name, l.last_name as lead_last_name
         FROM deals d
         LEFT JOIN leads l ON l.id = d.lead_id
         WHERE d.stage_id = $1 AND d.tenant_id = $2
         ORDER BY d.created_at DESC`,
        [stage.id, req.tenantId]
      );
      board.push({ ...stage, deals: deals.rows });
    }

    res.json({ pipeline: pipelineRes.rows[0], stages: board });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /pipelines/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ name: z.string().min(1).max(255) }).parse(req.body);
    const result = await pool.query(
      'UPDATE pipelines SET name = $3 WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [req.params.id, req.tenantId, parsed.name]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pipeline not found' });
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

// DELETE /pipelines/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    // Check if default
    const check = await pool.query(
      'SELECT is_default FROM pipelines WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Pipeline not found' });
      return;
    }
    if (check.rows[0].is_default) {
      res.status(400).json({ error: 'Cannot delete the default pipeline' });
      return;
    }

    await pool.query(
      'DELETE FROM pipelines WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
