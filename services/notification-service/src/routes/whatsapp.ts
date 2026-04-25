import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { startSession, statusOf, logout } from '../services/whatsappManager';

export const whatsappRouter = Router();

function tenantOf(req: Request, res: Response): string | null {
  const t = (req.headers['x-tenant-id'] as string) || '';
  if (!t) {
    res.status(400).json({ error: 'x-tenant-id required' });
    return null;
  }
  return t;
}

/**
 * POST /whatsapp/phone/connect — kick off (or resume) a Web-WhatsApp session
 * for this tenant. Returns the current status; the frontend then polls GET
 * /whatsapp/phone/status for the QR + connection state.
 */
whatsappRouter.post('/phone/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const s = await startSession(tenantId);
    res.json({ status: s.status, qr: s.qrDataUrl, qr_expires_at: s.qrExpiresAt, phone_number: s.phoneNumber, error: s.error });
  } catch (err) { next(err); }
});

/**
 * GET /whatsapp/phone/status — poll for QR + connection state. The widget
 * hits this every ~2s while the QR modal is open; as soon as status flips to
 * `connected` it closes.
 */
whatsappRouter.get('/phone/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const s = statusOf(tenantId);
    res.json({ status: s.status, qr: s.qrDataUrl, qr_expires_at: s.qrExpiresAt, phone_number: s.phoneNumber, error: s.error });
  } catch (err) { next(err); }
});

/**
 * POST /whatsapp/phone/logout — sign out of WhatsApp Web + clear cached auth.
 */
whatsappRouter.post('/phone/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    await logout(tenantId);
    res.json({ status: 'idle' });
  } catch (err) { next(err); }
});

// ─── Cloud WhatsApp (Meta Cloud API) ─────────────────────────────────────
// Stores the user's Meta credentials in-memory per tenant. Production should
// persist to the integrations table — we keep it simple here.

const cloudCredsStore = new Map<string, CloudCreds>();

interface CloudCreds {
  business_account_id: string;
  access_token: string;
  app_id?: string;
  business_id?: string;
  verified_at?: string;
  display_name?: string;
}

const cloudSchema = z.object({
  business_account_id: z.string().min(1),
  access_token: z.string().min(10),
  app_id: z.string().optional(),
  business_id: z.string().optional(),
});

whatsappRouter.post('/cloud/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const parsed = cloudSchema.parse(req.body);

    // Verify the token by hitting Meta's Graph API — returns the phone
    // numbers on the business account if the creds are valid.
    const url = `https://graph.facebook.com/v18.0/${parsed.business_account_id}/phone_numbers?access_token=${encodeURIComponent(parsed.access_token)}`;
    try {
      const r = await fetch(url);
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = j?.error?.message || `Meta ${r.status}`;
        res.status(400).json({ error: 'Invalid credentials', message: msg });
        return;
      }
      const firstNumber = j?.data?.[0]?.display_phone_number || null;
      cloudCredsStore.set(tenantId, {
        ...parsed,
        verified_at: new Date().toISOString(),
        display_name: firstNumber || parsed.business_account_id,
      });
      res.json({
        status: 'connected',
        business_account_id: parsed.business_account_id,
        phone_number: firstNumber,
        verified_at: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(502).json({ error: 'Meta API unreachable', message: err.message });
    }
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ error: 'Validation', details: err.errors });
      return;
    }
    next(err);
  }
});

whatsappRouter.get('/cloud/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const creds = cloudCredsStore.get(tenantId);
    if (!creds) { res.json({ status: 'idle' }); return; }
    res.json({
      status: 'connected',
      business_account_id: creds.business_account_id,
      phone_number: creds.display_name,
      verified_at: creds.verified_at,
    });
  } catch (err) { next(err); }
});

whatsappRouter.post('/cloud/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  cloudCredsStore.delete(tenantId);
  res.json({ status: 'idle' });
});
