import { Router } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';

export const proxyRouter = Router();

function createProxy(target: string, pathRewrite?: Record<string, string>): ReturnType<typeof createProxyMiddleware> {
  const options: Options = {
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      proxyReq: (_proxyReq, req) => {
        // Forward tenant/user context headers if present
        const anyReq = req as any;
        if (anyReq.user) {
          _proxyReq.setHeader('x-user-id', anyReq.user.sub || '');
          _proxyReq.setHeader('x-tenant-id', anyReq.user.tenantId || '');
        }
      },
      error: (err, _req, res) => {
        console.error('Proxy error:', err.message);
        if ('writeHead' in res && typeof res.writeHead === 'function') {
          (res as any).status(502).json({ error: 'Bad Gateway', message: 'Downstream service unavailable' });
        }
      },
    },
  };
  return createProxyMiddleware(options);
}

// --- Authenticated routes ---

// Auth routes (identity-service) - some routes like login/register don't need auth
proxyRouter.use(
  '/api/v1/auth',
  createProxy(config.services.identity, { '^/api/v1/auth': '/api/v1/auth' }),
);

// Identity service routes (require auth)
proxyRouter.use('/api/v1/tenants', authMiddleware, createProxy(config.services.identity));
proxyRouter.use('/api/v1/users', authMiddleware, createProxy(config.services.identity));
proxyRouter.use('/api/v1/roles', authMiddleware, createProxy(config.services.identity));

// Agent service
proxyRouter.use('/api/v1/agents', authMiddleware, createProxy(config.services.agent));

// Telephony adapter
proxyRouter.use('/api/v1/calls', authMiddleware, createProxy(config.services.telephony));
proxyRouter.use('/api/v1/phone-numbers', authMiddleware, createProxy(config.services.telephony));

// Conversation service
proxyRouter.use('/api/v1/conversations', authMiddleware, createProxy(config.services.conversation));
proxyRouter.use('/api/v1/messages', authMiddleware, createProxy(config.services.conversation));

// CRM service
proxyRouter.use('/api/v1/leads', authMiddleware, createProxy(config.services.crm));
proxyRouter.use('/api/v1/contacts', authMiddleware, createProxy(config.services.crm));
proxyRouter.use('/api/v1/pipelines', authMiddleware, createProxy(config.services.crm));
proxyRouter.use('/api/v1/deals', authMiddleware, createProxy(config.services.crm));
proxyRouter.use('/api/v1/tasks', authMiddleware, createProxy(config.services.crm));
proxyRouter.use('/api/v1/appointments', authMiddleware, createProxy(config.services.crm));

// Knowledge service
proxyRouter.use('/api/v1/knowledge', authMiddleware, createProxy(config.services.knowledge));

// Workflow service
proxyRouter.use('/api/v1/workflows', authMiddleware, createProxy(config.services.workflow));

// Analytics service
proxyRouter.use('/api/v1/analytics', authMiddleware, createProxy(config.services.analytics));

// Notification service
proxyRouter.use('/api/v1/notifications', authMiddleware, createProxy(config.services.notification));

// --- Unauthenticated routes ---

// Webhooks (no auth - verified by downstream service)
proxyRouter.use('/webhooks', createProxy(config.services.telephony));
