import { Router, Request, Response } from 'express';
import { pool } from '../db/init';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT NOW() as time');
    res.json({
      status: 'healthy',
      service: 'crm-service-node',
      timestamp: result.rows[0].time,
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'crm-service-node',
      error: (err as Error).message,
    });
  }
});

export default router;
