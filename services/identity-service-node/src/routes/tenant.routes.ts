import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';

const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: z.record(z.unknown()).optional(),
});

export function tenantRouter(): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);

  // GET /tenants/me
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;

      const result = await pool.query(
        `SELECT id, name, slug, plan, settings, is_active, created_at, updated_at
         FROM tenants WHERE id = $1`,
        [tenantId],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // PUT /tenants/me
  router.put('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateTenantSchema.parse(req.body);
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const roles: string[] = (req as any).roles || [];

      if (!roles.includes('OWNER') && !roles.includes('ADMIN')) {
        res.status(403).json({ error: 'Only OWNER or ADMIN can update tenant' });
        return;
      }

      const sets: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (data.name !== undefined) {
        sets.push(`name = $${idx++}`);
        values.push(data.name);
      }
      if (data.settings !== undefined) {
        sets.push(`settings = $${idx++}`);
        values.push(JSON.stringify(data.settings));
      }

      if (sets.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      sets.push(`updated_at = now()`);
      values.push(tenantId);

      const result = await pool.query(
        `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${idx}
         RETURNING id, name, slug, plan, settings, is_active, created_at, updated_at`,
        values,
      );

      res.json(result.rows[0]);
    } catch (err: any) {
      if (err.name === 'ZodError') {
        res.status(400).json({ error: 'Validation failed', details: err.errors });
        return;
      }
      next(err);
    }
  });

  return router;
}
