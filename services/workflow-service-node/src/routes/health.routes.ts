import { Router, Request, Response } from 'express';
import { pool } from '../db/init';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch (_) {}

  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    service: 'workflow-service',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

export default router;
