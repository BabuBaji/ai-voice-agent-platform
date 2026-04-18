import { Request, Response, NextFunction } from 'express';
import { validate as isUUID } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
    }
  }
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.headers['x-tenant-id'] as string | undefined;

  if (!tenantId) {
    res.status(400).json({ error: 'x-tenant-id header is required' });
    return;
  }

  if (!isUUID(tenantId)) {
    res.status(400).json({ error: 'x-tenant-id must be a valid UUID' });
    return;
  }

  req.tenantId = tenantId;
  next();
}
