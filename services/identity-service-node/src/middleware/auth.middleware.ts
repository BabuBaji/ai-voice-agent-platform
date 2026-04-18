import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../services/jwt.service';

export interface AuthenticatedRequest extends Request {
  userId: string;
  tenantId: string;
  email: string;
  roles: string[];
  pool: any;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload: AccessTokenPayload = verifyAccessToken(token);
    (req as any).userId = payload.sub;
    (req as any).tenantId = payload.tenantId;
    (req as any).email = payload.email;
    (req as any).roles = payload.roles;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require specific roles. Must be used after authMiddleware.
 */
export function requireRoles(...requiredRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRoles: string[] = (req as any).roles || [];
    const hasRole = requiredRoles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
