import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/init';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export const templateRouter = Router();

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['email', 'sms']),
  subject: z.string().max(255).optional(),
  body: z.string().min(1),
  variables: z.array(z.string()).optional().default([]),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(['email', 'sms']).optional(),
  subject: z.string().max(255).optional(),
  body: z.string().min(1).optional(),
  variables: z.array(z.string()).optional(),
});

/**
 * GET /templates — list templates for tenant
 */
templateRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const [templates, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM notification_templates
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int as total FROM notification_templates WHERE tenant_id = $1`,
        [tenantId]
      ),
    ]);

    res.json({
      data: templates.rows,
      total: countResult.rows[0].total,
      page,
      pageSize,
    });
  } catch (err) {
    logger.error(err, 'Failed to list templates');
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

/**
 * POST /templates — create a template
 */
templateRouter.post('/', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  const parseResult = CreateTemplateSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    return;
  }

  const { name, type, subject, body, variables } = parseResult.data;

  try {
    const result = await pool.query(
      `INSERT INTO notification_templates (tenant_id, name, type, subject, body, variables)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, name, type, subject || null, body, JSON.stringify(variables)]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error(err, 'Failed to create template');
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * PUT /templates/:id — update a template
 */
templateRouter.put('/:id', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  const parseResult = UpdateTemplateSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    return;
  }

  const updates = parseResult.data;
  const setClauses: string[] = ['updated_at = NOW()'];
  const values: any[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    values.push(updates.name);
  }
  if (updates.type !== undefined) {
    setClauses.push(`type = $${paramIdx++}`);
    values.push(updates.type);
  }
  if (updates.subject !== undefined) {
    setClauses.push(`subject = $${paramIdx++}`);
    values.push(updates.subject);
  }
  if (updates.body !== undefined) {
    setClauses.push(`body = $${paramIdx++}`);
    values.push(updates.body);
  }
  if (updates.variables !== undefined) {
    setClauses.push(`variables = $${paramIdx++}`);
    values.push(JSON.stringify(updates.variables));
  }

  values.push(req.params.id);
  values.push(tenantId);

  try {
    const result = await pool.query(
      `UPDATE notification_templates
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error(err, 'Failed to update template');
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * DELETE /templates/:id — delete a template
 */
templateRouter.delete('/:id', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  try {
    const result = await pool.query(
      `DELETE FROM notification_templates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    logger.error(err, 'Failed to delete template');
    res.status(500).json({ error: 'Failed to delete template' });
  }
});
