import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';

export const conversationRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

const createConversationSchema = z.object({
  agent_id: z.string().uuid(),
  channel: z.enum(['PHONE', 'CHAT', 'SMS', 'WHATSAPP']).default('PHONE'),
  caller_number: z.string().max(20).optional(),
  called_number: z.string().max(20).optional(),
  lead_id: z.string().uuid().optional(),
  call_sid: z.string().max(255).optional(),
  metadata: z.any().default({}),
});

const updateConversationSchema = z.object({
  status: z.enum(['ACTIVE', 'ENDED', 'FAILED', 'TRANSFERRED']).optional(),
  ended_at: z.string().datetime().optional(),
  duration_seconds: z.number().int().optional(),
  recording_url: z.string().url().optional(),
  summary: z.string().optional(),
  sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED']).optional(),
  outcome: z.string().max(50).optional(),
  metadata: z.any().optional(),
});

conversationRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const agentId = req.query.agent_id as string | undefined;
    const channel = req.query.channel as string | undefined;
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM conversations WHERE tenant_id = $1';
    let countQuery = 'SELECT COUNT(*) FROM conversations WHERE tenant_id = $1';
    const params: any[] = [tenantId];
    const countParams: any[] = [tenantId];
    let paramIdx = 2;

    if (agentId) {
      query += ` AND agent_id = $${paramIdx}`;
      countQuery += ` AND agent_id = $${paramIdx}`;
      params.push(agentId);
      countParams.push(agentId);
      paramIdx++;
    }
    if (channel) {
      query += ` AND channel = $${paramIdx}`;
      countQuery += ` AND channel = $${paramIdx}`;
      params.push(channel);
      countParams.push(channel);
      paramIdx++;
    }
    if (status) {
      query += ` AND status = $${paramIdx}`;
      countQuery += ` AND status = $${paramIdx}`;
      params.push(status);
      countParams.push(status);
      paramIdx++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    res.json({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      pageSize: limit,
    });
  } catch (err) {
    next(err);
  }
});

conversationRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const parsed = createConversationSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO conversations (tenant_id, agent_id, channel, caller_number, called_number, lead_id, call_sid, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        parsed.agent_id,
        parsed.channel,
        parsed.caller_number || null,
        parsed.called_number || null,
        parsed.lead_id || null,
        parsed.call_sid || null,
        JSON.stringify(parsed.metadata),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

conversationRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const row = result.rows[0];
    row.message_count = parseInt(row.message_count);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

conversationRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const parsed = updateConversationSchema.parse(req.body);

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, any> = {
      status: parsed.status,
      ended_at: parsed.ended_at,
      duration_seconds: parsed.duration_seconds,
      recording_url: parsed.recording_url,
      summary: parsed.summary,
      sentiment: parsed.sentiment,
      outcome: parsed.outcome,
      metadata: parsed.metadata !== undefined ? JSON.stringify(parsed.metadata) : undefined,
    };

    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        setClauses.push(`${col} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    values.push(id, tenantId);

    const result = await pool.query(
      `UPDATE conversations SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

conversationRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM conversations WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
