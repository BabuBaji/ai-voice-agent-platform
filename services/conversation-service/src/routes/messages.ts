import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { broadcastToConversation } from '../ws/realtime';
import { maybeRedactForTenant } from '../services/privacy';

export const messageRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

const createMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  audio_url: z.string().url().optional(),
  tool_calls: z.any().optional(),
  tool_result: z.any().optional(),
  tokens_used: z.number().int().optional(),
  latency_ms: z.number().int().optional(),
});

// GET /conversations/:conversationId/messages
messageRouter.get('/conversations/:conversationId/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { conversationId } = req.params;

    // Verify conversation belongs to tenant
    const convCheck = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    if (convCheck.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const result = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /conversations/:conversationId/messages
messageRouter.post('/conversations/:conversationId/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { conversationId } = req.params;

    // Verify conversation belongs to tenant
    const convCheck = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    if (convCheck.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const parsed = createMessageSchema.parse(req.body);

    // PII redaction (no-op unless tenant has settings.pii_obfuscation = true)
    const safeContent = await maybeRedactForTenant(tenantId, parsed.content);

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, role, content, audio_url, tool_calls, tool_result, tokens_used, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        conversationId,
        parsed.role,
        safeContent,
        parsed.audio_url || null,
        parsed.tool_calls ? JSON.stringify(parsed.tool_calls) : null,
        parsed.tool_result ? JSON.stringify(parsed.tool_result) : null,
        parsed.tokens_used || null,
        parsed.latency_ms || null,
      ]
    );

    const message = result.rows[0];

    // Broadcast to WebSocket subscribers
    broadcastToConversation(conversationId, 'new_message', message);

    res.status(201).json(message);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation Error', details: err.errors });
      return;
    }
    next(err);
  }
});

// GET /messages/:id
messageRouter.get('/messages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM messages WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Message not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
