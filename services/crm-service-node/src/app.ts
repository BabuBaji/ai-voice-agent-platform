import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { tenantMiddleware } from './middleware/tenant';
import healthRoutes from './routes/health.routes';
import leadRoutes from './routes/lead.routes';
import contactRoutes from './routes/contact.routes';
import pipelineRoutes from './routes/pipeline.routes';
import dealRoutes from './routes/deal.routes';
import taskRoutes from './routes/task.routes';
import appointmentRoutes from './routes/appointment.routes';
import noteRoutes from './routes/note.routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check does not require tenant
app.use('/', healthRoutes);

// All other routes require tenant
app.use('/leads', tenantMiddleware, leadRoutes);
app.use('/contacts', tenantMiddleware, contactRoutes);
app.use('/pipelines', tenantMiddleware, pipelineRoutes);
app.use('/deals', tenantMiddleware, dealRoutes);
app.use('/tasks', tenantMiddleware, taskRoutes);
app.use('/appointments', tenantMiddleware, appointmentRoutes);
app.use('/notes', tenantMiddleware, noteRoutes);

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
