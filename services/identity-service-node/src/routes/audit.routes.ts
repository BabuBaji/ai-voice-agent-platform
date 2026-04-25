import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';

export function auditRouter(): Router {
  const router = Router();
  router.use(authMiddleware);

  // GET /audit-log?limit=50&action=&resource_type=&since=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const roles: string[] = (req as any).roles || [];
      if (!roles.includes('OWNER') && !roles.includes('ADMIN')) {
        res.status(403).json({ error: 'Only OWNER or ADMIN can view audit log' });
        return;
      }

      const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const action = (req.query.action as string) || '';
      const resourceType = (req.query.resource_type as string) || '';
      const since = (req.query.since as string) || '';

      const where: string[] = ['tenant_id = $1'];
      const params: any[] = [tenantId];
      let p = 2;
      if (action) { where.push(`action = $${p++}`); params.push(action); }
      if (resourceType) { where.push(`resource_type = $${p++}`); params.push(resourceType); }
      if (since) { where.push(`created_at >= $${p++}`); params.push(new Date(since)); }

      const result = await pool.query(
        `SELECT id, tenant_id, user_id, user_email, action, resource_type, resource_id,
                method, path, status_code, ip, user_agent, metadata, created_at
         FROM audit_log
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${p}`,
        [...params, limit],
      );

      res.json({ data: result.rows, total: result.rows.length });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
