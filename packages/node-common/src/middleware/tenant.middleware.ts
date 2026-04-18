import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

export function tenantMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const tenantId = req.tenantId || req.headers['x-tenant-id'] as string;

  if (!tenantId) {
    res.status(400).json({ error: 'Tenant ID is required' });
    return;
  }

  req.tenantId = tenantId;
  next();
}
