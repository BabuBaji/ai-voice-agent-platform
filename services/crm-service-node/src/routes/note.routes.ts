import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';

const router = Router();

const createNoteSchema = z.object({
  entity_type: z.enum(['LEAD', 'CONTACT', 'DEAL', 'TASK', 'APPOINTMENT']),
  entity_id: z.string().uuid(),
  content: z.string().min(1),
  created_by: z.string().uuid().optional().nullable(),
});

// GET /notes
router.get('/', async (req: Request, res: Response) => {
  try {
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId as string | undefined;

    if (!entityType || !entityId) {
      res.status(400).json({ error: 'entityType and entityId query params are required' });
      return;
    }

    const result = await pool.query(
      'SELECT * FROM notes WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY created_at DESC',
      [req.tenantId, entityType, entityId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /notes
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createNoteSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO notes (tenant_id, entity_type, entity_id, content, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.tenantId,
        parsed.entity_type,
        parsed.entity_id,
        parsed.content,
        parsed.created_by || null,
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

export default router;
