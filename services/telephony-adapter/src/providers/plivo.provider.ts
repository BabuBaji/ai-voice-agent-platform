import * as plivo from 'plivo';
import pino from 'pino';
import {
  TelephonyProvider,
  CallOptions,
  CallResult,
  TransferOptions,
  PhoneNumberProvisionOptions,
  ProvisionedNumber,
} from './base.provider';
import { config } from '../config';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

/**
 * Extract a human-readable error message out of a Plivo error response.
 *
 * Plivo's 4xx body is sometimes a top-level string ("error: ...") and
 * sometimes a nested object — e.g. `{ "error": { "message": "...", "code": ... } }`
 * or `{ "error": { "destination": ["This field is required"] } }`. Doing
 * `String(detail.error)` on the latter produces "[object Object]" which is
 * useless to the user. This walks the common shapes and produces a sentence.
 */
function extractPlivoErrorMessage(detail: any, rawText: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (!detail || typeof detail !== 'object') return rawText.slice(0, 200) || 'Plivo error';

  const e = detail.error;
  if (typeof e === 'string' && e.trim()) return e;

  if (e && typeof e === 'object') {
    if (typeof e.message === 'string' && e.message) return e.message;
    // Plivo field-validation shape: { error: { destination: ["msg"], ... } }
    const fieldMessages: string[] = [];
    for (const [key, val] of Object.entries(e)) {
      if (key === 'message' || key === 'code') continue;
      if (Array.isArray(val) && val.length > 0) {
        fieldMessages.push(`${key}: ${val.join(', ')}`);
      } else if (typeof val === 'string' && val) {
        fieldMessages.push(`${key}: ${val}`);
      }
    }
    if (fieldMessages.length > 0) return fieldMessages.join('; ');
    // Last resort — JSON-encode the inner error object so the operator can
    // see the raw shape instead of "[object Object]".
    try { return JSON.stringify(e).slice(0, 300); } catch { /* fall through */ }
  }

  if (typeof detail.message === 'string' && detail.message) return detail.message;
  if (detail.api_id) return `request ${detail.api_id}`;
  return rawText.slice(0, 200) || 'Plivo error';
}

/**
 * Plivo provider. Uses Plivo's REST API via the official Node SDK.
 *
 * Plivo requires:
 * - PLIVO_AUTH_ID (starts with "MA")
 * - PLIVO_AUTH_TOKEN
 * - PLIVO_PHONE_NUMBER (E.164, e.g. +919xxxxxxxxx)
 *
 * Webhooks return Plivo XML (not TwiML). The answer URL must be publicly
 * reachable — set PUBLIC_BASE_URL (ngrok/cloudflared/your domain).
 */
export class PlivoProvider implements TelephonyProvider {
  readonly name = 'plivo';
  private client: any | null = null;

  private getClient(): any {
    if (!this.client) {
      if (!config.plivo.authId || !config.plivo.authToken) {
        throw new Error('Plivo credentials not configured. Set PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN.');
      }
      this.client = new (plivo as any).Client(config.plivo.authId, config.plivo.authToken);
    }
    return this.client;
  }

  async initiateCall(options: CallOptions): Promise<CallResult> {
    // Use Plivo's REST API directly. The Node SDK swallows unknown options
    // and has had silent-failure bugs around `record` in our stack — posting
    // the exact snake_case payload ourselves guarantees recording is on.
    const simpleFlag = process.env.PLIVO_SIMPLE_MODE === '1' ? '&simple=1' : '';
    const answerUrl = `${config.publicBaseUrl}/webhooks/plivo/voice?agentId=${options.agentId}&tenantId=${options.tenantId}${simpleFlag}`;
    const hangupUrl = `${config.publicBaseUrl}/webhooks/plivo/status`;
    const recordUrl = `${config.publicBaseUrl}/webhooks/plivo/recording`;

    const payload: Record<string, any> = {
      from: options.from,
      to: options.to,
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: hangupUrl,
      hangup_method: 'POST',
      // Explicit recording config. Plivo expects snake_case + string booleans
      // for the `record` flag on some SDK versions; we pass the actual bool
      // here since we're hitting REST directly and Plivo accepts both.
      record: true,
      record_callback_url: recordUrl,
      record_callback_method: 'POST',
    };

    if (options.voicemailDetection) {
      payload.machine_detection = 'true';
      payload.machine_detection_time = 5000;
    }

    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Call/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');

    logger.info(
      { to: options.to, recordUrl, answerUrl, hangupUrl },
      'Plivo initiateCall: posting with record=true (REST)',
    );

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      if (resp.status < 200 || resp.status >= 300) {
        logger.error({ status: resp.status, body: text.slice(0, 400) }, 'Plivo call create failed');
        let detail: any = text;
        try { detail = JSON.parse(text); } catch {}
        throw new Error(`Plivo ${resp.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
      }
      const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
      // Plivo returns { request_uuid, message, api_id }
      const providerCallId = data.request_uuid || data.message_uuid || '';
      logger.info({ requestUuid: providerCallId, to: options.to, status: resp.status }, 'Plivo call queued');
      return { providerCallId, status: 'queued' };
    } catch (err: any) {
      const msg = err?.message || 'Unknown Plivo error';
      logger.error({ err: msg, to: options.to }, 'Failed to initiate Plivo call');
      throw new Error(msg);
    }
  }

  async endCall(providerCallId: string): Promise<void> {
    try {
      const client = this.getClient();
      await client.calls.hangup(providerCallId);
    } catch (err: any) {
      logger.warn({ err: err.message, providerCallId }, 'Failed to hangup Plivo call');
    }
  }

  async getCallStatus(providerCallId: string): Promise<{ status: string; duration?: number }> {
    try {
      const client = this.getClient();
      const call = await client.calls.get(providerCallId);
      return {
        status: (call as any).callStatus || (call as any).status || 'unknown',
        duration: (call as any).callDuration ? parseInt((call as any).callDuration) : undefined,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, providerCallId }, 'Failed to get Plivo call status');
      return { status: 'unknown' };
    }
  }

  async transferCall(options: TransferOptions): Promise<void> {
    // Plivo supports transfer by updating the live call's answer URL.
    // We do a simplified implementation: redirect the live call to a new answer URL
    // that <Dial>s the transfer target.
    try {
      const client = this.getClient();
      const transferUrl = `${config.publicBaseUrl}/webhooks/plivo/transfer?to=${encodeURIComponent(options.transferTo)}`;
      await client.calls.transfer(options.callId, { alegUrl: transferUrl, alegMethod: 'POST' });
    } catch (err: any) {
      logger.error({ err: err.message, options }, 'Plivo transfer failed');
      throw err;
    }
  }

  async provisionNumber(options: PhoneNumberProvisionOptions): Promise<ProvisionedNumber> {
    // POST /v1/Account/<id>/PhoneNumber/<number>/ rents the number atomically
    // (Plivo's "buy" endpoint). We use REST directly because the Node SDK's
    // `client.numbers.buy(...)` shape isn't stable across versions.
    const exactNumber = (options.areaCode || '').replace(/[^\d]/g, '');
    if (!exactNumber) {
      throw new Error('Plivo provisionNumber requires the exact number in `areaCode`');
    }
    const wantSms = options.capabilities.includes('sms');
    const wantVoice = options.capabilities.includes('voice');

    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/PhoneNumber/${exactNumber}/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (r.status !== 201 && r.status !== 200) {
        const txt = await r.text().catch(() => '');
        logger.error({ status: r.status, body: txt.slice(0, 300), exactNumber }, 'Plivo buy failed');
        let detail: any = txt;
        try { detail = JSON.parse(txt); } catch { /* ignore */ }
        throw new Error(`Plivo ${r.status}: ${extractPlivoErrorMessage(detail, txt).slice(0, 300)}`);
      }
      // Successful body: { status:'fulfilled', numbers:[{number, status:'pending'|...}] }
      const data: any = await r.json().catch(() => ({}));
      const purchased = data?.numbers?.[0]?.number || exactNumber;
      return {
        providerNumberId: purchased,
        number: '+' + purchased.replace(/^\+/, ''),
        capabilities: [
          ...(wantVoice ? ['voice' as const] : []),
          ...(wantSms ? ['sms' as const] : []),
        ],
      };
    } catch (err: any) {
      throw err;
    }
  }

  /**
   * Register a customer (KYC payload) with Plivo as an End User. The returned
   * end_user_id is later attached to the rented number so Plivo's compliance
   * trail links the number to a verified business identity.
   * Plivo API: POST /v1/Account/{auth_id}/EndUser/
   */
  /**
   * Fetch the Plivo account's current cash balance + auto-recharge state.
   * Returns null on credential / network errors so callers can degrade
   * gracefully (skip pre-check when the carrier is unreachable).
   */
  async getAccountBalance(): Promise<{ cashCredits: number; accountType: string; state: string; autoRecharge: boolean } | null> {
    if (!config.plivo.authId || !config.plivo.authToken) return null;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return null;
      const d: any = await r.json();
      return {
        cashCredits: parseFloat(d.cash_credits) || 0,
        accountType: d.account_type || 'unknown',
        state: d.state || '',
        autoRecharge: d.auto_recharge === true || d.auto_recharge === 'True',
      };
    } catch {
      return null;
    }
  }

  /**
   * List EndUsers, optionally filtered by name. Plivo supports filtering via
   * `?name=` query param.
   */
  async listEndUsers(filter?: { name?: string; lastName?: string }): Promise<Array<{ end_user_id: string; name: string; last_name: string; end_user_type: string }>> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const qs = new URLSearchParams();
    if (filter?.name) qs.set('name', filter.name);
    if (filter?.lastName) qs.set('last_name', filter.lastName);
    qs.set('limit', '20');
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/EndUser/?${qs.toString()}`;
    const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!r.ok) return [];
    const j: any = await r.json().catch(() => ({}));
    return Array.isArray(j.objects) ? j.objects : [];
  }

  /**
   * Register an EndUser at Plivo, idempotently. If Plivo returns
   * "already exists" we look up the existing record and return its ID
   * instead of failing — keeps the wizard re-runnable when a previous
   * attempt half-succeeded (e.g. number-rent failed AFTER end-user create).
   */
  async registerEndUser(input: {
    name: string;
    last_name?: string;
    end_user_type?: 'individual' | 'business';
  }): Promise<{ endUserId: string; reused?: boolean }> {
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/EndUser/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const body = {
      name: input.name,
      last_name: input.last_name || '',
      end_user_type: input.end_user_type || 'business',
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (r.status === 201 || r.status === 200) {
      const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
      const endUserId = data.end_user_id || data.api_id || '';
      if (!endUserId) throw new Error('Plivo did not return an end_user_id');
      return { endUserId };
    }

    // Non-2xx — extract message and check for the "already exists" case.
    let detail: any = text;
    try { detail = JSON.parse(text); } catch {}
    const msg = extractPlivoErrorMessage(detail, text);
    const lower = msg.toLowerCase();
    const isDuplicate = /already\s*exist|duplicate|already\s*registered/i.test(msg);

    if (isDuplicate) {
      // Look up the existing record by name. Plivo's "name" field is the
      // first name; "last_name" is the surname. We try matching both.
      try {
        const matches = await this.listEndUsers({ name: input.name });
        const exact = matches.find(
          (m) => (m.name || '').toLowerCase() === input.name.toLowerCase()
            && (m.last_name || '').toLowerCase() === (input.last_name || '').toLowerCase(),
        ) || matches[0];
        if (exact?.end_user_id) {
          logger.info({ name: input.name, end_user_id: exact.end_user_id }, 'Plivo EndUser reused (already existed)');
          return { endUserId: exact.end_user_id, reused: true };
        }
      } catch (lookupErr: any) {
        logger.warn({ err: lookupErr.message }, 'Plivo EndUser lookup after duplicate failed');
      }
    }

    logger.error({ status: r.status, body: text.slice(0, 300) }, 'Plivo EndUser create failed');
    throw new Error(`Plivo EndUser ${r.status}: ${msg.slice(0, 300)}`);
  }

  /**
   * Buy a number and bind it to a previously-created end_user_id. Plivo
   * accepts the same /PhoneNumber/{number}/ endpoint as provisionNumber but
   * with an end_user_id in the body so the carrier KYC trail is preserved.
   */
  async provisionNumberWithEndUser(opts: {
    number: string;
    endUserId: string;
    capabilities: ('voice' | 'sms')[];
    appId?: string;
  }): Promise<ProvisionedNumber> {
    const exact = opts.number.replace(/[^\d]/g, '');
    if (!exact) throw new Error('provisionNumberWithEndUser requires a digit-only number');

    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/PhoneNumber/${exact}/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const payload: Record<string, any> = { end_user_id: opts.endUserId };
    if (opts.appId) payload.app_id = opts.appId;

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (r.status !== 201 && r.status !== 200) {
      let detail: any = text;
      try { detail = JSON.parse(text); } catch {}
      const errStr = extractPlivoErrorMessage(detail, text);
      logger.error({ status: r.status, body: text.slice(0, 300), exact, endUserId: opts.endUserId }, 'Plivo buy w/ end-user failed');
      throw new Error(`Plivo ${r.status}: ${errStr.slice(0, 300)}`);
    }
    const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    const purchased = data?.numbers?.[0]?.number || exact;
    return {
      providerNumberId: purchased,
      number: '+' + purchased.replace(/^\+/, ''),
      capabilities: opts.capabilities.slice(),
    };
  }

  async releaseNumber(providerNumberId: string): Promise<void> {
    const number = String(providerNumberId).replace(/[^\d]/g, '');
    if (!number) return;
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Number/${number}/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } });
    } catch (err: any) {
      logger.warn({ err: err.message, number }, 'Plivo number release failed');
    }
  }

  async listAvailableNumbers(country: string, capabilities?: string[], numberType?: string): Promise<ProvisionedNumber[]> {
    // Use Plivo's REST API directly — the Node SDK exposes it as
    // `client.phoneNumbers.search(...)` but its return shape varies by SDK
    // version. Calling REST gives us a stable response.
    // numberType: 'local' (default), 'tollfree', or 'any' (searches both).
    const plivoType = numberType === 'tollfree' ? 'tollfree' : 'local';
    const params = new URLSearchParams({
      country_iso: (country || 'US').toUpperCase(),
      type: plivoType,
      limit: '20',
    });
    if (capabilities?.includes('sms') && !capabilities.includes('voice')) params.set('services', 'sms');
    else if (capabilities?.includes('sms')) params.set('services', 'voice,sms');
    else params.set('services', 'voice');

    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/PhoneNumber/?${params.toString()}`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');

    try {
      const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        logger.warn({ status: r.status, body: txt.slice(0, 200), country }, 'Plivo search failed');
        return [];
      }
      const data: any = await r.json();
      const objects = data?.objects || [];
      return objects.map((n: any) => ({
        providerNumberId: n.number,
        number: '+' + String(n.number || '').replace(/^\+/, ''),
        capabilities: [
          ...(n.voice_enabled !== false ? ['voice' as const] : []),
          ...(n.sms_enabled ? ['sms' as const] : []),
        ],
        ...(n.monthly_rental_rate ? { monthlyRate: parseFloat(n.monthly_rental_rate) } : {}),
        ...(n.region ? { region: n.region } : {}),
        ...(n.country ? { country: n.country } : {}),
      })) as ProvisionedNumber[];
    } catch (err: any) {
      logger.warn({ err: err.message, country }, 'Plivo listAvailableNumbers fetch failed');
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SMS / MMS
  // ─────────────────────────────────────────────────────────────────────────

  async sendSms(opts: {
    from: string; to: string; text: string;
    callbackUrl?: string; dltEntityId?: string; dltTemplateId?: string;
  }): Promise<{ messageUuid: string; status: string }> {
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Message/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const payload: Record<string, any> = {
      src: opts.from, dst: opts.to, text: opts.text, type: 'sms',
    };
    if (opts.callbackUrl) { payload.url = opts.callbackUrl; payload.method = 'POST'; }
    if (opts.dltEntityId) payload.dlt_entity_id = opts.dltEntityId;
    if (opts.dltTemplateId) payload.dlt_template_id = opts.dltTemplateId;

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      let detail: any = text; try { detail = JSON.parse(text); } catch {}
      throw new Error(`Plivo SMS ${r.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
    }
    const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    const uuid = Array.isArray(data.message_uuid) ? data.message_uuid[0] : (data.message_uuid || '');
    logger.info({ to: opts.to, uuid }, 'Plivo SMS sent');
    return { messageUuid: uuid, status: 'queued' };
  }

  async sendMms(opts: {
    from: string; to: string; text: string; mediaUrls: string[]; callbackUrl?: string;
  }): Promise<{ messageUuid: string; status: string }> {
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Message/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const payload: Record<string, any> = {
      src: opts.from, dst: opts.to, text: opts.text,
      type: 'mms', media_urls: opts.mediaUrls,
    };
    if (opts.callbackUrl) { payload.url = opts.callbackUrl; payload.method = 'POST'; }

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      let detail: any = text; try { detail = JSON.parse(text); } catch {}
      throw new Error(`Plivo MMS ${r.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
    }
    const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    const uuid = Array.isArray(data.message_uuid) ? data.message_uuid[0] : (data.message_uuid || '');
    logger.info({ to: opts.to, uuid }, 'Plivo MMS sent');
    return { messageUuid: uuid, status: 'queued' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Number Lookup
  // ─────────────────────────────────────────────────────────────────────────

  async lookupNumber(number: string): Promise<{
    country: string; numberType: string;
    carrier: { name: string; mobileCountryCode: string; mobileNetworkCode: string };
    format: { e164: string; national: string; international: string };
  } | null> {
    const digits = number.replace(/[^\d+]/g, '');
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      const r = await fetch(`https://lookup.plivo.com/v1/Number/${encodeURIComponent(digits)}?type=carrier`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return null;
      const d: any = await r.json();
      return {
        country: d.country?.name || d.country_iso || '',
        numberType: d.phone_number_type || d.type || '',
        carrier: {
          name: d.carrier?.name || '',
          mobileCountryCode: d.carrier?.mobile_country_code || '',
          mobileNetworkCode: d.carrier?.mobile_network_code || '',
        },
        format: {
          e164: d.phone_number || digits,
          national: d.national_format || '',
          international: d.international_format || '',
        },
      };
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Verify (OTP)
  // ─────────────────────────────────────────────────────────────────────────

  async startVerification(opts: {
    to: string; channel?: 'sms' | 'call'; codeLength?: number; locale?: string;
  }): Promise<{ sessionUuid: string; status: string }> {
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Verify/Session/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const payload: Record<string, any> = {
      recipient: opts.to,
      channel: opts.channel || 'sms',
      code_length: opts.codeLength || 6,
    };
    if (opts.locale) payload.locale = opts.locale;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      let detail: any = text; try { detail = JSON.parse(text); } catch {}
      throw new Error(`Plivo Verify ${r.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
    }
    const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    logger.info({ to: opts.to, session: data.session_uuid }, 'Plivo OTP sent');
    return { sessionUuid: data.session_uuid || '', status: data.status || 'sent' };
  }

  async checkVerification(opts: { sessionUuid: string; code: string }): Promise<{ status: string; valid: boolean }> {
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Verify/Session/${opts.sessionUuid}/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: opts.code }),
    });
    const text = await r.text();
    const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    const status = data.status || (r.ok ? 'verified' : 'invalid');
    const valid = r.ok && (status === 'verified' || status === 'approved');
    logger.info({ session: opts.sessionUuid, valid, status }, 'Plivo OTP check');
    return { status, valid };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conference
  // ─────────────────────────────────────────────────────────────────────────

  async createConference(opts: {
    conferenceName: string; callUuid: string;
    muted?: boolean; record?: boolean; callbackUrl?: string; maxMembers?: number;
  }): Promise<{ conferenceName: string }> {
    const confUrl = `${config.publicBaseUrl}/api/v1/plivo/conference-xml?name=${encodeURIComponent(opts.conferenceName)}&record=${opts.record ? '1' : '0'}&max=${opts.maxMembers || 10}&muted=${opts.muted ? '1' : '0'}&cb=${encodeURIComponent(opts.callbackUrl || '')}`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Call/${opts.callUuid}/`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aleg_url: confUrl, aleg_method: 'GET' }),
    });
    if (!r.ok) {
      const text = await r.text();
      let detail: any = text; try { detail = JSON.parse(text); } catch {}
      throw new Error(`Plivo conference redirect ${r.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
    }
    logger.info({ conferenceName: opts.conferenceName, callUuid: opts.callUuid }, 'Call redirected to conference');
    return { conferenceName: opts.conferenceName };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Recordings
  // ─────────────────────────────────────────────────────────────────────────

  async listRecordings(opts?: { callUuid?: string; limit?: number; offset?: number }): Promise<Array<{
    recordingId: string; callUuid: string; url: string; duration: number; conferenceName: string;
  }>> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const qs = new URLSearchParams();
    if (opts?.callUuid) qs.set('call_uuid', opts.callUuid);
    qs.set('limit', String(opts?.limit || 20));
    if (opts?.offset) qs.set('offset', String(opts.offset));
    try {
      const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Recording/?${qs}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return [];
      const d: any = await r.json();
      return (d.objects || []).map((o: any) => ({
        recordingId: o.recording_id || '', callUuid: o.call_uuid || '',
        url: o.recording_url || '', duration: parseFloat(o.recording_duration_ms || o.recording_duration || 0) / 1000,
        conferenceName: o.conference_name || '',
      }));
    } catch { return []; }
  }

  async getRecording(recordingId: string): Promise<{
    recordingId: string; callUuid: string; url: string; duration: number;
  } | null> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Recording/${recordingId}/`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return null;
      const o: any = await r.json();
      return {
        recordingId: o.recording_id || recordingId, callUuid: o.call_uuid || '',
        url: o.recording_url || '', duration: parseFloat(o.recording_duration_ms || o.recording_duration || 0) / 1000,
      };
    } catch { return null; }
  }

  async deleteRecording(recordingId: string): Promise<void> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Recording/${recordingId}/`, {
        method: 'DELETE', headers: { Authorization: `Basic ${auth}` },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, recordingId }, 'Plivo recording delete failed');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Owned Numbers
  // ─────────────────────────────────────────────────────────────────────────

  async listOwnedNumbers(opts?: { limit?: number; offset?: number; numberType?: string }): Promise<Array<{
    number: string; alias: string; voiceEnabled: boolean; smsEnabled: boolean;
    monthlyRentalRate: number; numberType: string; region: string; appId: string;
  }>> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const qs = new URLSearchParams();
    qs.set('limit', String(opts?.limit || 20));
    if (opts?.offset) qs.set('offset', String(opts.offset));
    if (opts?.numberType) qs.set('type', opts.numberType);
    try {
      const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Number/?${qs}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return [];
      const d: any = await r.json();
      return (d.objects || []).map((o: any) => ({
        number: o.number ? ('+' + String(o.number).replace(/^\+/, '')) : '',
        alias: o.alias || '', voiceEnabled: o.voice_enabled !== false,
        smsEnabled: !!o.sms_enabled, monthlyRentalRate: parseFloat(o.monthly_rental_rate || 0),
        numberType: o.number_type || o.type || '', region: o.region || '',
        appId: o.application || '',
      }));
    } catch { return []; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Call Detail Records
  // ─────────────────────────────────────────────────────────────────────────

  async getCallDetailRecord(callUuid: string): Promise<{
    callUuid: string; from: string; to: string; direction: string;
    duration: number; billDuration: number; totalAmount: string;
    answerTime: string; endTime: string; hangupCause: string; status: string;
  } | null> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Call/${callUuid}/`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return null;
      const o: any = await r.json();
      return {
        callUuid: o.call_uuid || callUuid, from: o.from_number || '', to: o.to_number || '',
        direction: o.call_direction || '', duration: parseInt(o.call_duration || '0'),
        billDuration: parseInt(o.billed_duration || '0'), totalAmount: o.total_amount || '0',
        answerTime: o.answer_time || '', endTime: o.end_time || '',
        hangupCause: o.hangup_cause_name || '', status: o.call_state || '',
      };
    } catch { return null; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pricing
  // ─────────────────────────────────────────────────────────────────────────

  async getPricing(countryIso: string): Promise<{
    country: string; countryCode: string;
    phoneNumbers: { local: any; tollfree: any };
    voice: { inbound: any; outbound: any };
    message: { inbound: any; outbound: any };
  } | null> {
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    try {
      const r = await fetch(`https://api.plivo.com/v1/Account/${config.plivo.authId}/Pricing/?country_iso=${countryIso.toUpperCase()}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return null;
      const d: any = await r.json();
      return {
        country: d.country || '', countryCode: d.country_code || '',
        phoneNumbers: { local: d.phone_numbers?.local || null, tollfree: d.phone_numbers?.tollfree || null },
        voice: { inbound: d.voice?.inbound || null, outbound: d.voice?.outbound || null },
        message: { inbound: d.message?.inbound || null, outbound: d.message?.outbound || null },
      };
    } catch { return null; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Applications (webhook URL management)
  // ─────────────────────────────────────────────────────────────────────────

  async createApplication(opts: {
    name: string; answerUrl: string; hangupUrl?: string;
    messageUrl?: string; fallbackUrl?: string;
  }): Promise<{ appId: string; name: string }> {
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Application/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const payload: Record<string, any> = {
      app_name: opts.name, answer_url: opts.answerUrl, answer_method: 'POST',
    };
    if (opts.hangupUrl) { payload.hangup_url = opts.hangupUrl; payload.hangup_method = 'POST'; }
    if (opts.messageUrl) { payload.message_url = opts.messageUrl; payload.message_method = 'POST'; }
    if (opts.fallbackUrl) { payload.fallback_answer_url = opts.fallbackUrl; payload.fallback_method = 'POST'; }

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      let detail: any = text; try { detail = JSON.parse(text); } catch {}
      throw new Error(`Plivo Application ${r.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
    }
    const data: any = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    logger.info({ appId: data.app_id, name: opts.name }, 'Plivo Application created');
    return { appId: data.app_id || '', name: opts.name };
  }

  async updateNumberApplication(number: string, appId: string): Promise<void> {
    const digits = number.replace(/[^\d]/g, '');
    const url = `https://api.plivo.com/v1/Account/${config.plivo.authId}/Number/${digits}/`;
    const auth = Buffer.from(`${config.plivo.authId}:${config.plivo.authToken}`).toString('base64');
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId }),
    });
    if (!r.ok) {
      const text = await r.text();
      let detail: any = text; try { detail = JSON.parse(text); } catch {}
      throw new Error(`Plivo Number update ${r.status}: ${extractPlivoErrorMessage(detail, text).slice(0, 300)}`);
    }
    logger.info({ number: digits, appId }, 'Number application updated');
  }
}

export const plivoProvider = new PlivoProvider();
