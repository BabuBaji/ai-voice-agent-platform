import { Router, Request, Response } from 'express';
import { pool } from '../db/init';
import { workflowEngine } from '../engine/workflow-engine';
import { z } from 'zod';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const router = Router();

// ---- Validation schemas ----

const TriggerSchema = z.object({
  type: z.enum(['CALL_ENDED', 'LEAD_CAPTURED', 'DEAL_STAGE_CHANGED', 'APPOINTMENT_BOOKED']),
  conditions: z.object({
    all: z.array(z.object({
      field: z.string(),
      operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists', 'not_exists']),
      value: z.any().optional(),
    })).optional(),
    any: z.array(z.object({
      field: z.string(),
      operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists', 'not_exists']),
      value: z.any().optional(),
    })).optional(),
  }).optional().default({}),
});

const ActionSchema = z.object({
  type: z.enum(['SEND_EMAIL', 'SEND_SMS', 'UPDATE_LEAD', 'CREATE_TASK', 'WEBHOOK', 'WAIT']),
  config: z.record(z.any()).optional().default({}),
  position: z.number().int().min(0).optional(),
});

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  is_active: z.boolean().optional().default(true),
  triggers: z.array(TriggerSchema).min(1),
  actions: z.array(ActionSchema).min(1),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
  triggers: z.array(TriggerSchema).optional(),
  actions: z.array(ActionSchema).optional(),
});

// ---- Routes ----

/**
 * GET /workflows — List workflows for the tenant
 */
router.get('/', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const [workflows, countResult] = await Promise.all([
      pool.query(
        `SELECT id, tenant_id, name, description, is_active, created_at, updated_at
         FROM workflows
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int as total FROM workflows WHERE tenant_id = $1`,
        [tenantId]
      ),
    ]);

    res.json({
      data: workflows.rows,
      total: countResult.rows[0].total,
      page,
      pageSize,
    });
  } catch (err) {
    logger.error(err, 'Failed to list workflows');
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/**
 * POST /workflows — Create a workflow with triggers and actions
 */
router.post('/', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const parseResult = CreateWorkflowSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    return;
  }

  const { name, description, is_active, triggers, actions } = parseResult.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert workflow
    const wfResult = await client.query(
      `INSERT INTO workflows (tenant_id, name, description, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, name, description || null, is_active]
    );
    const workflow = wfResult.rows[0];

    // Insert triggers
    const insertedTriggers = [];
    for (const trigger of triggers) {
      const trigResult = await client.query(
        `INSERT INTO triggers (workflow_id, type, conditions)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [workflow.id, trigger.type, JSON.stringify(trigger.conditions)]
      );
      insertedTriggers.push(trigResult.rows[0]);
    }

    // Insert actions
    const insertedActions = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const actResult = await client.query(
        `INSERT INTO actions (workflow_id, type, config, position)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [workflow.id, action.type, JSON.stringify(action.config), action.position ?? i]
      );
      insertedActions.push(actResult.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      ...workflow,
      triggers: insertedTriggers,
      actions: insertedActions,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err, 'Failed to create workflow');
    res.status(500).json({ error: 'Failed to create workflow' });
  } finally {
    client.release();
  }
});

/**
 * GET /workflows/:id — Get workflow with triggers and actions
 */
router.get('/:id', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { id } = req.params;

  try {
    const [wfResult, trigResult, actResult, execResult] = await Promise.all([
      pool.query(
        `SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      ),
      pool.query(
        `SELECT * FROM triggers WHERE workflow_id = $1 ORDER BY created_at`,
        [id]
      ),
      pool.query(
        `SELECT * FROM actions WHERE workflow_id = $1 ORDER BY position`,
        [id]
      ),
      pool.query(
        `SELECT id, status, triggered_by, started_at, completed_at
         FROM workflow_executions
         WHERE workflow_id = $1
         ORDER BY started_at DESC
         LIMIT 10`,
        [id]
      ),
    ]);

    if (wfResult.rows.length === 0) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    res.json({
      ...wfResult.rows[0],
      triggers: trigResult.rows,
      actions: actResult.rows,
      recent_executions: execResult.rows,
    });
  } catch (err) {
    logger.error(err, 'Failed to get workflow');
    res.status(500).json({ error: 'Failed to get workflow' });
  }
});

/**
 * PUT /workflows/:id — Update workflow (name, description, is_active, triggers, actions)
 */
router.put('/:id', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { id } = req.params;
  const parseResult = UpdateWorkflowSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({ error: 'Validation failed', details: parseResult.error.issues });
    return;
  }

  const { name, description, is_active, triggers, actions } = parseResult.data;
  const client = await pool.connect();

  try {
    // Check existence
    const existing = await client.query(
      `SELECT id FROM workflows WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    await client.query('BEGIN');

    // Update workflow fields
    const updates: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    values.push(id);
    const wfResult = await client.query(
      `UPDATE workflows SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    // Replace triggers if provided
    let updatedTriggers;
    if (triggers) {
      await client.query(`DELETE FROM triggers WHERE workflow_id = $1`, [id]);
      updatedTriggers = [];
      for (const trigger of triggers) {
        const trigResult = await client.query(
          `INSERT INTO triggers (workflow_id, type, conditions) VALUES ($1, $2, $3) RETURNING *`,
          [id, trigger.type, JSON.stringify(trigger.conditions)]
        );
        updatedTriggers.push(trigResult.rows[0]);
      }
    }

    // Replace actions if provided
    let updatedActions;
    if (actions) {
      await client.query(`DELETE FROM actions WHERE workflow_id = $1`, [id]);
      updatedActions = [];
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const actResult = await client.query(
          `INSERT INTO actions (workflow_id, type, config, position) VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, action.type, JSON.stringify(action.config), action.position ?? i]
        );
        updatedActions.push(actResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    // Fetch full state if triggers/actions weren't replaced
    if (!updatedTriggers) {
      const trigResult = await pool.query(`SELECT * FROM triggers WHERE workflow_id = $1`, [id]);
      updatedTriggers = trigResult.rows;
    }
    if (!updatedActions) {
      const actResult = await pool.query(`SELECT * FROM actions WHERE workflow_id = $1 ORDER BY position`, [id]);
      updatedActions = actResult.rows;
    }

    res.json({
      ...wfResult.rows[0],
      triggers: updatedTriggers,
      actions: updatedActions,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(err, 'Failed to update workflow');
    res.status(500).json({ error: 'Failed to update workflow' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /workflows/:id — Delete a workflow (cascades to triggers + actions)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM workflows WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    logger.error(err, 'Failed to delete workflow');
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/**
 * POST /workflows/:id/execute — Manually execute a workflow (for testing)
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { id } = req.params;
  const data = req.body.data || {};

  try {
    const result = await workflowEngine.executeManual(id as string, tenantId, data);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Execution failed';
    if (message === 'Workflow not found') {
      res.status(404).json({ error: message });
    } else {
      logger.error(err, 'Manual workflow execution failed');
      res.status(500).json({ error: message });
    }
  }
});

export default router;
