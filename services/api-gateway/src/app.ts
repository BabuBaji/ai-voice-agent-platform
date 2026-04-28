import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { healthRouter } from './routes/health';
import { proxyRouter } from './routes/proxy';
import { landingRouter } from './routes/landing';
import { rateLimiterMiddleware } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Security. Helmet's default cross-origin-resource-policy blocks /widget.js
// from being loaded by 3rd-party sites — relax it for the public widget
// surface but keep the rest of helmet's defaults.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.cors.origin }));

// Public chatbot widget — served to ANY origin, no auth, with permissive CORS
// so the embed snippet works on tenant customers' websites.
app.use(['/widget.js', '/widget/*'], cors({ origin: '*' }));
app.get('/widget.js', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.type('application/javascript');
  res.sendFile(path.resolve(__dirname, '../public/widget.js'));
});

// Request logging
app.use(requestLogger);

// Rate limiting
app.use(rateLimiterMiddleware);

// Health check (needs body parsing)
app.use('/health', express.json(), healthRouter);

// Public marketing/landing data — served directly by the gateway (no proxy).
// Mounted BEFORE proxyRouter so /api/v1/landing/* doesn't fall through to it.
app.use(landingRouter);

// Proxy routes — DO NOT use express.json() here.
// Body parsing consumes the request stream and breaks http-proxy-middleware.
app.use('/', proxyRouter);

// Error handler
app.use(errorHandler);

export { app };
