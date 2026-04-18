import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../index';
import { twilioProvider } from '../providers/twilio.provider';
import { exotelProvider } from '../providers/exotel.provider';

export const phoneNumberRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header is required' });
    return null;
  }
  return tenantId;
}

const provisionSchema = z.object({
  provider: z.enum(['twilio', 'exotel']).default('twilio'),
  country: z.string().min(2).max(2).default('US'),
  capabilities: z.array(z.enum(['voice', 'sms'])).default(['voice']),
  area_code: z.string().optional(),
});

const updatePhoneNumberSchema = z.object({
  agent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

// GET /phone-numbers
phoneNumberRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const result = await pool.query(
      'SELECT * FROM phone_numbers WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /phone-numbers/provision
phoneNumberRouter.post('/provision', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const parsed = provisionSchema.parse(req.body);

    const provider = parsed.provider === 'exotel' ? exotelProvider : twilioProvider;

    let provisionedNumber;
    try {
      provisionedNumber = await provider.provisionNumber({
        country: parsed.country,
        capabilities: parsed.capabilities,
        areaCode: parsed.area_code,
      });
    } catch (err: any) {
      res.status(502).json({
        error: 'Provider Error',
        message: `Failed to provision number via ${parsed.provider}: ${err.message}`,
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO phone_numbers (tenant_id, phone_number, provider, provider_sid, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [
        tenantId,
        provisionedNumber.number,
        parsed.provider,
        provisionedNumber.providerNumberId,
        JSON.stringify({ voice: parsed.capabilities.includes('voice'), sms: parsed.capabilities.includes('sms') }),
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

// PUT /phone-numbers/:id
phoneNumberRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;
    const parsed = updatePhoneNumberSchema.parse(req.body);

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (parsed.agent_id !== undefined) {
      setClauses.push(`agent_id = $${paramIdx}`);
      values.push(parsed.agent_id);
      paramIdx++;
    }
    if (parsed.is_active !== undefined) {
      setClauses.push(`is_active = $${paramIdx}`);
      values.push(parsed.is_active);
      paramIdx++;
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'No fields to update' });
      return;
    }

    values.push(id, tenantId);

    const result = await pool.query(
      `UPDATE phone_numbers SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
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

// DELETE /phone-numbers/:id
phoneNumberRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    // Get the phone number record first
    const phoneResult = await pool.query(
      'SELECT * FROM phone_numbers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (phoneResult.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'Phone number not found' });
      return;
    }

    const phone = phoneResult.rows[0];

    // Release from provider
    if (phone.provider_sid) {
      const provider = phone.provider === 'exotel' ? exotelProvider : twilioProvider;
      try {
        await provider.releaseNumber(phone.provider_sid);
      } catch (err) {
        // Log but continue with DB deletion
      }
    }

    await pool.query(
      'DELETE FROM phone_numbers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
