import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { healthRouter } from './routes/health';
import { proxyRouter } from './routes/proxy';
import { rateLimiterMiddleware } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: config.cors.origin }));

// Body parsing (only for non-proxied routes)
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Rate limiting
app.use(rateLimiterMiddleware);

// Health check (no auth)
app.use('/health', healthRouter);

// Proxy routes
app.use('/', proxyRouter);

// Error handler
app.use(errorHandler);

export { app };
