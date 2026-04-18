import { Router, Request, Response } from 'express';
import http from 'http';
import { URL } from 'url';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';

export const proxyRouter = Router();

function forwardRequest(target: string, pathRewrite: (path: string) => string) {
  return (req: Request, res: Response) => {
    const rewrittenPath = pathRewrite(req.originalUrl);
    const targetUrl = new URL(rewrittenPath, target);

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    };

    // Forward user context from auth middleware
    const anyReq = req as any;
    if (anyReq.user) {
      options.headers!['x-user-id'] = anyReq.user.sub || '';
      options.headers!['x-tenant-id'] = anyReq.user.tenantId || '';
    }

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`Proxy error to ${target}:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Bad Gateway', message: 'Downstream service unavailable' });
      }
    });

    // Pipe the original request body to the proxy request
    req.pipe(proxyReq);
  };
}

// Helper: strip /api/v1 prefix
const stripPrefix = (path: string) => path.replace(/^\/api\/v1/, '');
// Helper: keep path as-is
const keepPath = (path: string) => path;

// --- Auth routes (NO authentication required) ---
proxyRouter.all('/api/v1/auth/*', forwardRequest(config.services.identity, stripPrefix));

// --- Identity routes (auth required) ---
proxyRouter.all('/api/v1/tenants/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/tenants', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/users/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/users', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/roles/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/roles', authMiddleware, forwardRequest(config.services.identity, stripPrefix));

// --- Agent service ---
proxyRouter.all('/api/v1/agents/*', authMiddleware, forwardRequest(config.services.agent, keepPath));
proxyRouter.all('/api/v1/agents', authMiddleware, forwardRequest(config.services.agent, keepPath));

// --- Telephony adapter ---
proxyRouter.all('/api/v1/calls/*', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/calls', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/phone-numbers/*', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/phone-numbers', authMiddleware, forwardRequest(config.services.telephony, keepPath));

// --- Conversation service ---
proxyRouter.all('/api/v1/conversations/*', authMiddleware, forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/conversations', authMiddleware, forwardRequest(config.services.conversation, keepPath));

// --- CRM service ---
proxyRouter.all('/api/v1/leads/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/leads', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/contacts/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/contacts', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/pipelines/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/pipelines', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/deals/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/deals', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/tasks/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/tasks', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/appointments/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/appointments', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/notes/*', authMiddleware, forwardRequest(config.services.crm, stripPrefix));
proxyRouter.all('/api/v1/notes', authMiddleware, forwardRequest(config.services.crm, stripPrefix));

// --- Knowledge service ---
proxyRouter.all('/api/v1/knowledge/*', authMiddleware, forwardRequest(config.services.knowledge, (p) => p.replace(/^\/api\/v1\/knowledge/, '')));
proxyRouter.all('/api/v1/knowledge', authMiddleware, forwardRequest(config.services.knowledge, (p) => p.replace(/^\/api\/v1\/knowledge/, '')));

// --- Workflow service ---
proxyRouter.all('/api/v1/workflows/*', authMiddleware, forwardRequest(config.services.workflow, stripPrefix));
proxyRouter.all('/api/v1/workflows', authMiddleware, forwardRequest(config.services.workflow, stripPrefix));

// --- Analytics service ---
proxyRouter.all('/api/v1/analytics/*', authMiddleware, forwardRequest(config.services.analytics, (p) => p.replace(/^\/api\/v1\/analytics/, '')));
proxyRouter.all('/api/v1/analytics', authMiddleware, forwardRequest(config.services.analytics, (p) => p.replace(/^\/api\/v1\/analytics/, '')));

// --- Notification service ---
proxyRouter.all('/api/v1/notifications/*', authMiddleware, forwardRequest(config.services.notification, keepPath));
proxyRouter.all('/api/v1/notifications', authMiddleware, forwardRequest(config.services.notification, keepPath));

// --- AI Runtime ---
proxyRouter.all('/api/v1/chat/*', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));
proxyRouter.all('/api/v1/chat', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));
proxyRouter.all('/api/v1/tools/*', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));
proxyRouter.all('/api/v1/rag/*', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));

// --- Webhooks (no auth) ---
proxyRouter.all('/webhooks/*', forwardRequest(config.services.telephony, keepPath));
