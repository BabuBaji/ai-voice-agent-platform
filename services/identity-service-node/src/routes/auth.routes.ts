import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import * as authService from '../services/auth.service';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth.middleware';

const registerSchema = z.object({
  tenantName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).default(''),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export function authRouter(): Router {
  const router = Router();

  // POST /auth/register
  router.post(
    '/register',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = registerSchema.parse(req.body);
        const pool = (req as any).pool;
        const result = await authService.register(pool, data);
        res.status(201).json({
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
          user: result.user,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        if (err.code === '23505') {
          // unique constraint violation
          res.status(409).json({ error: 'Email or tenant already exists' });
          return;
        }
        next(err);
      }
    },
  );

  // POST /auth/login
  router.post(
    '/login',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = loginSchema.parse(req.body);
        const pool = (req as any).pool;
        const result = await authService.login(pool, data.email, data.password);
        res.json({
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
          user: result.user,
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        if (err.status === 401) {
          res.status(401).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  // POST /auth/refresh
  router.post(
    '/refresh',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = refreshSchema.parse(req.body);
        const pool = (req as any).pool;
        const tokens = await authService.refresh(pool, data.refreshToken);
        res.json(tokens);
      } catch (err: any) {
        if (err.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        if (err.status === 401) {
          res.status(401).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  // POST /auth/change-password — authed user changes their own password.
  router.post(
    '/change-password',
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = changePasswordSchema.parse(req.body);
        const pool = (req as any).pool;
        const userId = (req as any).userId;

        const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        const ok = await bcrypt.compare(data.currentPassword, userRes.rows[0].password_hash);
        if (!ok) {
          res.status(401).json({ error: 'Current password is incorrect' });
          return;
        }
        const newHash = await bcrypt.hash(data.newPassword, config.bcryptRounds);
        await pool.query(
          'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
          [newHash, userId],
        );
        res.json({ message: 'Password updated' });
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    },
  );

  // POST /auth/logout
  router.post(
    '/logout',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = logoutSchema.parse(req.body);
        const pool = (req as any).pool;
        await authService.logout(pool, data.refreshToken);
        res.json({ message: 'Logged out' });
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
