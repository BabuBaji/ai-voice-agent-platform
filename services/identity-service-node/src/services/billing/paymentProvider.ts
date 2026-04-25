import crypto from 'crypto';

export interface ChargeRequest {
  amount: number;
  currency: string;
  description: string;
  payment_method_id?: string;
  tenant_id: string;
}

export interface ChargeResult {
  success: boolean;
  provider_ref: string;
  provider: string;
  failure_reason?: string;
}

export interface PaymentProvider {
  name: string;
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

class MockPaymentProvider implements PaymentProvider {
  name = 'mock';

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    // Always succeeds in dev. Useful for QA without real gateway keys.
    const ref = `mock_${crypto.randomBytes(8).toString('hex')}`;
    return {
      success: true,
      provider_ref: ref,
      provider: 'mock',
    };
  }
}

class RazorpayProvider implements PaymentProvider {
  name = 'razorpay';

  async charge(_req: ChargeRequest): Promise<ChargeResult> {
    // Stub. Real wiring requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET +
    // a public webhook URL. Until then we surface a clear failure.
    return {
      success: false,
      provider_ref: '',
      provider: 'razorpay',
      failure_reason: 'Razorpay not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET',
    };
  }
}

export function getPaymentProvider(): PaymentProvider {
  const requested = (process.env.BILLING_PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (requested === 'razorpay' && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return new RazorpayProvider();
  }
  return new MockPaymentProvider();
}
