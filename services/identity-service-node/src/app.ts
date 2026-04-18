import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { tenantRouter } from './routes/tenant.routes';
import { userRouter } from './routes/user.routes';
import { roleRouter } from './routes/role.routes';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

export function createApp(pool: Pool) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Attach pool to every request
  app.use((req, _res, next) => {
    (req as any).pool = pool;
    next();
  });

  // Routes
  app.use('/health', healthRouter());
  app.use('/auth', authRouter());
  app.use('/tenants', tenantRouter());
  app.use('/users', userRouter());
  app.use('/roles', roleRouter());

  // Global error handler
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error({ err }, 'Unhandled error');
      const status = err.status || 500;
      res.status(status).json({
        error: err.message || 'Internal server error',
      });
    },
  );

  return app;
}
