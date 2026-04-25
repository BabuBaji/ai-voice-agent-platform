import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { agentRouter } from './routes/agents';
import { voiceCloneRouter } from './routes/voiceClones';
import * as agentController from './controllers/agent.controller';
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

// Public agent lookup — no tenant header required, exposes minimal fields
// only for ACTIVE agents. Used by the embeddable chat widget.
app.get('/api/v1/agents-public/:id', agentController.getAgentPublic);

// All API routes require tenant context
app.use('/api/v1/agents', tenantMiddleware, agentRouter);
app.use('/api/v1/voice-clones', tenantMiddleware, voiceCloneRouter);

app.use(errorHandler);

export { app };
