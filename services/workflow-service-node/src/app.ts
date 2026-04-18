import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { tenantMiddleware } from './middleware/tenant';
import healthRoutes from './routes/health.routes';
import workflowRoutes from './routes/workflow.routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check does not require tenant
app.use('/', healthRoutes);

// All workflow routes require tenant
app.use('/workflows', tenantMiddleware, workflowRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
