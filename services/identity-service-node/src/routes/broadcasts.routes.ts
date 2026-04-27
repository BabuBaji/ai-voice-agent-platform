import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';

// Authed-tenant view of active platform broadcasts. Returns just the active,
// non-expired ones so the tenant dashboard banner can render them. The CRUD
// endpoints under /super-admin/broadcasts are how super admins create them.
export function broadcastsRouter(): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const r = await pool.query(`
        SELECT id, message, severity, starts_at, expires_at
        FROM tenant_broadcasts
        WHERE active = true
          AND starts_at <= now()
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC LIMIT 5
      `);
      res.json({ data: r.rows });
    } catch (err) { next(err); }
  });

  return router;
}
