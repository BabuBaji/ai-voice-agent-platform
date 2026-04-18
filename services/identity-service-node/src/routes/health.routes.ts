import { Router, Request, Response } from 'express';

export function healthRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const pool = (req as any).pool;
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() });
    }
  });

  return router;
}
