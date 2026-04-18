import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that extracts tenant ID from the x-tenant-id header.
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.headers['x-tenant-id'] as string;

  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  // Attach to request for downstream use
  (req as any).tenantId = tenantId;
  next();
}
