import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { conversationRouter } from './routes/conversations';
import { messageRouter } from './routes/messages';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Health check
app.use('/health', healthRouter);

// API routes
app.use('/api/v1/conversations', conversationRouter);
app.use('/api/v1/messages', messageRouter);

app.use(errorHandler);

export { app };
