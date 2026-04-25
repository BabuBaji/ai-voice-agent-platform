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
        throw new Error(`Plivo ${resp.status}: ${(detail?.error || String(text)).slice(0, 200)}`);
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
        // Try to surface a clean error message
        let detail = txt;
        try {
          const j = JSON.parse(txt);
          detail = j?.error || j?.api_id || txt;
        } catch { /* ignore */ }
        throw new Error(`Plivo ${r.status}: ${String(detail).slice(0, 160)}`);
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

  async listAvailableNumbers(country: string, capabilities?: string[]): Promise<ProvisionedNumber[]> {
    // Use Plivo's REST API directly — the Node SDK exposes it as
    // `client.phoneNumbers.search(...)` but its return shape varies by SDK
    // version. Calling REST gives us a stable response.
    const params = new URLSearchParams({
      country_iso: (country || 'US').toUpperCase(),
      type: 'local',
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
