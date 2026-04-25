export interface PlanFeature {
  agents: number | 'unlimited';
  included_minutes: number;
  channels: number;
  knowledge_base_mb: number;
  rate_per_min: number;
  extra_per_min: number;
  support: string;
  highlights: string[];
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: 'INR';
  billing_cycle: 'monthly';
  description?: string;
  features: PlanFeature;
  popular?: boolean;
  original_price?: number;
  discount_pct?: number;
  custom?: boolean;
  hidden_from_grid?: boolean;
}

// OmniDim-style 5-tier catalog (+ implicit Free for new tenants).
// Pricing in INR. Per-min rates were derived to give nice "minutes included"
// numbers (price ÷ rate_per_min).
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Free tier for trying things out.',
    hidden_from_grid: true,
    features: {
      agents: 1,
      included_minutes: 100,
      channels: 1,
      knowledge_base_mb: 5,
      rate_per_min: 4.5,
      extra_per_min: 0.5,
      support: 'Community',
      highlights: ['1 AI Agent', '100 free minutes/mo', '1 channel', 'Community support'],
    },
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 999,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Great for quick experimentations.',
    features: {
      agents: 2,
      included_minutes: 222,
      channels: 1,
      knowledge_base_mb: 5,
      rate_per_min: 4.5,
      extra_per_min: 0.5,
      support: 'Email',
      highlights: ['2 AI Agents', '222 included minutes', '1 channel', 'Email support'],
    },
  },
  {
    id: 'jump_starter',
    name: 'Jump Starter',
    price: 2499,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Best for building and sharing voice AI demos.',
    features: {
      agents: 5,
      included_minutes: 625,
      channels: 2,
      knowledge_base_mb: 10,
      rate_per_min: 4.0,
      extra_per_min: 0.4,
      support: 'Email',
      highlights: ['5 AI Agents', '625 included minutes', '2 channels', 'Custom voice cloning'],
    },
  },
  {
    id: 'early',
    name: 'Early deployers',
    price: 2999,
    original_price: 3299,
    discount_pct: 10,
    popular: true,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Best for users doing a POC with a live voice AI agent.',
    features: {
      agents: 10,
      included_minutes: 857,
      channels: 3,
      knowledge_base_mb: 50,
      rate_per_min: 3.5,
      extra_per_min: 0.3,
      support: 'Priority',
      highlights: ['10 AI Agents', '857 included minutes', '3 channels', 'Priority support', 'Advanced analytics'],
    },
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 14999,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Best for users scaling post-POC voice AI usage.',
    features: {
      agents: 25,
      included_minutes: 6000,
      channels: 5,
      knowledge_base_mb: 100,
      rate_per_min: 2.5,
      extra_per_min: 0.2,
      support: 'Priority',
      highlights: ['25 AI Agents', '6,000 included minutes', '5 channels', 'API access', 'White-glove onboarding'],
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 0,
    custom: true,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Launch at scale with volume-based discounts.',
    features: {
      agents: 'unlimited',
      included_minutes: 0,
      channels: 20,
      knowledge_base_mb: 1000,
      rate_per_min: 2.0,
      extra_per_min: 0,
      support: 'Dedicated',
      highlights: ['Agent training from recording', 'Dedicated support', 'SSO + custom contracts', 'GST invoicing'],
    },
  },
];

export function getPlan(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId);
}

export const DEFAULT_PLAN_ID = 'free';
export const TRIAL_CREDIT_INR = 500;

// Phone number rental defaults (India)
export const PHONE_RENTAL_DEFAULTS = {
  monthly_cost: 500,
  included_channels: 1,
  channel_extra_cost: 200,
};

// Cost breakdown ratios — applied to a call's total cost to split into
// voice/STT/TTS/AI buckets for the dashboard. Real per-component metering
// is a phase-2 feature; these add up to 1.0.
export const COST_BREAKDOWN_RATIOS = {
  voice: 0.5,
  stt: 0.15,
  tts: 0.2,
  ai: 0.15,
};
