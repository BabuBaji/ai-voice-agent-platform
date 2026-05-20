/**
 * Per-tenant Plivo provider — SMS + WhatsApp + OTP using the tenant's own
 * auth credentials. NEVER reads platform env vars; if the tenant has not
 * configured Plivo, callers must fall through to another provider.
 *
 * Plivo Messages API (one endpoint for SMS + WhatsApp):
 *   POST https://api.plivo.com/v1/Account/{auth_id}/Message/
 *   Body: { src, dst, type: 'sms'|'whatsapp', text, template, media_urls, url, … }
 *
 * India DLT (TRAI mandate for SMS): when dlt_entity_id is configured on the
 * tenant row, we attach it + the per-template DLT id to every SMS. Without
 * DLT registration the API call succeeds but the carrier silently drops the
 * message — surfacing this clearly in the test endpoint is the safety net.
 *
 * Delivery callbacks route to the platform's PUBLIC_BASE_URL/webhooks/plivo/*
 * — the same ngrok-exposed surface used for the voice path. The webhook
 * handler matches on message_uuid and updates communication_logs.
 */
import pino from 'pino';
import type {
  CommunicationProvider,
  EmailSendOptions,
  WhatsAppSendOptions,
  SmsSendOptions,
} from './communications.types';
import type { TenantPlivoConfig } from './tenantPlivoConfig';

const logger = pino({ name: 'plivo-tenant-provider' });
const PLIVO_API_BASE = 'https://api.plivo.com/v1';

/** Strip leading '+' and any non-digits — Plivo expects bare E.164 digits. */
function normalisePhone(raw: string): string {
  return String(raw || '').replace(/[^\d]/g, '');
}

/** Status-callback URL routes back to the public-facing telephony adapter,
 *  which owns the /webhooks/plivo/* surface so Plivo (which can only hit one
 *  domain) sees a single host for voice + SMS + WhatsApp updates. */
function statusCallback(path: string): string | undefined {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : undefined;
}

/** Map well-known Plivo error codes / messages to friendlier statuses so the
 *  UI + communication_logs.last_error explain what went wrong + what to fix. */
function mapPlivoError(status: number, body: any): string {
  const err = body?.error || body?.message || `Plivo HTTP ${status}`;
  const code = body?.api_id || body?.error_code;
  const s = String(err).toLowerCase();
  if (status === 401 || s.includes('unauthor')) {
    return 'AUTH_FAILED: Invalid Plivo auth_id or auth_token. Check Settings → Integrations → Plivo.';
  }
  if (s.includes('dlt') || s.includes('entity')) {
    return `DLT_REJECTED: India SMS rejected by carrier (DLT registration missing or template mismatch). ${err}`;
  }
  if (s.includes('source') || s.includes('src') || s.includes('sender')) {
    return `INVALID_SENDER: Configured sender is not registered with Plivo / not WhatsApp-enabled. ${err}`;
  }
  if (s.includes('destination') || s.includes('invalid number')) {
    return `INVALID_DESTINATION: Plivo rejected the recipient phone format. ${err}`;
  }
  if (s.includes('template')) {
    return `TEMPLATE_REJECTED: WhatsApp template not found / not approved by Meta. ${err}`;
  }
  return `${err}${code ? ` (code: ${code})` : ''}`;
}

export class TenantPlivoMessageProvider implements CommunicationProvider {
  name = 'plivo';
  constructor(private cfg: TenantPlivoConfig) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.cfg.auth_id}:${this.cfg.auth_token}`).toString('base64');
    return `Basic ${token}`;
  }

  private async post(body: Record<string, any>): Promise<{ ok: boolean; status: number; json: any }> {
    const url = `${PLIVO_API_BASE}/Account/${this.cfg.auth_id}/Message/`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json: any = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, json };
  }

  async sendEmail(_opts: EmailSendOptions) {
    return { ok: false, error: 'email_not_supported_by_plivo' };
  }

  async sendSms(opts: SmsSendOptions) {
    if (!this.cfg.sms_enabled) {
      return { ok: false, error: 'SMS_DISABLED: Tenant has disabled SMS in their Plivo integration.' };
    }
    if (!this.cfg.auth_token) {
      return { ok: false, error: 'PLIVO_TOKEN_MISSING: Auth token unreadable (re-save in Settings → Integrations → Plivo).' };
    }
    const src = normalisePhone(opts.from_number || this.cfg.sms_sender_id || '');
    const dst = normalisePhone(opts.recipient);
    if (!src) {
      return { ok: false, error: 'NO_SENDER_CONFIGURED: Set SMS sender on Settings → Integrations → Plivo.' };
    }
    if (!dst) {
      return { ok: false, error: 'INVALID_DESTINATION: Recipient phone could not be normalised.' };
    }
    const body: Record<string, any> = {
      src,
      dst,
      text: opts.message,
      type: 'sms',
    };
    // India DLT compliance — attach entity ID + template ID when present.
    // Plivo accepts these as top-level body params for /Message/.
    if (this.cfg.dlt_entity_id) {
      body.dlt_entity_id = this.cfg.dlt_entity_id;
      const tpl = this.resolveTemplateId(opts.template_id);
      if (tpl) body.dlt_template_id = tpl;
    }
    const cb = statusCallback('/webhooks/plivo/sms-status');
    if (cb) body.url = cb;

    const r = await this.post(body);
    if (!r.ok) {
      const mapped = mapPlivoError(r.status, r.json);
      logger.warn({ to: dst, from: src, status: r.status, err: mapped }, 'Plivo SMS send failed');
      return { ok: false, error: mapped, provider_response: r.json };
    }
    logger.info({ to: dst, from: src, uuid: r.json?.message_uuid?.[0] }, 'SMS sent via tenant Plivo');
    return { ok: true, provider_response: r.json };
  }

  async sendWhatsApp(opts: WhatsAppSendOptions) {
    if (!this.cfg.whatsapp_enabled) {
      return { ok: false, error: 'WHATSAPP_DISABLED: Tenant has disabled WhatsApp in their Plivo integration.' };
    }
    if (!this.cfg.auth_token) {
      return { ok: false, error: 'PLIVO_TOKEN_MISSING: Auth token unreadable (re-save in Settings → Integrations → Plivo).' };
    }
    const src = normalisePhone(opts.from_number || this.cfg.whatsapp_sender || '');
    const dst = normalisePhone(opts.recipient);
    if (!src) {
      return { ok: false, error: 'NO_WHATSAPP_SENDER: Set WhatsApp sender on Settings → Integrations → Plivo.' };
    }
    if (!dst) {
      return { ok: false, error: 'INVALID_DESTINATION: Recipient phone could not be normalised.' };
    }

    // Two shapes Plivo accepts on /Message/ for WhatsApp:
    //   1) Template message (required for first business-initiated message OR
    //      outside the 24h customer-service window). Caller passes opts.template_id
    //      which we look up against the tenant's dlt_template_config.templates[].
    //   2) Free-form session message (text + optional media URL) — only inside
    //      the 24h window after the recipient last messaged the business.
    const body: Record<string, any> = {
      src,
      dst,
      type: 'whatsapp',
    };

    const templateId = opts.template_id || this.cfg.dlt_template_config?.default_template_id;
    const templateMeta = templateId ? this.findTemplate(templateId) : null;

    if (templateMeta) {
      // Plivo template body shape mirrors Meta Cloud API.
      // Variables are derived from the message + first attachment URL so the
      // caller doesn't need to know the template's parameter count.
      const variables = this.deriveTemplateVariables(opts);
      body.template = {
        name: templateMeta.id,
        language: this.cfg.dlt_template_config?.whatsapp_namespace || 'en',
        components: variables.length
          ? [{ type: 'body', parameters: variables.map((text) => ({ type: 'text', text })) }]
          : undefined,
      };
    } else {
      // Free-form session message. Append attachment URLs into the body so the
      // recipient sees a clickable link even if media inline upload isn't
      // supported on this Plivo plan.
      const textWithAttachments = opts.attachments?.length
        ? `${opts.message}\n\n${opts.attachments.map((a) => `${a.name}: ${a.url}`).join('\n')}`
        : opts.message;
      body.text = textWithAttachments;
      const firstMedia = opts.attachments?.[0]?.url;
      if (firstMedia && /\.(pdf|jpe?g|png|gif|webp|mp4|mp3|wav|ogg|3gp|amr)(\?|$)/i.test(firstMedia)) {
        body.media_urls = [firstMedia];
      }
    }

    const cb = statusCallback('/webhooks/plivo/whatsapp-status');
    if (cb) body.url = cb;

    const r = await this.post(body);
    if (!r.ok) {
      const mapped = mapPlivoError(r.status, r.json);
      logger.warn({ to: dst, from: src, status: r.status, err: mapped, useTemplate: !!templateMeta }, 'Plivo WhatsApp send failed');
      return { ok: false, error: mapped, provider_response: r.json };
    }
    logger.info(
      { to: dst, from: src, uuid: r.json?.message_uuid?.[0], useTemplate: !!templateMeta },
      'WhatsApp sent via tenant Plivo',
    );
    return { ok: true, provider_response: r.json };
  }

  /** OTP convenience — same wire format as sendSms but always uses the
   *  tenant's primary OTP template if one is configured. Callers should pass
   *  the generated code in opts.message (we don't generate codes here). */
  async sendOtp(opts: SmsSendOptions & { code?: string }) {
    if (opts.code && !opts.message) {
      opts = { ...opts, message: `Your verification code is ${opts.code}. Valid for 5 minutes. Do not share.` };
    }
    return this.sendSms(opts);
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private resolveTemplateId(callerTemplateId: string | null | undefined): string | null {
    if (!callerTemplateId) return this.cfg.dlt_template_config?.default_template_id || null;
    const meta = this.findTemplate(callerTemplateId);
    return meta?.dlt_id || meta?.id || callerTemplateId;
  }

  private findTemplate(id: string) {
    const list = this.cfg.dlt_template_config?.templates || [];
    return list.find((t) => t.id === id) || null;
  }

  /** Lift any obvious template variables from the message + attachments.
   *  Templates are positional — most ones in our flows are 1–2 params
   *  (recipient name + brochure URL). The first {name} comes from a leading
   *  "Hi <Name>," and the second is the first attachment URL. */
  private deriveTemplateVariables(opts: WhatsAppSendOptions): string[] {
    const greetingMatch = opts.message.match(/^(?:Hi|Hello|Hey|Namaste)\s+([^,!\n]+)/i);
    const name = greetingMatch ? greetingMatch[1].trim() : '';
    const firstUrl = opts.attachments?.[0]?.url || '';
    const vars: string[] = [];
    if (name) vars.push(name);
    if (firstUrl) vars.push(firstUrl);
    return vars;
  }
}
