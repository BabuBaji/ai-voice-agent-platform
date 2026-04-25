import { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * Gate admin-only routes. Relies on authMiddleware having run first — it
 * attaches req.user with {sub, tenantId, email, roles}. If the caller's
 * roles don't include OWNER or ADMIN, respond 403 and stop the chain.
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const roles = Array.isArray(req.user?.roles) ? req.user!.roles : [];
  const allowed = roles.some((r) => ADMIN_ROLES.has(String(r).toUpperCase()));
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden', message: 'Admin role required' });
    return;
  }
  // Forward roles downstream so the service-level handler can also trust-but-verify.
  (req.headers as any)['x-user-roles'] = roles.join(',');
  next();
}
