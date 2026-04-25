import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { tenantRouter } from './routes/tenant.routes';
import { userRouter } from './routes/user.routes';
import { roleRouter } from './routes/role.routes';
import { integrationRouter } from './routes/integration.routes';
import { auditRouter } from './routes/audit.routes';
import { apiKeyRouter } from './routes/apiKey.routes';
import { docRouter } from './routes/doc.routes';
import { billingRouter } from './routes/billing.routes';
import { auditMiddleware } from './middleware/audit.middleware';
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

  // Audit middleware — runs on every request, but only logs sensitive admin
  // mutations (post-auth so it has tenantId). Mounted before routes.
  app.use(auditMiddleware);

  // Routes
  app.use('/health', healthRouter());
  app.use('/auth', authRouter());
  app.use('/tenants', tenantRouter());
  app.use('/users', userRouter());
  app.use('/roles', roleRouter());
  app.use('/integrations', integrationRouter());
  app.use('/audit-log', auditRouter());
  app.use('/api-keys', apiKeyRouter());
  app.use('/docs', docRouter());
  app.use('/billing', billingRouter());

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
