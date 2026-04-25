import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  // Always surface the underlying error message so operators can see provider errors
  // (e.g. Twilio "unverified number") rather than a generic string.
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
  });
}
