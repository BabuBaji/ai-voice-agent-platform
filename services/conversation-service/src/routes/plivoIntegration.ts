/**
 * Per-tenant Plivo integration REST endpoints.
 *
 *   GET    /api/v1/integrations/plivo                  — masked config
 *   PUT    /api/v1/integrations/plivo                  — upsert (encrypts auth_token)
 *   DELETE /api/v1/integrations/plivo                  — disconnect
 *   POST   /api/v1/integrations/plivo/test/sms         — send a test SMS
 *   POST   /api/v1/integrations/plivo/test/whatsapp    — send a test WhatsApp
 *
 * Tenant isolation: every endpoint reads `x-tenant-id` from the gateway and
 * scopes every query by it. The auth_token is encrypted at rest (AES-256-GCM)
 * and never round-trips through the API — the GET response only returns a
 * masked indicator.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  loadTenantPlivoConfig, upsertTenantPlivoConfig,
  deleteTenantPlivoConfig, recordPlivoTestResult, toPublic,
  writePlivoAudit, diffPlivoConfig, type PlivoAuditContext,
} from '../services/tenantPlivoConfig';
import { sendWhatsApp, sendSms } from '../services/communications';
import { pool } from '../index';

export const plivoIntegrationRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

/** Pull actor info from gateway-injected headers. Same convention the
 *  telephony-adapter number-audit path uses (see actorFrom in numberLifecycle). */
function actorOf(req: Request): PlivoAuditContext {
  return {
    actor_user_id: (req.headers['x-user-id'] as string) || null,
    actor_email:   (req.headers['x-user-email'] as string) || null,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || null,
    user_agent: (req.headers['user-agent'] as string) || null,
  };
}

plivoIntegrationRouter.get('/plivo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const cfg = await loadTenantPlivoConfig(tenantId);
    res.json(toPublic(cfg));
  } catch (err) { next(err); }
});

// DLT template descriptor — a single approved Indian carrier template.
// `id` is the human label the caller passes when sending; `dlt_id` is what
// gets attached to the Plivo Message API call; `content` is the body the UI
// shows so the operator can sanity-check before sending.
const templateSchema = z.object({
  id: z.string().min(1),
  content: z.string().optional(),
  dlt_id: z.string().optional(),
});

const upsertSchema = z.object({
  auth_id: z.string().min(6),
  // Empty string is allowed (means "keep existing encrypted token"). Validation
  // upgrades to required when no row exists yet — checked below.
  auth_token: z.string().optional(),
  sms_sender_id: z.string().max(40).optional().nullable(),
  whatsapp_sender: z.string().max(40).optional().nullable(),
  dlt_entity_id: z.string().max(32).optional().nullable(),
  dlt_template_config: z.object({
    default_template_id: z.string().optional(),
    templates: z.array(templateSchema).optional(),
    whatsapp_namespace: z.string().optional(),
  }).optional(),
  sms_enabled: z.boolean().optional(),
  whatsapp_enabled: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  webhook_secret: z.string().max(64).optional().nullable(),
});

plivoIntegrationRouter.put('/plivo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = upsertSchema.parse(req.body || {});
    // First-time save MUST include the auth token.
    const prev = await loadTenantPlivoConfig(tenantId);
    if (!data.auth_token && !prev) {
      res.status(400).json({ error: 'Validation', message: 'auth_token is required when first configuring Plivo' });
      return;
    }
    const upsertInput = {
      auth_id: data.auth_id,
      auth_token: data.auth_token,
      sms_sender_id: data.sms_sender_id,
      whatsapp_sender: data.whatsapp_sender,
      dlt_entity_id: data.dlt_entity_id,
      dlt_template_config: data.dlt_template_config,
      sms_enabled: data.sms_enabled,
      whatsapp_enabled: data.whatsapp_enabled,
      status: data.status,
      webhook_secret: data.webhook_secret,
    };
    await upsertTenantPlivoConfig(tenantId, upsertInput);
    // Audit: diff what changed (auth_token is never recorded in plaintext;
    // a rotation is signalled as { rotated: true }).
    const changes = diffPlivoConfig(prev, upsertInput, !!data.auth_token);
    void writePlivoAudit(
      tenantId,
      prev ? 'updated' : 'created',
      changes,
      actorOf(req),
    );
    const cfg = await loadTenantPlivoConfig(tenantId);
    res.json(toPublic(cfg));
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

plivoIntegrationRouter.delete('/plivo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    await deleteTenantPlivoConfig(tenantId);
    void writePlivoAudit(tenantId, 'disconnected', {}, actorOf(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/integrations/plivo/audit — most-recent integration changes for
 * this tenant. Sorted newest-first. Limit/offset for the UI's timeline.
 */
plivoIntegrationRouter.get('/plivo/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
    const r = await pool.query(
      `SELECT id, actor_user_id, actor_email, action, field_changes, ip, user_agent, created_at
         FROM tenant_plivo_audit
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset],
    );
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});

const testSchema = z.object({
  to: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  body: z.string().min(1).max(800).optional(),
});

plivoIntegrationRouter.post('/plivo/test/sms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { to, body } = testSchema.parse(req.body || {});
    const recipient = to.startsWith('+') ? to : `+${to.replace(/\D/g, '')}`;
    const message = body || 'Test SMS from your CRM Plivo integration. If you see this, SMS delivery is working.';
    // Uses the main sendSms path so the per-tenant resolver runs end-to-end
    // and the test attempt lands in communication_logs.
    const out = await sendSms({ tenant_id: tenantId, recipient, message });
    await recordPlivoTestResult(tenantId, !!out.ok, out.ok ? 'Test SMS accepted by Plivo' : (out.error || 'Test SMS rejected'));
    void writePlivoAudit(tenantId, 'tested', { channel: 'sms', recipient, ok: !!out.ok, error: out.ok ? null : (out.error || null) }, actorOf(req));
    res.json({ ok: out.ok, log_id: out.log_id, error: out.error });
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

plivoIntegrationRouter.post('/plivo/test/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { to, body } = testSchema.parse(req.body || {});
    const recipient = to.startsWith('+') ? to : `+${to.replace(/\D/g, '')}`;
    const message = body || 'Test WhatsApp from your CRM Plivo integration. If you see this, WhatsApp delivery is working.';
    const out = await sendWhatsApp({ tenant_id: tenantId, recipient, message });
    await recordPlivoTestResult(tenantId, !!out.ok, out.ok ? 'Test WhatsApp accepted by Plivo' : (out.error || 'Test WhatsApp rejected'));
    void writePlivoAudit(tenantId, 'tested', { channel: 'whatsapp', recipient, ok: !!out.ok, error: out.ok ? null : (out.error || null) }, actorOf(req));
    res.json({ ok: out.ok, log_id: out.log_id, error: out.error });
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});
