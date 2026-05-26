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
}

export const plivoProvider = new PlivoProvider();
