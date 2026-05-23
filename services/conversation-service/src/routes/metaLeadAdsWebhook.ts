/**
 * Meta Lead Ads webhook receiver.
 *
 * Flow:
 *   1. Meta delivers a `leadgen` event to /webhooks/meta/leadads when a user
 *      submits a Lead Ad form. The event carries only a `leadgen_id`, not
 *      the field values.
 *   2. We GET https://graph.facebook.com/{ver}/{leadgen_id}?access_token=...
 *      to fetch the full field map (name, phone, email, custom answers).
 *   3. We POST the lead into crm-service-node /leads with source='meta_ads'.
 *      That insert fires the workflow engine which sends the lead_created
 *      template + side-effects — same path as any other lead source.
 *
 * Mapping the form: Meta Lead Ads forms allow arbitrary fields. We extract
 * a best-effort first_name/last_name/email/phone and stash everything else
 * into custom_fields.meta_form_responses for later analysis.
 *
 * Tenant resolution: Meta delivers webhooks at the APP level, not the WABA
 * level — there's no native tenant header. We use the `page_id` in the
 * event to look up the tenant via `tenant_meta_pages` (NOT BUILT YET — for
 * now, all Lead Ads land on the env-default DEFAULT_TENANT_ID until the
 * mapping table is built).
 *
 * Security: same x-hub-signature-256 HMAC verify as the WhatsApp webhook,
 * using META_WA_APP_SECRET. Meta uses the SAME app secret across all
 * subscriptions on a given app.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pino from 'pino';

const logger = pino({ name: 'meta-leadads-webhook' });
export const metaLeadAdsWebhookRouter = Router();

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:8081';

/** GET — verification handshake. Reuses the same verify token as WhatsApp;
 *  Meta will hit this when you subscribe leadgen on the app. */
metaLeadAdsWebhookRouter.get('/webhooks/meta/leadads', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WA_VERIFY_TOKEN;
  if (!expected) {
    logger.error('META_WA_VERIFY_TOKEN not configured');
    return res.status(500).send('verify_token_not_configured');
  }
  if (mode === 'subscribe' && token === expected && typeof challenge === 'string') {
    logger.info('Meta Lead Ads webhook verified');
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.sendStatus(403);
});

metaLeadAdsWebhookRouter.post('/webhooks/meta/leadads', async (req: Request, res: Response) => {
  // HMAC verify — same shape as WhatsApp webhook.
  const sig = req.header('x-hub-signature-256');
  const secret = process.env.META_WA_APP_SECRET;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (secret) {
    if (!sig || !rawBody) return res.sendStatus(403);
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.sendStatus(403);
    }
  } else {
    logger.warn('META_WA_APP_SECRET not set — accepting Lead Ads POST without HMAC');
  }

  // ACK fast — Meta retries on non-2xx.
  res.sendStatus(200);

  try {
    await processLeadAdsEvent(req.body);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Lead Ads processing error');
  }
});

async function processLeadAdsEvent(body: any): Promise<void> {
  if (body?.object !== 'page') {
    logger.debug({ object: body?.object }, 'Ignoring non-page event');
    return;
  }
  for (const entry of body.entry || []) {
    const pageId = entry?.id as string | undefined;
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const value = change.value || {};
      const leadgenId = value?.leadgen_id as string | undefined;
      const formId = value?.form_id as string | undefined;
      if (!leadgenId) {
        logger.warn({ pageId }, 'leadgen event missing leadgen_id');
        continue;
      }
      await handleOneLeadgen(leadgenId, formId, pageId).catch((err) =>
        logger.warn({ leadgenId, err: err?.message }, 'handleOneLeadgen failed'),
      );
    }
  }
}

async function handleOneLeadgen(leadgenId: string, formId: string | undefined, pageId: string | undefined): Promise<void> {
  // Resolve tenant + access token. Until a tenant_meta_pages mapping table
  // exists, default to env DEFAULT_TENANT_ID + env Meta token. Production
  // setup would lookup (pageId → tenant_id, token).
  const tenantId = process.env.DEFAULT_TENANT_ID;
  const token = process.env.META_WA_ACCESS_TOKEN;
  if (!tenantId || !token) {
    logger.warn({ leadgenId, pageId }, 'Lead Ads skipped — DEFAULT_TENANT_ID or META_WA_ACCESS_TOKEN missing');
    return;
  }

  const ver = process.env.META_WA_GRAPH_VERSION || 'v22.0';
  const url = `https://graph.facebook.com/${ver}/${leadgenId}?access_token=${token}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    logger.warn({ leadgenId, status: resp.status, err: errText.slice(0, 200) }, 'Lead Ads fetch failed');
    return;
  }
  const lead = await resp.json();
  const { first_name, last_name, email, phone, fullForm } = extractFields(lead.field_data || []);

  const crmBody = {
    first_name: first_name || 'Unknown',
    last_name: last_name || 'Lead',
    email: email || null,
    phone: phone || null,
    source: 'meta_ads',
    status: 'NEW',
    custom_fields: {
      meta_leadgen_id: leadgenId,
      meta_form_id: formId,
      meta_page_id: pageId,
      meta_form_responses: fullForm,
    },
  };

  // Fire-and-forget into crm-service-node — that endpoint's own hook will
  // re-emit lead_created into the workflow engine. We don't need to call
  // the workflow engine ourselves here.
  const crmResp = await fetch(`${CRM_SERVICE_URL}/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(crmBody),
  });
  if (!crmResp.ok) {
    const text = await crmResp.text().catch(() => '');
    logger.warn({ leadgenId, status: crmResp.status, err: text.slice(0, 200) }, 'crm insert failed');
    return;
  }
  const created = await crmResp.json().catch(() => ({}));
  logger.info({ leadgenId, leadId: created.id, phone }, 'Lead Ads → CRM lead created');
}

interface ExtractedFields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  fullForm: Record<string, any>;
}

/** Meta returns field_data as [{name, values: [string]}]. The user-defined
 *  field names depend on how the form was built ("Full name", "Email",
 *  "Phone number", "अपना नाम", ...). We do best-effort matching against
 *  common patterns and stash the original payload for audit. */
function extractFields(fieldData: any[]): ExtractedFields {
  const out: ExtractedFields = { first_name: '', last_name: '', email: '', phone: '', fullForm: {} };
  for (const f of fieldData) {
    const name = String(f?.name || '').toLowerCase();
    const value = Array.isArray(f?.values) ? f.values[0] : '';
    out.fullForm[f?.name || 'unknown'] = value;
    if (!out.email && /email/.test(name)) out.email = value;
    else if (!out.phone && /(phone|mobile|whatsapp|nombre.*telef)/i.test(name)) out.phone = value;
    else if (!out.first_name && /(first[_ ]?name|first|prénom|nombre)/i.test(name)) out.first_name = value;
    else if (!out.last_name && /(last[_ ]?name|surname|family|apellido)/i.test(name)) out.last_name = value;
    else if (!out.first_name && !out.last_name && /(full[_ ]?name|name|naam|nombre completo)/i.test(name)) {
      // Split "Alice Smith" → first / last (best-effort).
      const parts = String(value || '').trim().split(/\s+/);
      out.first_name = parts[0] || '';
      out.last_name = parts.slice(1).join(' ') || '';
    }
  }
  return out;
}
