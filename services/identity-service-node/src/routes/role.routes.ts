import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRoles } from '../middleware/auth.middleware';

const createRoleSchema = z.object({
  name: z.string().min(1).max(50),
  permissions: z.array(z.string()).default([]),
});

export function roleRouter(): Router {
  const router = Router();

  router.use(authMiddleware);

  // GET /roles - list roles for current tenant
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;

      const result = await pool.query(
        `SELECT id, name, permissions, is_system, created_at
         FROM roles
         WHERE tenant_id = $1
         ORDER BY is_system DESC, name`,
        [tenantId],
      );

      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  // POST /roles - create custom role
  router.post(
    '/',
    requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = createRoleSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;

        const roleId = uuidv4();
        const result = await pool.query(
          `INSERT INTO roles (id, tenant_id, name, permissions, is_system)
           VALUES ($1, $2, $3, $4, false)
           RETURNING id, name, permissions, is_system, created_at`,
          [roleId, tenantId, data.name, JSON.stringify(data.permissions)],
        );

        res.status(201).json(result.rows[0]);
      } catch (err: any) {
        if (err.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
