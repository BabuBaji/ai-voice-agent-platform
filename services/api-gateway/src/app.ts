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

// Request logging
app.use(requestLogger);

// Rate limiting
app.use(rateLimiterMiddleware);

// Health check (needs body parsing)
app.use('/health', express.json(), healthRouter);

// Proxy routes — DO NOT use express.json() here.
// Body parsing consumes the request stream and breaks http-proxy-middleware.
app.use('/', proxyRouter);

// Error handler
app.use(errorHandler);

export { app };
