import { Router } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';

export const proxyRouter = Router();

function createProxy(target: string, pathRewrite?: Record<string, string>): any {
  const options: Options = {
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      proxyReq: (_proxyReq, req) => {
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

// Path rewrite helpers:
// identity-service-node: routes are /auth, /tenants, /users, /roles (no /api/v1 prefix)
const stripApiV1 = { '^/api/v1': '' };

// telephony-adapter, conversation-service, notification-service: routes have /api/v1 prefix
// crm-service-node: routes are /leads, /contacts, etc. (no /api/v1 prefix)
// workflow-service-node: routes are /workflows (no /api/v1 prefix)
// knowledge-service, analytics-service, ai-runtime: Python FastAPI, no /api/v1 prefix

// --- Auth routes (no auth required) ---
proxyRouter.use('/api/v1/auth', createProxy(config.services.identity, stripApiV1));

// --- Identity service (auth required) ---
proxyRouter.use('/api/v1/tenants', authMiddleware, createProxy(config.services.identity, stripApiV1));
proxyRouter.use('/api/v1/users', authMiddleware, createProxy(config.services.identity, stripApiV1));
proxyRouter.use('/api/v1/roles', authMiddleware, createProxy(config.services.identity, stripApiV1));

// --- Agent service (routes: /api/v1/agents) ---
proxyRouter.use('/api/v1/agents', authMiddleware, createProxy(config.services.agent));

// --- Telephony adapter (routes: /api/v1/calls, /api/v1/phone-numbers) ---
proxyRouter.use('/api/v1/calls', authMiddleware, createProxy(config.services.telephony));
proxyRouter.use('/api/v1/phone-numbers', authMiddleware, createProxy(config.services.telephony));

// --- Conversation service (routes: /api/v1/conversations, /api/v1/conversations/:id/messages) ---
proxyRouter.use('/api/v1/conversations', authMiddleware, createProxy(config.services.conversation));
proxyRouter.use('/api/v1/messages', authMiddleware, createProxy(config.services.conversation));

// --- CRM service (routes: /leads, /contacts, /pipelines, /deals, /tasks, /appointments, /notes) ---
proxyRouter.use('/api/v1/leads', authMiddleware, createProxy(config.services.crm, stripApiV1));
proxyRouter.use('/api/v1/contacts', authMiddleware, createProxy(config.services.crm, stripApiV1));
proxyRouter.use('/api/v1/pipelines', authMiddleware, createProxy(config.services.crm, stripApiV1));
proxyRouter.use('/api/v1/deals', authMiddleware, createProxy(config.services.crm, stripApiV1));
proxyRouter.use('/api/v1/tasks', authMiddleware, createProxy(config.services.crm, stripApiV1));
proxyRouter.use('/api/v1/appointments', authMiddleware, createProxy(config.services.crm, stripApiV1));
proxyRouter.use('/api/v1/notes', authMiddleware, createProxy(config.services.crm, stripApiV1));

// --- Knowledge service (Python FastAPI routes: /documents, /search, /knowledge-bases) ---
proxyRouter.use('/api/v1/knowledge', authMiddleware, createProxy(config.services.knowledge, { '^/api/v1/knowledge': '' }));

// --- Workflow service (routes: /workflows) ---
proxyRouter.use('/api/v1/workflows', authMiddleware, createProxy(config.services.workflow, stripApiV1));

// --- Analytics service (Python FastAPI routes: /metrics, /dashboard) ---
proxyRouter.use('/api/v1/analytics', authMiddleware, createProxy(config.services.analytics, { '^/api/v1/analytics': '' }));

// --- Notification service (routes: /api/v1/notifications, /api/v1/templates) ---
proxyRouter.use('/api/v1/notifications', authMiddleware, createProxy(config.services.notification));
proxyRouter.use('/api/v1/templates', authMiddleware, createProxy(config.services.notification));

// --- AI Runtime (Python FastAPI routes: /chat, /tools, /rag) ---
proxyRouter.use('/api/v1/chat', authMiddleware, createProxy(config.services.aiRuntime, stripApiV1));
proxyRouter.use('/api/v1/tools', authMiddleware, createProxy(config.services.aiRuntime, stripApiV1));
proxyRouter.use('/api/v1/rag', authMiddleware, createProxy(config.services.aiRuntime, stripApiV1));

// --- Unauthenticated routes ---
proxyRouter.use('/webhooks', createProxy(config.services.telephony));
