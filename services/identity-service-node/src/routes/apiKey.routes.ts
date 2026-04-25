import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { authMiddleware } from '../middleware/auth.middleware';

/**
 * API key management for our own platform API.
 *
 * Convention:
 *   - Key format: `vk_<base64url(32 bytes)>`. `vk_` for VoiceAgent Key so it's
 *     recognizable in logs. 32 bytes = 256 bits of entropy.
 *   - The plaintext key is shown to the user ONCE at create time. After that
 *     we only store a sha256 hash + the first 12 characters (for UI display).
 *   - The frontend previews the key in the table as `vk_abcd********` so the
 *     user can identify it without re-auth.
 *
 * Downstream (gateway) would authenticate incoming API requests by hashing
 * the incoming `Authorization: Bearer vk_xxx` header and looking up the hash
 * in `api_keys` where `revoked_at IS NULL`.
 */

const createSchema = z.object({
  name: z.string().min(1).max(100),
});

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateKey(): { raw: string; prefix: string; hash: string } {
  const raw = 'vk_' + randomBytes(32).toString('base64url');
  const prefix = raw.slice(0, 12); // "vk_" + first 9 chars
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

function maskedPreview(prefix: string): string {
  // e.g. "vk_ABcdEFgh••••••••••••••••••••"
  return `${prefix}${'•'.repeat(28)}`;
}

export function apiKeyRouter(): Router {
  const router = Router();
  router.use(authMiddleware);

  // GET /api-keys — list all non-revoked keys for this tenant
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const r = await pool.query(
        `SELECT id, name, key_prefix, last_used_at, created_at
         FROM api_keys
         WHERE tenant_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [tenantId],
      );
      const data = r.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        key_preview: maskedPreview(row.key_prefix),
        last_used_at: row.last_used_at,
        created_at: row.created_at,
      }));
      res.json({ data });
    } catch (err) { next(err); }
  });

  // POST /api-keys — create a new key. Returns the plaintext ONCE.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const userId = (req as any).userId;
      const roles: string[] = (req as any).roles || [];
      if (!roles.includes('OWNER') && !roles.includes('ADMIN')) {
        res.status(403).json({ error: 'Only OWNER or ADMIN can create API keys' });
        return;
      }

      const { name } = createSchema.parse(req.body);
      const { raw, prefix, hash } = generateKey();

      const inserted = await pool.query(
        `INSERT INTO api_keys (tenant_id, user_id, name, key_prefix, key_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, key_prefix, created_at`,
        [tenantId, userId || null, name.trim(), prefix, hash],
      );
      const row = inserted.rows[0];

      // Plaintext key is returned ONE TIME here — the UI must show it in a
      // "copy this now, you won't see it again" modal.
      res.status(201).json({
        id: row.id,
        name: row.name,
        key: raw,
        key_preview: maskedPreview(row.key_prefix),
        created_at: row.created_at,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation', details: err.errors });
        return;
      }
      next(err);
    }
  });

  // DELETE /api-keys/:id — revoke (soft-delete)
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const tenantId = (req as any).tenantId;
      const roles: string[] = (req as any).roles || [];
      if (!roles.includes('OWNER') && !roles.includes('ADMIN')) {
        res.status(403).json({ error: 'Only OWNER or ADMIN can revoke API keys' });
        return;
      }
      await pool.query(
        `UPDATE api_keys SET revoked_at = now()
         WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
        [req.params.id, tenantId],
      );
      res.status(204).send();
    } catch (err) { next(err); }
  });

  return router;
}
