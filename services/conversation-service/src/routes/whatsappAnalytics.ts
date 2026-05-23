/**
 * WhatsApp delivery analytics. One cheap GROUP BY query per call.
 *
 *   GET /api/v1/whatsapp/analytics                 — counts by status (all-time)
 *   GET /api/v1/whatsapp/analytics?days=7          — last N days
 *   GET /api/v1/whatsapp/analytics/by-template     — per-template breakdown
 */
import { Router, Request, Response } from 'express';
import { pool } from '../index';

export const whatsappAnalyticsRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

whatsappAnalyticsRouter.get('/analytics', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const days = Math.max(1, Math.min(Number(req.query.days) || 365, 365));
    const r = await pool.query(
      `SELECT status, COUNT(*)::int AS n
       FROM communication_logs
       WHERE tenant_id = $1 AND channel = 'whatsapp'
         AND created_at > NOW() - ($2 || ' days')::interval
       GROUP BY status`,
      [tenantId, String(days)],
    );
    const counts: Record<string, number> = {
      queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0,
    };
    let total = 0;
    for (const row of r.rows) {
      if (row.status in counts) counts[row.status] = row.n;
      total += row.n;
    }
    // Derived rates. Use safe denominators.
    const sentLike = counts.sent + counts.delivered + counts.read + counts.replied;
    const delivered = counts.delivered + counts.read + counts.replied;
    const read = counts.read + counts.replied;
    res.json({
      days,
      counts,
      total,
      rates: {
        delivery_rate: sentLike ? +(delivered / sentLike).toFixed(3) : 0,
        read_rate: delivered ? +(read / delivered).toFixed(3) : 0,
        reply_rate: delivered ? +(counts.replied / delivered).toFixed(3) : 0,
        failure_rate: total ? +(counts.failed / total).toFixed(3) : 0,
      },
    });
  } catch (err) { next(err); }
});

whatsappAnalyticsRouter.get('/analytics/by-template', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 365));
    const r = await pool.query(
      `SELECT template_id AS template_name,
              status,
              COUNT(*)::int AS n
       FROM communication_logs
       WHERE tenant_id = $1 AND channel = 'whatsapp'
         AND template_id IS NOT NULL
         AND created_at > NOW() - ($2 || ' days')::interval
       GROUP BY template_id, status
       ORDER BY template_id`,
      [tenantId, String(days)],
    );
    // Pivot to one row per template with counts per status.
    const byTpl: Record<string, any> = {};
    for (const row of r.rows) {
      const k = row.template_name;
      byTpl[k] ??= { template_name: k, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, total: 0 };
      byTpl[k][row.status] = row.n;
      byTpl[k].total += row.n;
    }
    res.json({ days, templates: Object.values(byTpl) });
  } catch (err) { next(err); }
});
