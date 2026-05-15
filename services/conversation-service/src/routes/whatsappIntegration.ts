/**
 * Per-tenant WhatsApp integration REST endpoints.
 *
 *   GET    /api/v1/integrations/whatsapp           — masked config
 *   PUT    /api/v1/integrations/whatsapp           — upsert (encrypts creds)
 *   DELETE /api/v1/integrations/whatsapp           — disconnect
 *   POST   /api/v1/integrations/whatsapp/test      — send a test WhatsApp
 *
 * Tenant isolation: every endpoint reads the tenant_id from the gateway-
 * injected `x-tenant-id` header and scopes every query by it. There is no
 * way to read or write another tenant's row through this API.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  loadTenantWhatsAppConfig, upsertTenantWhatsAppConfig,
  deleteTenantWhatsAppConfig, recordTestResult, toPublic,
  type WhatsAppProvider, type WhatsAppMode,
} from '../services/tenantWhatsappConfig';
import { sendWhatsApp } from '../services/communications';

export const whatsappIntegrationRouter = Router();

function getTenantId(req: Request, res: Response): string | null {
  const t = req.headers['x-tenant-id'] as string;
  if (!t) {
    res.status(400).json({ error: 'Bad Request', message: 'x-tenant-id header required' });
    return null;
  }
  return t;
}

whatsappIntegrationRouter.get('/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const cfg = await loadTenantWhatsAppConfig(tenantId);
    res.json(toPublic(cfg));
  } catch (err) { next(err); }
});

const PROVIDERS: WhatsAppProvider[] = ['twilio', 'meta', 'gupshup', 'wati', 'interakt', 'custom'];
const MODES: WhatsAppMode[] = ['sandbox', 'production'];

const upsertSchema = z.object({
  provider: z.enum(PROVIDERS as [WhatsAppProvider, ...WhatsAppProvider[]]),
  mode: z.enum(MODES as [WhatsAppMode, ...WhatsAppMode[]]).default('sandbox'),
  // Credentials — provider-specific. We accept a generic object; provider
  // adapters validate the shape themselves. An EMPTY object means "keep
  // existing encrypted creds" (lets the UI save non-secret fields without
  // re-typing tokens). Adapters reject if required fields are missing.
  credentials: z.record(z.string()).optional(),
  sender_number: z.string().optional().nullable(),
  whatsapp_from: z.string().optional().nullable(),
  phone_number_id: z.string().optional().nullable(),
  business_account_id: z.string().optional().nullable(),
  template_config: z.record(z.any()).optional(),
  webhook_secret: z.string().optional().nullable(),
  status: z.enum(['active', 'disabled']).optional(),
});

whatsappIntegrationRouter.put('/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const data = upsertSchema.parse(req.body || {});
    await upsertTenantWhatsAppConfig(tenantId, {
      provider: data.provider,
      mode: data.mode,
      credentials: data.credentials || {},
      sender_number: data.sender_number,
      whatsapp_from: data.whatsapp_from,
      phone_number_id: data.phone_number_id,
      business_account_id: data.business_account_id,
      template_config: data.template_config,
      webhook_secret: data.webhook_secret,
      status: data.status,
    });
    const cfg = await loadTenantWhatsAppConfig(tenantId);
    res.json(toPublic(cfg));
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});

whatsappIntegrationRouter.delete('/whatsapp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    await deleteTenantWhatsAppConfig(tenantId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const testSchema = z.object({
  to: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  body: z.string().min(1).max(800).optional(),
});

whatsappIntegrationRouter.post('/whatsapp/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;
    const { to, body } = testSchema.parse(req.body || {});
    const recipient = to.startsWith('+') ? to : `+${to.replace(/\D/g, '')}`;
    const message = body || 'Test message from your CRM WhatsApp integration. If you see this, the integration is working.';
    // Reuses the main sendWhatsApp path so the tenant resolution +
    // communication_logs + provider adapters are exercised exactly the same
    // way a real send would be. No bypass.
    const out = await sendWhatsApp({
      tenant_id: tenantId, recipient, message,
    });
    await recordTestResult(tenantId, !!out.ok, out.ok ? 'Test send accepted by provider' : (out.error || 'Test send rejected'));
    res.json({ ok: out.ok, log_id: out.log_id, error: out.error });
  } catch (err: any) {
    if (err?.name === 'ZodError') { res.status(400).json({ error: 'Validation', details: err.errors }); return; }
    next(err);
  }
});
