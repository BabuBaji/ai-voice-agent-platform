import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { notificationRouter } from './routes/notifications';
import { templateRouter } from './routes/templates';
import { whatsappRouter } from './routes/whatsapp';
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
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/templates', templateRouter);
app.use('/api/v1/whatsapp', whatsappRouter);

app.use(errorHandler);

export { app };
