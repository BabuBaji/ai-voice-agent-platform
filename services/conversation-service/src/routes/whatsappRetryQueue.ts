/**
 * WhatsApp retry-queue REST endpoints.
 *
 *   GET  /api/v1/whatsapp/retry-queue                 — list pending retries
 *   POST /api/v1/whatsapp/retry-queue/:logId/retry    — force retry NOW (skip backoff)
 *   POST /api/v1/whatsapp/retry-queue/:logId/skip     — permanently give up on this row
 */
import { Router, Request, Response } from 'express';
import { pool } from '../index';
import { forceRetry, skipRetry } from '../services/whatsappRetrySweeper';

export const whatsappRetryQueueRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

/** Default scope: all whatsapp failed rows with retry_attempts < 3.
 *  ?include_exhausted=1 to also see rows that hit the 3-attempt cap. */
whatsappRetryQueueRouter.get('/retry-queue', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const includeExhausted = req.query.include_exhausted === '1';
    const r = await pool.query(
      `SELECT id, tenant_id, lead_id, conversation_id, recipient, message,
              template_id, template_language, template_params, attachments,
              status, last_error, provider_message_id,
              retry_attempts, next_retry_at, sent_at, failed_at, created_at
       FROM communication_logs
       WHERE tenant_id = $1
         AND channel = 'whatsapp'
         AND status = 'failed'
         ${includeExhausted ? '' : 'AND retry_attempts < 3'}
       ORDER BY COALESCE(next_retry_at, failed_at, created_at) DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    res.json({ items: r.rows, count: r.rows.length });
  } catch (err) { next(err); }
});

whatsappRetryQueueRouter.post('/retry-queue/:logId/retry', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const row = await forceRetry(req.params.logId, tenantId);
    if (!row) return res.status(404).json({ error: 'Not Found or attempts exhausted' });
    res.json({ ok: true, id: row.id, next_retry_at: 'now' });
  } catch (err) { next(err); }
});

whatsappRetryQueueRouter.post('/retry-queue/:logId/skip', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const ok = await skipRetry(req.params.logId, tenantId);
    if (!ok) return res.status(404).json({ error: 'Not Found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
