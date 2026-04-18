import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
  tenantId?: string;
  email?: string;
  roles?: string[];
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
}

export function authMiddleware(jwtSecret: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      req.userId = decoded.sub;
      req.tenantId = decoded.tenantId;
      req.email = decoded.email;
      req.roles = decoded.roles;
      next();
    } catch (err) {
      logger.warn({ err }, 'JWT verification failed');
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
