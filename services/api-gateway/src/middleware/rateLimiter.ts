import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { config } from '../config';

// Using in-memory rate limiter for development; switch to RateLimiterRedis in production
const rateLimiter = new RateLimiterMemory({
  points: config.rateLimit.points,
  duration: config.rateLimit.duration,
});

export async function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = req.ip || 'unknown';
    await rateLimiter.consume(key);
    next();
  } catch {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
    });
  }
}
