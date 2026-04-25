import { Request, Response, NextFunction } from 'express';

/**
 * Audit logger — records sensitive admin actions to the `audit_log` table.
 *
 * Mounted globally (after authMiddleware so we have user/tenant context),
 * but only fires for the methods+paths we actually care about. The criteria
 * is: any state-changing call (POST/PUT/PATCH/DELETE) to a route managing
 * agents, integrations, tenants, users, roles, phone-numbers, campaigns, or
 * post-call settings. GET calls are skipped to keep the log signal-rich.
 */

const TRACKED_PATHS = [
  /^\/tenants\b/i,
  /^\/users\b/i,
  /^\/roles\b/i,
  /^\/integrations\b/i,
  /^\/api\/v1\/agents\b/i,
  /^\/api\/v1\/phone-numbers\b/i,
  /^\/api\/v1\/campaigns\b/i,
  /^\/api\/v1\/voice-clones\b/i,
];

const TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function shouldTrack(method: string, path: string): boolean {
  if (!TRACKED_METHODS.has(method.toUpperCase())) return false;
  return TRACKED_PATHS.some((rx) => rx.test(path));
}

function actionFor(method: string, path: string): { action: string; resourceType: string; resourceId: string | null } {
  const segments = path.split('?')[0].split('/').filter(Boolean);
  // Heuristic — last UUID-shaped segment is the resource id; second-to-last is the type.
  const isUuid = (s: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
  let resourceId: string | null = null;
  let resourceType = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isUuid(segments[i])) {
      resourceId = segments[i];
      resourceType = segments[i - 1] || '';
      break;
    }
  }
  if (!resourceType) {
    // No UUID — collection-level action like "POST /agents"
    resourceType = segments[segments.length - 1] || segments[0] || 'unknown';
  }
  const verb = method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update';
  return { action: `${verb}_${resourceType}`, resourceType, resourceId };
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  // Capture the response status code via res.on('finish')
  if (!shouldTrack(req.method, req.path)) {
    return next();
  }

  res.on('finish', () => {
    // Only audit successful + meaningful state changes
    if (res.statusCode >= 400) return;
    const tenantId = (req as any).tenantId as string | undefined;
    const userId = (req as any).userId as string | undefined;
    const userEmail = (req as any).userEmail as string | undefined;
    if (!tenantId) return; // unauth or signup flows — no tenant yet

    const pool = (req as any).pool;
    if (!pool) return; // pool not attached for some reason

    const { action, resourceType, resourceId } = actionFor(req.method, req.path);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || null;
    const ua = (req.headers['user-agent'] as string) || null;

    // Strip any obvious secrets from the body before logging
    const sanitized = sanitizeBody(req.body);

    pool
      .query(
        `INSERT INTO audit_log (tenant_id, user_id, user_email, action, resource_type, resource_id,
                                method, path, status_code, ip, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tenantId,
          userId || null,
          userEmail || null,
          action,
          resourceType || null,
          resourceId || null,
          req.method,
          req.path,
          res.statusCode,
          ip,
          ua,
          JSON.stringify(sanitized),
        ],
      )
      .catch(() => {
        /* never let logging break a request */
      });
  });

  next();
}

const SECRET_KEYS = /password|token|secret|api_key|apiKey|auth/i;

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeBody(v);
    } else if (typeof v === 'string' && v.length > 200) {
      out[k] = v.slice(0, 200) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}
