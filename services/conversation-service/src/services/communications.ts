import { pool } from '../index';
import pino from 'pino';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadTenantWhatsAppConfig } from './tenantWhatsappConfig';
import { loadTenantPlivoConfig } from './tenantPlivoConfig';
import { TenantPlivoMessageProvider } from './plivoTenantProvider';
import type {
  CommunicationProvider as CommunicationProviderT,
  EmailSendOptions as EmailSendOptionsT,
  WhatsAppSendOptions as WhatsAppSendOptionsT,
  SmsSendOptions as SmsSendOptionsT,
} from './communications.types';

// Re-export the canonical types so downstream callers can pick them up from
// this module (back-compat) OR from communications.types.ts (provider files).
export type EmailSendOptions = EmailSendOptionsT;
export type WhatsAppSendOptions = WhatsAppSendOptionsT;
export type SmsSendOptions = SmsSendOptionsT;
export type CommunicationProvider = CommunicationProviderT;

const logger = pino({ name: 'communications' });

/**
 * Generic communication-provider interface.
 *
 * Each concrete provider (SMTP for email, Twilio WhatsApp / Meta Cloud /
 * Gupshup for WhatsApp) implements sendEmail / sendWhatsApp and writes to
 * `communication_logs`. This abstraction lets the post-call processor fire
 * a "send brochure email" / "send WhatsApp details" action without knowing
 * which provider is configured — the StubProvider logs the attempt so the
 * dashboard surfaces it even when no real provider is wired up yet.
 *
 * To plug in a real provider, implement the interface in its own file
 * (e.g. `smtpEmailProvider.ts`, `whatsappCloudProvider.ts`) and call its
 * methods from this module's `sendEmail`/`sendWhatsApp` entry points.
 */
// EmailSendOptions / WhatsAppSendOptions / SmsSendOptions are defined in
// ./communications.types.ts and re-exported above. Importing here would
// create a circular reference because plivoTenantProvider.ts imports the
// types file directly.

/**
 * Look up the agent's caller-ID for this recipient. For outbound calls,
 * `conversations.caller_number` is the business / agent number that dialed
 * out — that's the identity callers know, so brochure sends should use it
 * for SMS/WhatsApp continuity. Returns null when there's no prior call to
 * this recipient (fresh lead in CRM with no campaign run yet).
 */
export async function getAgentNumberForRecipient(
  tenantId: string,
  recipient: string,
): Promise<string | null> {
  const digits = recipient.replace(/\D/g, '');
  if (!digits) return null;
  try {
    const r = await pool.query(
      `SELECT caller_number FROM conversations
        WHERE tenant_id = $1
          AND regexp_replace(COALESCE(called_number, ''), '\\D', '', 'g') = $2
          AND caller_number IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, digits],
    );
    const raw = r.rows[0]?.caller_number || null;
    if (!raw) return null;
    return raw.startsWith('+') ? raw : `+${raw}`;
  } catch {
    return null;
  }
}

// CommunicationProvider interface lives in ./communications.types.ts and is
// re-exported at the top of this file.

/**
 * StubProvider — logs the attempted send to `communication_logs` and
 * returns ok=false with `not_configured`. This is the default when no
 * concrete SMTP / WhatsApp provider is wired in, so the dashboard shows
 * "WhatsApp queued (provider not configured)" instead of silently dropping
 * the send. Swap out by setting EMAIL_PROVIDER / WHATSAPP_PROVIDER env vars
 * and implementing the corresponding concrete class.
 */
class StubProvider implements CommunicationProvider {
  name = 'stub';
  async sendEmail(opts: EmailSendOptions) {
    return { ok: false, error: 'email_provider_not_configured' };
  }
  async sendWhatsApp(opts: WhatsAppSendOptions) {
    return { ok: false, error: 'whatsapp_provider_not_configured' };
  }
}

/**
 * SmtpEmailProvider — sends mail through any SMTP relay (Gmail App Password,
 * SES-SMTP, Mailgun-SMTP, Office365). Reads SMTP_HOST/PORT/SECURE/USER/PASS
 * from env. Brochure URLs in `attachments` are rendered as HTML links rather
 * than downloaded — most teams already host the PDF on a CDN.
 */
class SmtpEmailProvider implements CommunicationProvider {
  name = 'smtp';
  private transport: Transporter;
  private fromEmail: string;
  private fromName: string;

  constructor(host: string, port: number, secure: boolean, user: string, pass: string,
              fromEmail: string, fromName: string) {
    this.transport = nodemailer.createTransport({
      host, port, secure, auth: { user, pass },
    });
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  async sendEmail(opts: EmailSendOptions) {
    const from = this.fromName ? `"${this.fromName}" <${this.fromEmail}>` : this.fromEmail;
    const linksHtml = (opts.attachments || []).length
      ? `<p style="margin-top:16px;font-size:13px;color:#555">Attachments:</p><ul>${
          (opts.attachments || []).map(a => `<li><a href="${a.url}">${a.name}</a></li>`).join('')
        }</ul>`
      : '';
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.55;">${
      opts.body.replace(/\n/g, '<br/>')
    }${linksHtml}</div>`;
    try {
      const info = await this.transport.sendMail({
        from,
        to: opts.recipient,
        subject: opts.subject,
        text: opts.body + (opts.attachments?.length
          ? `\n\nAttachments:\n${opts.attachments.map(a => `- ${a.name}: ${a.url}`).join('\n')}`
          : ''),
        html,
      });
      logger.info({ to: opts.recipient, messageId: info.messageId }, 'brochure email sent via SMTP');
      return { ok: true, provider_response: { messageId: info.messageId, response: info.response } };
    } catch (err: any) {
      logger.error({ to: opts.recipient, err: err?.message }, 'SMTP send failed');
      return { ok: false, error: err?.message || 'smtp_send_failed' };
    }
  }

  async sendWhatsApp(_opts: WhatsAppSendOptions) {
    return { ok: false, error: 'whatsapp_not_supported_by_smtp_provider' };
  }
}

/**
 * TwilioMessageProvider — sends WhatsApp + SMS via Twilio's REST API. Uses the
 * Twilio Account SID + Auth Token + a `from` phone number. WhatsApp uses
 * Twilio's sandbox sender by default (`whatsapp:+14155238886`) unless
 * TWILIO_WHATSAPP_FROM overrides; SMS uses TWILIO_PHONE_NUMBER. We post via
 * `fetch` (urlencoded) to avoid pulling the Twilio SDK into this service —
 * keeps the runtime additive and the dependency surface small.
 */
class TwilioMessageProvider implements CommunicationProvider {
  name = 'twilio';
  constructor(
    private accountSid: string,
    private authToken: string,
    private smsFrom: string,
    private whatsappFrom: string,
  ) {}

  private async post(form: Record<string, string>) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const body = new URLSearchParams(form).toString();
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: json?.message || `Twilio HTTP ${resp.status}`, provider_response: json };
    }
    return { ok: true, provider_response: { sid: json.sid, status: json.status } };
  }

  async sendEmail(_opts: EmailSendOptions) {
    return { ok: false, error: 'email_not_supported_by_twilio_message_provider' };
  }

  async sendWhatsApp(opts: WhatsAppSendOptions) {
    const SANDBOX_SENDER = '+14155238886';
    const mode = (process.env.WHATSAPP_MODE || 'sandbox').toLowerCase();
    const productionFromRaw = (process.env.TWILIO_WHATSAPP_FROM || '').replace(/^whatsapp:/, '');
    const productionReady = productionFromRaw && productionFromRaw !== SANDBOX_SENDER;

    // Production mode REQUIRES an approved WhatsApp Business sender. Reject
    // early with a clear status so the auto-flow doesn't burn API calls only
    // to get 63015 / 63016 from Twilio. Sandbox cannot deliver to unjoined
    // numbers — that's Meta policy, not Twilio's.
    if (mode === 'production' && !productionReady) {
      return {
        ok: false,
        error: 'WHATSAPP_PRODUCTION_NOT_READY: TWILIO_WHATSAPP_FROM must point to an approved WhatsApp Business sender (not the sandbox). Until then, sandbox-joined numbers only.',
      };
    }

    const to = opts.recipient.startsWith('whatsapp:') ? opts.recipient : `whatsapp:${opts.recipient}`;
    // From: production sender if configured + production mode; otherwise the
    // env default (which is the Twilio sandbox unless overridden).
    const fromRaw = productionReady ? productionFromRaw : this.whatsappFrom.replace(/^whatsapp:/, '');
    const from = `whatsapp:${fromRaw}`;

    const templateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID || '';
    const useTemplate = mode === 'production' && !!templateSid;

    const body = opts.message + (opts.attachments?.length
      ? `\n\n${opts.attachments.map(a => `${a.name}: ${a.url}`).join('\n')}`
      : '');
    const form: Record<string, string> = { To: to, From: from };
    if (useTemplate) {
      // Twilio Content API template send — required for the FIRST business-
      // initiated message to any recipient. Variables are positional ({{1}},
      // {{2}}, …) — we feed in name + brochure URL by default. Customize
      // template content + variable count at console.twilio.com/Content.
      form.ContentSid = templateSid;
      const variables: Record<string, string> = {};
      const name = (opts.message.match(/^Hi\s+([^,]+),/i)?.[1] || 'there').trim();
      const url = opts.attachments?.[0]?.url || '';
      variables['1'] = name;
      if (url) variables['2'] = url;
      form.ContentVariables = JSON.stringify(variables);
    } else {
      // Free-form message (allowed inside the 24h customer-service window or
      // in sandbox mode for joined recipients).
      form.Body = body;
      const firstUrl = opts.attachments?.[0]?.url || '';
      if (firstUrl && /\.(pdf|jpe?g|png|gif|webp|mp4|mp3|wav|ogg|3gp|amr)(\?|$)/i.test(firstUrl)) {
        form.MediaUrl = firstUrl;
      }
    }

    const r = await this.post(form);
    if (r.ok) {
      logger.info({ to: opts.recipient, from, mode, template: useTemplate ? templateSid : null, sid: r.provider_response?.sid }, 'WhatsApp sent via Twilio');
      return r;
    }
    // Map well-known Twilio failure codes to friendly statuses so the UI
    // and communication_logs surface what actually went wrong + what to do.
    const errCode = r.provider_response?.code;
    let mapped = r.error;
    if (errCode === 63015) {
      mapped = 'SANDBOX_RECIPIENT_NOT_JOINED: Receiver has not joined Twilio sandbox. Use production WhatsApp sender for direct delivery.';
    } else if (errCode === 63016) {
      mapped = 'TEMPLATE_REQUIRED: First message to this recipient (or outside 24h window) must use an approved Meta template. Set TWILIO_WHATSAPP_TEMPLATE_SID.';
    } else if (errCode === 63007) {
      mapped = 'CHANNEL_NOT_FOUND: The From address is not a WhatsApp-enabled Twilio channel. Verify TWILIO_WHATSAPP_FROM.';
    } else if (errCode === 21211) {
      mapped = 'INVALID_WHATSAPP_NUMBER: The recipient number failed Twilio validation.';
    } else if (errCode === 63018) {
      mapped = 'TEMPLATE_NOT_APPROVED: The Content template has not been approved by Meta yet.';
    }
    logger.warn({ to: opts.recipient, from, mode, code: errCode, err: mapped }, 'Twilio WhatsApp send failed');
    return { ok: false, error: mapped, provider_response: r.provider_response };
  }

  async sendSms(opts: SmsSendOptions) {
    const from = opts.from_number || this.smsFrom;
    const r = await this.post({ To: opts.recipient, From: from, Body: opts.message });
    if (r.ok) {
      logger.info({ to: opts.recipient, from, sid: r.provider_response?.sid }, 'SMS sent via Twilio');
      return r;
    }
    // Map well-known Twilio SMS failure codes so logs + UI show what to do.
    const errCode = r.provider_response?.code;
    let mapped = r.error;
    if (errCode === 21608) {
      mapped = 'TRIAL_DESTINATION_UNVERIFIED: Twilio account is on Trial — verify recipient at twilio.com/console/phone-numbers/verified, or upgrade to a paid account.';
    } else if (errCode === 21211) {
      mapped = 'INVALID_DESTINATION: Twilio rejected the recipient phone format.';
    } else if (errCode === 21610) {
      mapped = 'RECIPIENT_OPTED_OUT: This recipient previously replied STOP. Have them text START to re-subscribe.';
    } else if (errCode === 21612) {
      mapped = 'UNREACHABLE: Twilio cannot reach this carrier (often: invalid country code or landline).';
    }
    logger.warn({ to: opts.recipient, from, code: errCode, err: mapped }, 'Twilio SMS send failed');
    return { ok: false, error: mapped, provider_response: r.provider_response };
  }
}

/**
 * PlivoMessageProvider — SMS via Plivo. Used for Indian numbers (+91) where
 * the same Plivo phone number that placed the voice call should also be the
 * SMS sender, so callers see one consistent identity. Note: Plivo SMS to
 * Indian destinations requires DLT registration (TRAI mandate). Without DLT
 * the API call succeeds but the message never delivers. The error surfaced
 * from Plivo's API is logged so the team can chase DLT approval.
 */
class PlivoMessageProvider implements CommunicationProvider {
  name = 'plivo';
  constructor(
    private authId: string,
    private authToken: string,
    private defaultFrom: string,
  ) {}

  async sendEmail(_opts: EmailSendOptions) {
    return { ok: false, error: 'email_not_supported_by_plivo' };
  }

  async sendWhatsApp(_opts: WhatsAppSendOptions) {
    return { ok: false, error: 'whatsapp_not_supported_by_plivo' };
  }

  async sendSms(opts: SmsSendOptions) {
    const url = `https://api.plivo.com/v1/Account/${this.authId}/Message/`;
    const auth = Buffer.from(`${this.authId}:${this.authToken}`).toString('base64');
    const src = (opts.from_number || this.defaultFrom).replace(/^\+/, '');
    const dst = opts.recipient.replace(/^\+/, '');
    // Plivo callback for delivery-status updates. Routes back to the telephony
    // adapter (which is the service ngrok exposes) — that writes the real
    // delivered/failed state into communication_logs.
    const callback = process.env.PUBLIC_BASE_URL
      ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/webhooks/plivo/sms-status`
      : undefined;
    const body: Record<string, any> = { src, dst, text: opts.message, type: 'sms' };
    if (callback) body.url = callback;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn({ to: opts.recipient, from: src, status: resp.status, err: json?.error || json?.message }, 'Plivo SMS send failed');
      return { ok: false, error: json?.error || json?.message || `Plivo HTTP ${resp.status}`, provider_response: json };
    }
    logger.info({ to: opts.recipient, from: src, uuid: json?.message_uuid?.[0], callback: !!callback }, 'SMS sent via Plivo');
    return { ok: true, provider_response: json };
  }
}

function buildEmailProvider(): CommunicationProvider {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    logger.warn('SMTP_HOST/SMTP_USER/SMTP_PASS not set — falling back to stub email provider');
    return new StubProvider();
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || 'VoiceAgent AI';
  logger.info({ host, port, user }, 'SMTP email provider initialized');
  return new SmtpEmailProvider(host, port, secure, user, pass, fromEmail, fromName);
}

function buildTwilioProvider(): CommunicationProvider | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const smsFrom = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !tok || !smsFrom) {
    logger.warn('TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER not all set — WhatsApp+SMS via Twilio disabled');
    return null;
  }
  // Twilio's free WhatsApp sandbox sender — `+14155238886` is the well-known
  // sandbox number every Twilio account can use after the *recipient* sends
  // the join code to it from their WhatsApp. The voice/SMS number is almost
  // never WhatsApp-enabled, so defaulting to that triggers
  // "Twilio could not find a Channel with the specified From address".
  // Set TWILIO_WHATSAPP_FROM in .env once you have a production WhatsApp sender.
  const waFrom = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';
  logger.info({ sid: sid.slice(0, 8) + '…', smsFrom, waFrom }, 'Twilio message provider initialized');
  return new TwilioMessageProvider(sid, tok, smsFrom, waFrom);
}

function buildPlivoProvider(): CommunicationProvider | null {
  const id = process.env.PLIVO_AUTH_ID;
  const tok = process.env.PLIVO_AUTH_TOKEN;
  const from = process.env.PLIVO_PHONE_NUMBER;
  if (!id || !tok || !from) {
    logger.warn('PLIVO_AUTH_ID/AUTH_TOKEN/PHONE_NUMBER not all set — Plivo SMS disabled');
    return null;
  }
  logger.info({ authId: id.slice(0, 6) + '…', from }, 'Plivo message provider initialized');
  return new PlivoMessageProvider(id, tok, from);
}

const emailProvider: CommunicationProvider = buildEmailProvider();
const twilioProvider: CommunicationProvider | null = buildTwilioProvider();
const plivoProvider: CommunicationProvider | null = buildPlivoProvider();

/**
 * Pick the SMS provider. Twilio is the default for everything because it
 * delivers internationally without DLT pre-registration. Set
 * SMS_PROVIDER=plivo in .env once Plivo DLT registration is approved to
 * route Indian destinations through Plivo for lower cost. Falls back to
 * whichever provider is configured.
 */
function pickSmsProvider(_fromNumber?: string | null, _toNumber?: string | null): CommunicationProvider {
  const pref = (process.env.SMS_PROVIDER || '').toLowerCase();
  if (pref === 'plivo' && plivoProvider) return plivoProvider;
  if (pref === 'twilio' && twilioProvider) return twilioProvider;
  if (twilioProvider) return twilioProvider;
  if (plivoProvider) return plivoProvider;
  return new StubProvider();
}

/**
 * Per-tenant SMS resolver. Mirrors pickWhatsAppProviderForTenant: when the
 * tenant has Plivo configured (sms_enabled=true, readable token), route their
 * SMS through a TenantPlivoMessageProvider so the sender ID + DLT compliance
 * comes from THEIR account. Otherwise fall through to the env-default
 * pickSmsProvider() (Twilio/Plivo platform creds, today's behavior).
 *
 * Returns the picked provider PLUS an optional sender override taken from
 * the tenant's configured sms_sender_id so the SMS caller-ID matches what
 * they registered with the carrier (important for DLT-registered headers).
 */
async function pickSmsProviderForTenant(tenantId: string): Promise<{
  provider: CommunicationProvider;
  fromOverride: string | null;
  source: 'tenant_plivo' | 'env_default';
}> {
  const plivoCfg = await loadTenantPlivoConfig(tenantId);
  if (plivoCfg && plivoCfg.status === 'active' && plivoCfg.sms_enabled && plivoCfg.auth_token) {
    return {
      provider: new TenantPlivoMessageProvider(plivoCfg),
      fromOverride: plivoCfg.sms_sender_id,
      source: 'tenant_plivo',
    };
  }
  return { provider: pickSmsProvider(), fromOverride: null, source: 'env_default' };
}

/** WhatsApp always routes through Twilio today (Plivo has no WhatsApp API on this account). */
const whatsappProvider: CommunicationProvider = twilioProvider || new StubProvider();

/**
 * Send a brochure / admission-details email. Records the attempt in
 * `communication_logs` regardless of success so the lead-detail page
 * always shows what's been tried.
 */
export async function sendEmail(opts: EmailSendOptions): Promise<{ ok: boolean; log_id: string | null; error?: string }> {
  let logId: string | null = null;
  try {
    const r = await pool.query(
      `INSERT INTO communication_logs
         (tenant_id, lead_id, conversation_id, channel, provider, recipient,
          subject, message, template_id, attachments, status)
       VALUES ($1, $2::uuid, $3::uuid, 'email', $4, $5, $6, $7, $8, $9::jsonb, 'queued')
       RETURNING id`,
      [
        opts.tenant_id, opts.lead_id || null, opts.conversation_id || null,
        emailProvider.name, opts.recipient, opts.subject, opts.body,
        opts.template_id || null, JSON.stringify(opts.attachments || []),
      ],
    );
    logId = r.rows[0].id;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'sendEmail: failed to enqueue log row');
  }

  const result = await emailProvider.sendEmail(opts);
  // Update the log row with the outcome.
  if (logId) {
    try {
      await pool.query(
        `UPDATE communication_logs
         SET status = $1::text, provider_response = $2::jsonb, last_error = $3,
             sent_at = CASE WHEN $1::text = 'sent' THEN NOW() ELSE sent_at END
         WHERE id = $4`,
        [
          result.ok ? 'sent' : 'failed',
          JSON.stringify(result.provider_response || {}),
          result.ok ? null : (result.error || 'unknown'),
          logId,
        ],
      );
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'sendEmail: failed to update log row');
    }
  }
  return { ok: result.ok, log_id: logId, error: result.ok ? undefined : (result as any).error };
}

/**
 * Resolve which WhatsApp provider handles this tenant's send. The order is:
 *  1) tenant_plivo_integrations row with whatsapp_enabled=true + readable token
 *     → instantiate TenantPlivoMessageProvider bound to those creds (preferred
 *     when tenant has configured Plivo, since one Plivo account covers SMS too)
 *  2) tenant_whatsapp_integrations row with provider=twilio + valid creds
 *     → instantiate a one-off TwilioMessageProvider bound to those creds
 *  3) tenant_whatsapp_integrations row with another provider (meta/gupshup/wati/interakt)
 *     → return a Stub adapter that errors with TODO_NOT_IMPLEMENTED
 *  4) no tenant config → fall back to the global env-configured Twilio (current
 *     behavior, preserves backwards compat)
 *
 * NOTE — credentials are NEVER logged. The instantiated provider holds them
 * in closure; once the function returns the GC reclaims them.
 */
async function pickWhatsAppProviderForTenant(tenantId: string): Promise<{
  provider: CommunicationProvider;
  modeOverride?: 'sandbox' | 'production';
  whatsAppFromOverride?: string | null;
  templateOverride?: string | null;
  source: 'tenant_plivo' | 'tenant_twilio' | 'tenant_other' | 'env_default';
}> {
  // Plivo takes priority — when a tenant has configured Plivo with WhatsApp
  // enabled and a sender, route through it. Twilio remains the fallback for
  // tenants on the legacy integration, AND for tenants who have Plivo but
  // explicitly disabled WhatsApp.
  const plivoCfg = await loadTenantPlivoConfig(tenantId);
  if (plivoCfg && plivoCfg.status === 'active' && plivoCfg.whatsapp_enabled && plivoCfg.auth_token) {
    return {
      provider: new TenantPlivoMessageProvider(plivoCfg),
      whatsAppFromOverride: plivoCfg.whatsapp_sender,
      templateOverride: plivoCfg.dlt_template_config?.default_template_id || null,
      source: 'tenant_plivo',
    };
  }

  const cfg = await loadTenantWhatsAppConfig(tenantId);
  if (!cfg || cfg.status === 'disabled') {
    return { provider: whatsappProvider, source: 'env_default' };
  }
  if (cfg.provider === 'twilio') {
    const c = cfg.credentials as { account_sid?: string; auth_token?: string };
    if (c.account_sid && c.auth_token) {
      const smsFrom = process.env.TWILIO_PHONE_NUMBER || ''; // not used for WA but required by ctor
      const waFrom = (cfg.whatsapp_from || cfg.sender_number || '+14155238886').replace(/^whatsapp:/, '');
      const tenantTwilio = new TwilioMessageProvider(c.account_sid, c.auth_token, smsFrom, waFrom);
      return {
        provider: tenantTwilio,
        modeOverride: cfg.mode,
        whatsAppFromOverride: waFrom,
        templateOverride: cfg.template_config?.default_template_sid || null,
        source: 'tenant_twilio',
      };
    }
  }
  // Other providers — adapters not yet implemented. Return a stub that
  // explains itself; never silently fall back to the env Twilio because
  // that'd mean another tenant's sender placed the call.
  return {
    provider: {
      name: cfg.provider,
      sendEmail: async () => ({ ok: false, error: 'not_supported' }),
      sendWhatsApp: async () => ({
        ok: false,
        error: `TODO_NOT_IMPLEMENTED: WhatsApp adapter for provider '${cfg.provider}' is not yet built. Use Twilio for now, or switch this tenant's provider.`,
      }),
    } as CommunicationProvider,
    modeOverride: cfg.mode,
    source: 'tenant_other',
  };
}

/** Same shape as sendEmail but for WhatsApp. */
export async function sendWhatsApp(opts: WhatsAppSendOptions): Promise<{ ok: boolean; log_id: string | null; error?: string }> {
  // Per-tenant WhatsApp resolution (Multi-tenant Phase 1). When the tenant
  // has their own integration configured, send goes through THEIR Twilio
  // account; otherwise we fall back to the platform-default env Twilio.
  const picked = await pickWhatsAppProviderForTenant(opts.tenant_id);

  // Inject the agent caller-ID so the WhatsApp message comes from the same
  // number that placed the voice call (only takes effect if Twilio has that
  // number enabled for WhatsApp Business — otherwise Twilio surfaces an
  // error and we fall back to the sandbox sender).
  let from = opts.from_number || picked.whatsAppFromOverride || null;
  if (!from) from = await getAgentNumberForRecipient(opts.tenant_id, opts.recipient);
  const effective: WhatsAppSendOptions = { ...opts, from_number: from };
  // The tenant's TWILIO_WHATSAPP_TEMPLATE_SID equivalent comes from their
  // template_config.default_template_sid. We pass it via env-style override
  // through a local mutation of process.env scoped to this call. NOTE: this
  // is single-threaded Node — there's no race risk between concurrent sends
  // as long as the override is restored synchronously after send returns.
  const origMode = process.env.WHATSAPP_MODE;
  const origTpl = process.env.TWILIO_WHATSAPP_TEMPLATE_SID;
  const origFrom = process.env.TWILIO_WHATSAPP_FROM;
  if (picked.source === 'tenant_twilio') {
    if (picked.modeOverride) process.env.WHATSAPP_MODE = picked.modeOverride;
    if (picked.templateOverride) process.env.TWILIO_WHATSAPP_TEMPLATE_SID = picked.templateOverride;
    if (picked.whatsAppFromOverride) process.env.TWILIO_WHATSAPP_FROM = picked.whatsAppFromOverride;
  }
  try {
    return await sendWhatsAppWithProvider(opts, effective, picked.provider);
  } finally {
    // Restore env so the global twilioProvider (used by tenants without
    // their own config) keeps its original platform behavior.
    process.env.WHATSAPP_MODE = origMode;
    process.env.TWILIO_WHATSAPP_TEMPLATE_SID = origTpl;
    process.env.TWILIO_WHATSAPP_FROM = origFrom;
  }
}

async function sendWhatsAppWithProvider(
  opts: WhatsAppSendOptions, effective: WhatsAppSendOptions, provider: CommunicationProvider,
): Promise<{ ok: boolean; log_id: string | null; error?: string }> {

  let logId: string | null = null;
  try {
    const r = await pool.query(
      `INSERT INTO communication_logs
         (tenant_id, lead_id, conversation_id, channel, provider, recipient,
          message, template_id, attachments, status)
       VALUES ($1, $2::uuid, $3::uuid, 'whatsapp', $4, $5, $6, $7, $8::jsonb, 'queued')
       RETURNING id`,
      [
        opts.tenant_id, opts.lead_id || null, opts.conversation_id || null,
        provider.name, opts.recipient, opts.message,
        opts.template_id || null, JSON.stringify(opts.attachments || []),
      ],
    );
    logId = r.rows[0].id;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'sendWhatsApp: failed to enqueue log row');
  }

  const result = await provider.sendWhatsApp(effective);
  if (logId) {
    try {
      await pool.query(
        `UPDATE communication_logs
         SET status = $1::text, provider_response = $2::jsonb, last_error = $3,
             sent_at = CASE WHEN $1::text = 'sent' THEN NOW() ELSE sent_at END
         WHERE id = $4`,
        [
          result.ok ? 'sent' : 'failed',
          JSON.stringify(result.provider_response || {}),
          result.ok ? null : (result.error || 'unknown'),
          logId,
        ],
      );
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'sendWhatsApp: failed to update log row');
    }
  }
  return { ok: result.ok, log_id: logId, error: result.ok ? undefined : (result as any).error };
}

/** Same shape as sendWhatsApp but for SMS. */
export async function sendSms(opts: SmsSendOptions): Promise<{ ok: boolean; log_id: string | null; error?: string }> {
  // Per-tenant SMS resolution. When the tenant has Plivo configured the
  // returned provider is THEIR TenantPlivoMessageProvider (own auth + DLT
  // entity); otherwise pickSmsProviderForTenant falls through to the env-
  // configured platform provider (Twilio/Plivo) so legacy tenants are intact.
  const picked = await pickSmsProviderForTenant(opts.tenant_id);
  const provider = picked.provider;

  // Sender resolution order:
  //   1) explicit opts.from_number (caller's choice — campaign-set override)
  //   2) tenant-configured sms_sender_id (DLT-registered header, etc.)
  //   3) most-recent agent caller-ID for this recipient (continuity with the
  //      voice call so the SMS lands from the same identity)
  //   4) provider-level env default (Twilio/Plivo platform numbers)
  let from = opts.from_number || picked.fromOverride || null;
  if (!from) from = await getAgentNumberForRecipient(opts.tenant_id, opts.recipient);
  if (!from && provider.name === 'plivo' && picked.source === 'env_default') from = process.env.PLIVO_PHONE_NUMBER || null;
  if (!from && provider.name === 'twilio') from = process.env.TWILIO_PHONE_NUMBER || null;
  // For platform Twilio, ignore Indian agent caller-IDs (e.g. Plivo's +91 voice
  // number) because Twilio won't recognise them as a Twilio-owned sender.
  // Tenant Plivo sends are fine — they own their +91 sender.
  if (provider.name === 'twilio' && from && from.replace(/\D/g, '').startsWith('91')) {
    from = process.env.TWILIO_PHONE_NUMBER || from;
  }
  const effective: SmsSendOptions = { ...opts, from_number: from };

  let logId: string | null = null;
  try {
    const r = await pool.query(
      `INSERT INTO communication_logs
         (tenant_id, lead_id, conversation_id, channel, provider, recipient,
          message, template_id, status)
       VALUES ($1, $2::uuid, $3::uuid, 'sms', $4, $5, $6, $7, 'queued')
       RETURNING id`,
      [
        opts.tenant_id, opts.lead_id || null, opts.conversation_id || null,
        provider.name, opts.recipient, opts.message,
        opts.template_id || null,
      ],
    );
    logId = r.rows[0].id;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'sendSms: failed to enqueue log row');
  }

  const result = provider.sendSms
    ? await provider.sendSms(effective)
    : { ok: false, error: 'sms_provider_not_configured' as string };
  if (logId) {
    try {
      await pool.query(
        `UPDATE communication_logs
         SET status = $1::text, provider_response = $2::jsonb, last_error = $3,
             sent_at = CASE WHEN $1::text = 'sent' THEN NOW() ELSE sent_at END
         WHERE id = $4`,
        [
          result.ok ? 'sent' : 'failed',
          JSON.stringify((result as any).provider_response || {}),
          result.ok ? null : ((result as any).error || 'unknown'),
          logId,
        ],
      );
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'sendSms: failed to update log row');
    }
  }
  return { ok: result.ok, log_id: logId, error: result.ok ? undefined : (result as any).error };
}
