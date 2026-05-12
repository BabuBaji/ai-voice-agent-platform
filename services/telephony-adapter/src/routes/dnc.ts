import { Router, Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { pool } from '../index';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const dncRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = (req.headers['x-tenant-id'] as string) || '';
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

// E.164ish: require leading + plus 7–15 digits. Permissive — we don't want to
// reject obscure valid international numbers but we do want to reject obvious
// garbage like "asdf" or "12345".
function normalizePhone(p: any): string | null {
  if (!p || typeof p !== 'string') return null;
  const s = p.trim();
  return /^\+\d{7,15}$/.test(s) ? s : null;
}

/**
 * GET /api/v1/dnc — list tenant's do-not-call entries.
 */
dncRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const r = await pool.query(
      `SELECT id, phone_number, reason, created_at
         FROM do_not_call_numbers
        WHERE tenant_id = $1
        ORDER BY created_at DESC LIMIT 5000`,
      [tenantId]
    );
    res.json({ data: r.rows, total: r.rows.length });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/dnc — add one number or bulk (`{numbers:[{phone_number, reason?}]}`).
 */
dncRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const body = req.body || {};
    const items: Array<{ phone_number: string; reason?: string }> = [];
    if (Array.isArray(body.numbers)) items.push(...body.numbers);
    else if (body.phone_number) items.push({ phone_number: body.phone_number, reason: body.reason });
    if (!items.length) { res.status(400).json({ error: 'Bad Request', message: 'phone_number or numbers[] required' }); return; }

    let added = 0, skipped = 0;
    for (const it of items) {
      const phone = normalizePhone(it.phone_number);
      if (!phone) { skipped++; continue; }
      try {
        await pool.query(
          `INSERT INTO do_not_call_numbers (tenant_id, phone_number, reason)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, phone_number) DO UPDATE
             SET reason = EXCLUDED.reason`,
          [tenantId, phone, (it.reason || '').slice(0, 500) || null]
        );
        added++;
      } catch (err: any) {
        logger.warn({ err: err.message, phone }, 'dnc insert failed');
        skipped++;
      }
    }
    res.json({ added, skipped });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/v1/dnc/:id
 */
dncRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    await pool.query(
      'DELETE FROM do_not_call_numbers WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenantId]
    );
    res.status(204).send();
  } catch (err) { next(err); }
});
