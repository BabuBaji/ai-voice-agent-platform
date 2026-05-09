/**
 * Wallet client — talks to identity-service-node:/api/v1/billing/* over HTTP.
 *
 * Used by the phone-number Buy flow so purchases debit the tenant wallet
 * BEFORE we commit to provisioning at the carrier. Calls fail-closed when
 * identity-service is unreachable so we don't silently mint free numbers.
 *
 * Note: identity-service expects an Authorization: Bearer JWT. The telephony
 * service doesn't have a user JWT — but it does have an internal-service auth
 * path. For now we forward the caller's Authorization header (passed through
 * via x-forwarded-authorization). Behind the gateway, the JWT is already
 * present on every request so this works in practice.
 */

const IDENTITY_BASE =
  process.env.IDENTITY_SERVICE_URL ||
  'http://localhost:8080';

export interface WalletInfo {
  balance: number;
  currency: string;
}

export async function getWallet(authHeader: string | undefined, tenantId: string): Promise<WalletInfo | null> {
  try {
    const r = await fetch(`${IDENTITY_BASE}/api/v1/billing/wallet`, {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        'x-tenant-id': tenantId,
      },
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const data = j.data ?? j;
    return { balance: Number(data.balance) || 0, currency: data.currency || 'INR' };
  } catch {
    return null;
  }
}

export interface RentalDebitResult {
  ok: boolean;
  status: number;
  body: any;
}

/**
 * Debit the wallet for a phone-number purchase.
 *
 * identity-service /billing/phone-numbers POST:
 *  - Checks wallet balance
 *  - Debits first month + extra-channel fees
 *  - Creates an invoice
 *  - Tracks the rental in billing
 *
 * Returns the raw result so the caller can decide whether to roll back the
 * carrier-side rental on failure.
 */
export async function debitForRental(params: {
  authHeader: string | undefined;
  tenantId: string;
  number: string;
  provider: string;
  country?: string;
  monthlyCost?: number;
  agentId?: string | null;
}): Promise<RentalDebitResult> {
  try {
    const r = await fetch(`${IDENTITY_BASE}/api/v1/billing/phone-numbers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.authHeader ? { Authorization: params.authHeader } : {}),
        'x-tenant-id': params.tenantId,
      },
      body: JSON.stringify({
        number: params.number,
        country: params.country,
        provider: params.provider,
        monthly_cost: params.monthlyCost,
        agent_id: params.agentId,
        channels: 1,
      }),
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (err: any) {
    return { ok: false, status: 0, body: { error: 'wallet_unreachable', message: err.message } };
  }
}
