import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRoles } from '../middleware/auth.middleware';
import { config } from '../config';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  roleNames: z.array(z.string()).optional().default(['VIEWER']),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

const updateMeSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(0).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  timezone: z.string().max(80).optional(),
  preferredLanguage: z.string().max(20).optional(),
});

export function userRouter(): Router {
  const router = Router();

  router.use(authMiddleware);

  // GET /users/me - current user's profile
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const userId = (req as any).userId;
      const result = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url, u.phone,
                u.timezone, u.preferred_language, u.status, u.email_verified,
                u.last_login_at, u.created_at, u.updated_at,
                COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1
         GROUP BY u.id`,
        [userId],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // PUT /users/me - update own profile (first/last name, phone, timezone, preferred lang, avatar)
  router.put('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = updateMeSchema.parse(req.body);
      const pool = (req as any).pool;
      const userId = (req as any).userId;

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.firstName !== undefined) { sets.push(`first_name = $${idx++}`); values.push(data.firstName); }
      if (data.lastName !== undefined) { sets.push(`last_name = $${idx++}`); values.push(data.lastName); }
      if (data.avatarUrl !== undefined) { sets.push(`avatar_url = $${idx++}`); values.push(data.avatarUrl); }
      if (data.phone !== undefined) { sets.push(`phone = $${idx++}`); values.push(data.phone); }
      if (data.timezone !== undefined) { sets.push(`timezone = $${idx++}`); values.push(data.timezone); }
      if (data.preferredLanguage !== undefined) { sets.push(`preferred_language = $${idx++}`); values.push(data.preferredLanguage); }

      if (sets.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }
      sets.push(`updated_at = now()`);
      values.push(userId);

      const result = await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}
         RETURNING id, email, first_name, last_name, avatar_url, phone, timezone,
                   preferred_language, status, email_verified, last_login_at, created_at, updated_at`,
        values,
      );
      res.json(result.rows[0]);
    } catch (err: any) {
      if (err?.name === 'ZodError') {
        res.status(400).json({ error: 'Validation failed', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // GET /users - list users for current tenant
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;

      const result = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url,
                u.status, u.email_verified, u.last_login_at, u.created_at,
                COALESCE(
                  json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]'
                ) AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = $1
         GROUP BY u.id
         ORDER BY u.created_at`,
        [tenantId],
      );

      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  // POST /users - create/invite user in current tenant
  router.post(
    '/',
    requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = createUserSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;

        const passwordHash = await bcrypt.hash(data.password, config.bcryptRounds);
        const userId = uuidv4();

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const userResult = await client.query(
            `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, tenant_id, email, first_name, last_name, avatar_url, status, email_verified, created_at`,
            [userId, tenantId, data.email, passwordHash, data.firstName, data.lastName],
          );

          // Assign roles
          for (const roleName of data.roleNames) {
            const roleResult = await client.query(
              `SELECT id FROM roles WHERE tenant_id = $1 AND name = $2`,
              [tenantId, roleName],
            );
            if (roleResult.rows.length > 0) {
              await client.query(
                `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
                [userId, roleResult.rows[0].id],
              );
            }
          }

          await client.query('COMMIT');

          res.status(201).json({
            ...userResult.rows[0],
            roles: data.roleNames,
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (err: any) {
        if (err.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        if (err.code === '23505') {
          res.status(409).json({ error: 'User with this email already exists in this tenant' });
          return;
        }
        next(err);
      }
    },
  );

  // PUT /users/:id
  router.put(
    '/:id',
    requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = updateUserSchema.parse(req.body);
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        const targetId = req.params.id;

        const sets: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (data.firstName !== undefined) {
          sets.push(`first_name = $${idx++}`);
          values.push(data.firstName);
        }
        if (data.lastName !== undefined) {
          sets.push(`last_name = $${idx++}`);
          values.push(data.lastName);
        }
        if (data.avatarUrl !== undefined) {
          sets.push(`avatar_url = $${idx++}`);
          values.push(data.avatarUrl);
        }
        if (data.status !== undefined) {
          sets.push(`status = $${idx++}`);
          values.push(data.status);
        }

        if (sets.length === 0) {
          res.status(400).json({ error: 'No fields to update' });
          return;
        }

        sets.push(`updated_at = now()`);
        values.push(targetId, tenantId);

        const result = await pool.query(
          `UPDATE users SET ${sets.join(', ')}
           WHERE id = $${idx} AND tenant_id = $${idx + 1}
           RETURNING id, email, first_name, last_name, avatar_url, status, email_verified, created_at, updated_at`,
          values,
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        res.json(result.rows[0]);
      } catch (err: any) {
        if (err.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    },
  );

  // DELETE /users/:id - soft delete
  router.delete(
    '/:id',
    requireRoles('OWNER', 'ADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = (req as any).pool;
        const tenantId = (req as any).tenantId;
        const targetId = req.params.id;
        const currentUserId = (req as any).userId;

        if (targetId === currentUserId) {
          res.status(400).json({ error: 'Cannot disable yourself' });
          return;
        }

        const result = await pool.query(
          `UPDATE users SET status = 'DISABLED', updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id`,
          [targetId, tenantId],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        res.json({ message: 'User disabled' });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
