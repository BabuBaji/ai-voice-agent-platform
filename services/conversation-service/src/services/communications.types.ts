/**
 * Shared communication-provider types. Lifted out of communications.ts so
 * provider classes that live in their own files (plivoTenantProvider.ts, …)
 * can implement CommunicationProvider without circular imports.
 *
 * The runtime entry points (sendEmail / sendWhatsApp / sendSms) still live
 * in communications.ts — these are types only.
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
  /** Template name (e.g. 'hello_world'). When set, providers route via
   *  template send. NULL → free-form session message (requires open 24h
   *  window with the recipient). */
  template_id?: string | null;
  /** BCP-47 language code for the template. Defaults to provider's env
   *  default (META_WA_TEMPLATE_LANG) when not specified. */
  template_language?: string | null;
  /** Positional variables for {{1}}, {{2}}, … in the template body.
   *  When provided, overrides the legacy greeting/URL heuristic in the
   *  Meta provider. Order matters — params[0] fills {{1}}, etc. */
  template_params?: string[] | null;
  attachments?: Array<{ name: string; url: string }>;
  /** Sender override. The post-call brochure flow injects the agent caller-ID. */
  from_number?: string | null;
}

export interface SmsSendOptions {
  tenant_id: string;
  lead_id?: string | null;
  conversation_id?: string | null;
  recipient: string;            // E.164 phone with + prefix
  message: string;
  template_id?: string | null;
  from_number?: string | null;
}

export interface CommunicationProvider {
  name: string;
  sendEmail(opts: EmailSendOptions): Promise<{ ok: boolean; provider_response?: any; error?: string }>;
  sendWhatsApp(opts: WhatsAppSendOptions): Promise<{ ok: boolean; provider_response?: any; error?: string }>;
  sendSms?(opts: SmsSendOptions): Promise<{ ok: boolean; provider_response?: any; error?: string }>;
}
