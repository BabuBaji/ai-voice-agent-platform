import { Router, Request, Response } from 'express';
import http from 'http';
import { URL } from 'url';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';

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
      if (Array.isArray(anyReq.user.roles) && anyReq.user.roles.length > 0) {
        options.headers!['x-user-roles'] = anyReq.user.roles.join(',');
      }
      if (anyReq.user.email) {
        options.headers!['x-user-email'] = anyReq.user.email;
      }
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

// --- Public docs (NO authentication required) ---
proxyRouter.all('/api/v1/docs/*', forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/docs', forwardRequest(config.services.identity, stripPrefix));

// --- Identity routes (auth required) ---
proxyRouter.all('/api/v1/tenants/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/tenants', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/users/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/users', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/roles/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/roles', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/integrations/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/integrations', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/audit-log/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/audit-log', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/api-keys/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/api-keys', authMiddleware, forwardRequest(config.services.identity, stripPrefix));

// --- Billing routes (auth required) ---
proxyRouter.all('/api/v1/billing/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/billing', authMiddleware, forwardRequest(config.services.identity, stripPrefix));

// --- Super-admin routes (auth required + isPlatformAdmin enforced downstream) ---
proxyRouter.all('/api/v1/super-admin/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/super-admin', authMiddleware, forwardRequest(config.services.identity, stripPrefix));

// --- Tenant-facing platform broadcasts (any authed user reads active banners) ---
proxyRouter.all('/api/v1/broadcasts/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/broadcasts', authMiddleware, forwardRequest(config.services.identity, stripPrefix));

// --- In-app help assistant (chat) ---
proxyRouter.all('/api/v1/assistant/*', authMiddleware, forwardRequest(config.services.identity, stripPrefix));
proxyRouter.all('/api/v1/assistant', authMiddleware, forwardRequest(config.services.identity, stripPrefix));

// --- PUBLIC chatbot widget endpoints (no auth — called from 3rd-party sites)
// /widget/agent/:id  → agent-service /api/v1/agents-public/:id  (read theme + greeting)
// /widget/chat       → ai-runtime  /chat/widget                 (send a message)
proxyRouter.all('/widget/agent/:id', forwardRequest(config.services.agent, (p: string) =>
  p.replace(/^\/widget\/agent\//, '/api/v1/agents-public/')));
proxyRouter.all('/widget/chat', forwardRequest(config.services.aiRuntime, () => '/chat/widget'));

// --- Agent service ---
proxyRouter.all('/api/v1/agents/*', authMiddleware, forwardRequest(config.services.agent, keepPath));
proxyRouter.all('/api/v1/agents', authMiddleware, forwardRequest(config.services.agent, keepPath));
proxyRouter.all('/api/v1/voice-clones/*', authMiddleware, forwardRequest(config.services.agent, keepPath));
proxyRouter.all('/api/v1/voice-clones', authMiddleware, forwardRequest(config.services.agent, keepPath));

// --- Telephony adapter ---
proxyRouter.all('/api/v1/calls/*', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/calls', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/phone-numbers/*', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/phone-numbers', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/campaigns/*', authMiddleware, forwardRequest(config.services.telephony, keepPath));
proxyRouter.all('/api/v1/campaigns', authMiddleware, forwardRequest(config.services.telephony, keepPath));

// --- Conversation service ---
proxyRouter.all('/api/v1/conversations/*', authMiddleware, forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/conversations', authMiddleware, forwardRequest(config.services.conversation, keepPath));
// Public GET for recording playback — <audio src="..."> can't send bearer tokens.
// call_id is an unguessable UUID so this is safe; anything mutating the call
// still flows through the authed /web-calls/* route below.
proxyRouter.get('/api/v1/web-calls/:id/recording', forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/web-calls/*', authMiddleware, forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/web-calls', authMiddleware, forwardRequest(config.services.conversation, keepPath));

// --- Support / Issue Reports ---
// Public submit: no auth, rate-limiting is enforced on the downstream service.
proxyRouter.post('/api/v1/reports/public', forwardRequest(config.services.conversation, keepPath));
// Authed user routes
proxyRouter.all('/api/v1/reports/*', authMiddleware, forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/reports', authMiddleware, forwardRequest(config.services.conversation, keepPath));
// Admin-only routes (role-gated before forwarding)
proxyRouter.all('/api/v1/admin/reports/*', authMiddleware, requireAdmin, forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/admin/reports', authMiddleware, requireAdmin, forwardRequest(config.services.conversation, keepPath));

// --- Contact Us / lead capture ---
// Public POST + GET-by-ref: no auth, IP-rate-limited server-side
proxyRouter.post('/api/v1/contact', forwardRequest(config.services.conversation, keepPath));
proxyRouter.get('/api/v1/contact/:refId', forwardRequest(config.services.conversation, keepPath));
// Admin only
proxyRouter.all('/api/v1/admin/contact-requests/*', authMiddleware, requireAdmin, forwardRequest(config.services.conversation, keepPath));
proxyRouter.all('/api/v1/admin/contact-requests', authMiddleware, requireAdmin, forwardRequest(config.services.conversation, keepPath));

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
proxyRouter.all('/api/v1/whatsapp/*', authMiddleware, forwardRequest(config.services.notification, keepPath));
proxyRouter.all('/api/v1/whatsapp', authMiddleware, forwardRequest(config.services.notification, keepPath));

// --- AI Runtime ---
proxyRouter.all('/api/v1/chat/*', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));
proxyRouter.all('/api/v1/chat', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));
proxyRouter.all('/api/v1/tools/*', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));
proxyRouter.all('/api/v1/rag/*', authMiddleware, forwardRequest(config.services.aiRuntime, stripPrefix));

// --- Voice service (STT/TTS) ---
proxyRouter.all('/api/v1/voice/*', authMiddleware, forwardRequest(config.services.voice, (p) => p.replace(/^\/api\/v1\/voice/, '')));
proxyRouter.all('/api/v1/voice', authMiddleware, forwardRequest(config.services.voice, (p) => p.replace(/^\/api\/v1\/voice/, '')));

// --- Webhooks (no auth) ---
proxyRouter.all('/webhooks/*', forwardRequest(config.services.telephony, keepPath));
