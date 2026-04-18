import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { twilioProvider } from '../providers/twilio.provider';
import { exotelProvider } from '../providers/exotel.provider';

export const callRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

const initiateCallSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  agent_id: z.string().uuid(),
  provider: z.enum(['twilio', 'exotel']).default('twilio'),
  metadata: z.any().default({}),
});

// POST /calls/initiate
callRouter.post('/initiate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const parsed = initiateCallSchema.parse(req.body);

    const provider = parsed.provider === 'exotel' ? exotelProvider : twilioProvider;

    // Initiate call via provider
    const callResult = await provider.initiateCall({
      from: parsed.from,
      to: parsed.to,
      agentId: parsed.agent_id,
      tenantId,
    });

    // Create call record in DB
    const result = await pool.query(
      `INSERT INTO calls (tenant_id, agent_id, direction, status, caller_number, called_number, provider, provider_call_sid, metadata)
       VALUES ($1, $2, 'OUTBOUND', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        parsed.agent_id,
        callResult.status === 'queued' ? 'RINGING' : callResult.status.toUpperCase(),
        parsed.from,
        parsed.to,
        parsed.provider,
        callResult.providerCallId,
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

// GET /calls
callRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const agentId = req.query.agent_id as string | undefined;
    const status = req.query.status as string | undefined;
    const direction = req.query.direction as string | undefined;
    const provider = req.query.provider as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM calls WHERE tenant_id = $1';
    let countQuery = 'SELECT COUNT(*) FROM calls WHERE tenant_id = $1';
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
    if (status) {
      query += ` AND status = $${paramIdx}`;
      countQuery += ` AND status = $${paramIdx}`;
      params.push(status);
      countParams.push(status);
      paramIdx++;
    }
    if (direction) {
      query += ` AND direction = $${paramIdx}`;
      countQuery += ` AND direction = $${paramIdx}`;
      params.push(direction);
      countParams.push(direction);
      paramIdx++;
    }
    if (provider) {
      query += ` AND provider = $${paramIdx}`;
      countQuery += ` AND provider = $${paramIdx}`;
      params.push(provider);
      countParams.push(provider);
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

// GET /calls/:id
callRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM calls WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Call not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /calls/:id/end
callRouter.post('/:id/end', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    // Get call record
    const callResult = await pool.query(
      'SELECT * FROM calls WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (callResult.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Call not found' });
      return;
    }

    const call = callResult.rows[0];

    // End call via provider
    if (call.provider_call_sid) {
      const provider = call.provider === 'exotel' ? exotelProvider : twilioProvider;
      try {
        await provider.endCall(call.provider_call_sid);
      } catch (err) {
        // Log but don't fail - provider may already have ended the call
      }
    }

    // Calculate duration
    const startedAt = new Date(call.started_at);
    const endedAt = new Date();
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);

    // Update call record
    const result = await pool.query(
      `UPDATE calls SET status = 'COMPLETED', ended_at = NOW(), duration_seconds = $1, outcome = $2
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [durationSeconds, req.body.outcome || 'COMPLETED', id, tenantId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /calls/:id/transfer
callRouter.post('/:id/transfer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const { transfer_to, transfer_type } = req.body;

    if (!transfer_to) {
      res.status(400).json({ error: 'Bad Request', message: 'transfer_to is required' });
      return;
    }

    const callResult = await pool.query(
      'SELECT * FROM calls WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (callResult.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Call not found' });
      return;
    }

    const call = callResult.rows[0];

    // Transfer via provider
    if (call.provider_call_sid) {
      const provider = call.provider === 'exotel' ? exotelProvider : twilioProvider;
      await provider.transferCall({
        callId: call.provider_call_sid,
        transferTo: transfer_to,
        transferType: transfer_type || 'warm',
      });
    }

    // Update call status
    const result = await pool.query(
      `UPDATE calls SET status = 'TRANSFERRED', outcome = 'TRANSFERRED',
       metadata = metadata || $1
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [JSON.stringify({ transferred_to: transfer_to, transfer_type: transfer_type || 'warm' }), id, tenantId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
