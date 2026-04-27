import api from './api';

export interface PlanFeatures {
  agents: number | 'unlimited';
  included_minutes: number;
  channels?: number;            // legacy field name — backend now sends concurrent_calls
  concurrent_calls?: number;
  knowledge_base_mb: number;
  rate_per_min: number;
  extra_per_min: number;
  support: string;
  highlights: string[];
}

export type FeatureFlags = Partial<Record<string, boolean>>;

export interface Plan {
  id: string;
  name: string;
  tagline?: string;
  price: number;
  currency: 'INR';
  billing_cycle: 'monthly';
  description?: string;
  features: PlanFeatures;
  feature_flags?: FeatureFlags;
  popular?: boolean;
  original_price?: number;
  discount_pct?: number;
  custom?: boolean;
  hidden_from_grid?: boolean;
}

export interface ResolvedFeatures {
  plan_id: string;
  plan_name: string;
  flags: FeatureFlags;
  limits: {
    agents: number | 'unlimited';
    included_minutes: number;
    concurrent_calls: number;
    knowledge_base_mb: number;
    rate_per_min: number;
    extra_per_min: number;
  };
}

export interface Subscription {
  id: string;
  plan_id: string;
  plan_name: string;
  price: number;
  currency: string;
  billing_cycle: string;
  status: string;
  auto_renew: boolean;
  current_period_start: string;
  next_renewal_date: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  plan?: Plan;
}

export interface Wallet {
  id: string;
  balance: number;
  currency: string;
  low_balance_threshold: number;
  is_low: boolean;
}

export interface WalletTransaction {
  id: string;
  amount: number;
  type: 'credit' | 'debit';
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  balance_after: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UsageSummary {
  period_start: string;
  period_end: string;
  total_calls: number;
  total_minutes: number;
  total_cost: number;
  rate_per_min: number;
  included_minutes: number;
  included_minutes_used: number;
  included_minutes_remaining: number;
  active_agents: number;
  concurrent_channels: number;
  breakdown: {
    voice: number;
    stt: number;
    tts: number;
    ai: number;
    phone_numbers: number;
    extra_channels: number;
    total: number;
  };
}

export interface UsageCall {
  id: string;
  call_id: string;
  agent_id: string | null;
  channel: string;
  duration_sec: number;
  rate_per_min: number;
  cost: number;
  cost_breakdown: Record<string, number>;
  created_at: string;
}

export interface PhoneRental {
  id: string;
  number: string;
  country: string;
  provider: string;
  monthly_cost: number;
  channels: number;
  channel_extra_cost: number;
  status: string;
  agent_id: string | null;
  next_renewal_date: string;
  total_monthly: number;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'upi';
  provider: string;
  brand: string | null;
  last4: string | null;
  upi_id: string | null;
  holder_name: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  created_at: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity?: number;
  unit_price?: number;
  amount: number;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  subtotal: number;
  tax: number;
  tax_rate: number;
  total_amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'pending';
  reason: string;
  line_items: InvoiceLineItem[];
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export const billingApi = {
  // Plans
  getPlans: async (): Promise<Plan[]> => {
    const res = await api.get('/billing/plans');
    return res.data.data;
  },
  getCurrentPlan: async (): Promise<Subscription> => {
    const res = await api.get('/billing/plan');
    return res.data;
  },
  upgradePlan: async (plan_id: string): Promise<Subscription> => {
    const res = await api.post('/billing/upgrade', { plan_id });
    return res.data;
  },
  checkout: async (payload: {
    plan_id: string;
    card: { number: string; exp_month: number; exp_year: number; cvc: string; name: string };
    country?: string;
    email?: string;
    save_card?: boolean;
  }) => {
    const res = await api.post('/billing/checkout', payload);
    return res.data as { subscription: Subscription; charge: { provider: string; ref: string; amount: number }; wallet_balance_after: number };
  },
  cancelPlan: async (): Promise<Subscription> => {
    const res = await api.post('/billing/cancel');
    return res.data;
  },
  getFeatures: async (): Promise<ResolvedFeatures> => {
    const res = await api.get('/billing/features');
    return res.data;
  },

  // Wallet
  getWallet: async (): Promise<Wallet> => {
    const res = await api.get('/billing/wallet');
    return res.data;
  },
  addFunds: async (amount: number, payment_method_id?: string) => {
    const res = await api.post('/billing/wallet/add-funds', { amount, payment_method_id });
    return res.data as { balance_after: number; transaction_id: string; provider: string };
  },
  getTransactions: async (limit = 50): Promise<WalletTransaction[]> => {
    const res = await api.get('/billing/wallet/transactions', { params: { limit } });
    return res.data.data;
  },

  // Usage
  getUsage: async (): Promise<UsageSummary> => {
    const res = await api.get('/billing/usage');
    return res.data;
  },
  getUsageCalls: async (limit = 50): Promise<UsageCall[]> => {
    const res = await api.get('/billing/usage/calls', { params: { limit } });
    return res.data.data;
  },

  // Phone numbers (billing)
  getPhoneNumbers: async (): Promise<PhoneRental[]> => {
    const res = await api.get('/billing/phone-numbers');
    return res.data.data;
  },
  createPhoneRental: async (input: { number: string; country?: string; channels?: number }) => {
    const res = await api.post('/billing/phone-numbers', input);
    return res.data as PhoneRental;
  },
  updatePhoneRental: async (id: string, patch: { agent_id?: string | null; channels?: number; status?: 'active' | 'released' }) => {
    const res = await api.patch(`/billing/phone-numbers/${id}`, patch);
    return res.data as PhoneRental;
  },

  // Payment methods
  getPaymentMethods: async (): Promise<PaymentMethod[]> => {
    const res = await api.get('/billing/payment-methods');
    return res.data.data;
  },
  addPaymentMethod: async (input: {
    type: 'card' | 'upi';
    brand?: string;
    last4?: string;
    holder_name?: string;
    exp_month?: number;
    exp_year?: number;
    upi_id?: string;
    set_default?: boolean;
  }): Promise<PaymentMethod> => {
    const res = await api.post('/billing/payment-methods', input);
    return res.data;
  },
  setDefaultPaymentMethod: async (id: string) => {
    await api.post(`/billing/payment-methods/${id}/default`);
  },
  deletePaymentMethod: async (id: string) => {
    await api.delete(`/billing/payment-methods/${id}`);
  },

  // Invoices
  getInvoices: async (limit = 50): Promise<Invoice[]> => {
    const res = await api.get('/billing/invoices', { params: { limit } });
    return res.data.data;
  },
  getInvoice: async (id: string): Promise<Invoice> => {
    const res = await api.get(`/billing/invoices/${id}`);
    return res.data;
  },
};
