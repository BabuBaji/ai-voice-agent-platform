import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { agentRouter } from './routes/agents';
import { requestLogger } from './middleware/requestLogger';
import { tenantMiddleware } from './middleware/tenant';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Health check (no tenant context needed)
app.use('/health', healthRouter);

// All API routes require tenant context
app.use('/api/v1/agents', tenantMiddleware, agentRouter);

app.use(errorHandler);

export { app };
