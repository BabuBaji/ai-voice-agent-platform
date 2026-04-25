import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'billing-client' });

export interface RecordCallParams {
  tenant_id: string;
  call_id: string;
  duration_sec: number;
  agent_id?: string | null;
  campaign_id?: string | null;
  channel?: 'voice' | 'web' | 'chat' | 'whatsapp';
}

/**
 * Fire-and-forget POST to identity-service to record a finished call's
 * billing impact. Best-effort: any error is logged and swallowed so
 * conversation analysis never fails because of a billing hiccup.
 */
export async function recordCallBilling(params: RecordCallParams): Promise<void> {
  try {
    const url = `${config.identityServiceUrl}/billing/usage/record-call`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': config.billingInternalToken,
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body, call_id: params.call_id }, 'Billing record-call returned non-200');
      return;
    }
    const data = await res.json().catch(() => null);
    if (data && data.cost && data.cost > 0) {
      logger.info({ call_id: params.call_id, cost: data.cost, duration_sec: params.duration_sec }, 'Call billed');
    }
  } catch (err) {
    logger.warn({ err, call_id: params.call_id }, 'Billing record-call failed (non-fatal)');
  }
}
