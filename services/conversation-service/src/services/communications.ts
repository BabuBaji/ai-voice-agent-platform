import { pool } from '../index';
import pino from 'pino';

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
export interface EmailSendOptions {
  tenant_id: string;
  lead_id?: string | null;
  conversation_id?: string | null;
  recipient: string;
  subject: string;
  body: string;
  attachments?: Array<{ name: string; url: string }>;
  template_id?: string | null;
}

export interface WhatsAppSendOptions {
  tenant_id: string;
  lead_id?: string | null;
  conversation_id?: string | null;
  recipient: string;            // E.164 phone with + prefix
  message: string;
  template_id?: string | null;
  attachments?: Array<{ name: string; url: string }>;
}

export interface CommunicationProvider {
  name: string;
  sendEmail(opts: EmailSendOptions): Promise<{ ok: boolean; provider_response?: any; error?: string }>;
  sendWhatsApp(opts: WhatsAppSendOptions): Promise<{ ok: boolean; provider_response?: any; error?: string }>;
}

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

const emailProvider: CommunicationProvider = new StubProvider();
const whatsappProvider: CommunicationProvider = new StubProvider();

/**
 * Send a brochure / admission-details email. Records the attempt in
 * `communication_logs` regardless of success so the lead-detail page
 * always shows what's been tried.
 */
export async function sendEmail(opts: EmailSendOptions): Promise<{ ok: boolean; log_id: string | null }> {
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
         SET status = $1, provider_response = $2::jsonb, last_error = $3,
             sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
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
  return { ok: result.ok, log_id: logId };
}

/** Same shape as sendEmail but for WhatsApp. */
export async function sendWhatsApp(opts: WhatsAppSendOptions): Promise<{ ok: boolean; log_id: string | null }> {
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
        whatsappProvider.name, opts.recipient, opts.message,
        opts.template_id || null, JSON.stringify(opts.attachments || []),
      ],
    );
    logId = r.rows[0].id;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'sendWhatsApp: failed to enqueue log row');
  }

  const result = await whatsappProvider.sendWhatsApp(opts);
  if (logId) {
    try {
      await pool.query(
        `UPDATE communication_logs
         SET status = $1, provider_response = $2::jsonb, last_error = $3,
             sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
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
  return { ok: result.ok, log_id: logId };
}
