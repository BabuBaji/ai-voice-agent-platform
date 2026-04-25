import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import * as authService from '../services/auth.service';
import * as otpService from '../services/otp.service';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth.middleware';
import * as jwtService from '../services/jwt.service';

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

const verifyOtpSchema = z.object({
  user_id: z.string().uuid(),
  otp: z.string().regex(/^\d{6}$/),
});

const resendOtpSchema = z.object({
  user_id: z.string().uuid(),
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

  // POST /auth/register-otp — like /auth/register but does NOT issue tokens.
  // Creates the tenant/user + sends a 6-digit OTP. Caller must then hit
  // /auth/verify-otp with the code to receive the access token.
  router.post(
    '/register-otp',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = registerSchema.parse(req.body);
        const pool = (req as any).pool;
        const result = await authService.register(pool, data);
        const otp = await otpService.createOtp(pool, result.user.id, result.user.email);
        // The tokens from register() are intentionally discarded — the user
        // must verify their email first to get a usable token.
        res.status(201).json({
          requires_otp: true,
          user_id: result.user.id,
          email: result.user.email,
          expires_at: otp.expires_at,
          dev_otp: otp.dev_otp,
        });
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        if (err?.code === '23505') {
          res.status(409).json({ error: 'Email or tenant already exists' });
          return;
        }
        next(err);
      }
    },
  );

  // POST /auth/verify-otp — validate the 6-digit code, mark email_verified,
  // issue access + refresh tokens. Returns the same shape as /auth/login.
  router.post(
    '/verify-otp',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = verifyOtpSchema.parse(req.body);
        const pool = (req as any).pool;

        const verify = await otpService.verifyOtp(pool, data.user_id, data.otp);
        if (!verify.ok) {
          const status = verify.reason === 'expired' || verify.reason === 'no_pending' ? 410 : 401;
          res.status(status).json({ error: 'OTP verification failed', reason: verify.reason });
          return;
        }

        // Look up user + roles, mint tokens.
        const userRes = await pool.query(
          `SELECT u.id, u.tenant_id, u.email, u.first_name, u.last_name, u.avatar_url,
                  u.status, u.email_verified, u.last_login_at, u.created_at, u.updated_at,
                  COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           WHERE u.id = $1
           GROUP BY u.id`,
          [data.user_id],
        );
        if (userRes.rows.length === 0) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        const u = userRes.rows[0];
        const roles: string[] = u.roles || [];

        const accessToken = jwtService.generateAccessToken(u.id, u.tenant_id, u.email, roles);
        const refreshToken = await jwtService.generateRefreshToken(pool, u.id);

        res.json({
          accessToken,
          refreshToken,
          expiresIn: config.jwt.accessExpiration,
          user: {
            id: u.id,
            email: u.email,
            firstName: u.first_name,
            lastName: u.last_name,
            tenantId: u.tenant_id,
            roles,
            avatarUrl: u.avatar_url,
            emailVerified: u.email_verified,
          },
        });
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
          return;
        }
        next(err);
      }
    },
  );

  // POST /auth/resend-otp — generate a fresh code for an existing user_id.
  router.post(
    '/resend-otp',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = resendOtpSchema.parse(req.body);
        const pool = (req as any).pool;
        const userRes = await pool.query(
          `SELECT id, email, email_verified FROM users WHERE id = $1`,
          [data.user_id],
        );
        if (userRes.rows.length === 0) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        if (userRes.rows[0].email_verified) {
          res.status(400).json({ error: 'Email already verified' });
          return;
        }
        const otp = await otpService.createOtp(pool, data.user_id, userRes.rows[0].email);
        res.json({
          ok: true,
          expires_at: otp.expires_at,
          dev_otp: otp.dev_otp,
        });
      } catch (err: any) {
        if (err?.name === 'ZodError') {
          res.status(400).json({ error: 'Validation failed', details: err.errors });
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
