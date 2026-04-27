// 5-tier OmniDim-style catalog: Free → Starter → Growth → Pro → Enterprise.
// Every plan defines:
//   - hard limits (agents, minutes, channels, KB) — enforced server-side
//   - per-min pricing — debited from wallet on each call
//   - feature_flags — boolean capability gates wired across the platform

export type FeatureKey =
  // call channels / capabilities
  | 'web_calls' | 'phone_calls' | 'whatsapp' | 'bulk_calls' | 'voice_cloning' | 'multilingual'
  // analytics & data
  | 'basic_analytics' | 'advanced_analytics' | 'sentiment_detection' | 'lead_scoring' | 'transcript' | 'recording'
  // automation & integrations
  | 'webhooks' | 'calendar' | 'crm_basic' | 'crm_advanced' | 'custom_workflows' | 'api_access'
  // collaboration & access
  | 'multi_team' | 'rbac' | 'sso'
  // enterprise
  | 'dedicated_support' | 'sla' | 'custom_models' | 'on_prem' | 'agent_training_from_recordings';

export type FeatureFlags = Partial<Record<FeatureKey, boolean>>;

export interface PlanFeature {
  agents: number | 'unlimited';
  included_minutes: number;
  concurrent_calls: number;
  knowledge_base_mb: number;
  rate_per_min: number;        // included-minutes price (used to compute "minutes worth")
  extra_per_min: number;       // overage rate after included minutes are exhausted
  support: string;
  highlights: string[];
}

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  price: number;               // INR / month
  currency: 'INR';
  billing_cycle: 'monthly';
  description?: string;
  features: PlanFeature;
  feature_flags: FeatureFlags;
  popular?: boolean;
  custom?: boolean;            // true → contact-sales, no self-serve checkout
  hidden_from_grid?: boolean;
}

// ── Catalog ─────────────────────────────────────────────────────────────────
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Start free. No credit card.',
    price: 0,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'For testing and demos. Web calls only — no phone calling, no bulk campaigns.',
    features: {
      agents: 1,
      included_minutes: 100,
      concurrent_calls: 1,
      knowledge_base_mb: 5,
      rate_per_min: 5.0,
      extra_per_min: 0.5,
      support: 'Community',
      highlights: ['1 AI agent', '100 free minutes / month', 'Web calls only', 'Basic analytics', 'English only'],
    },
    feature_flags: {
      web_calls: true,
      basic_analytics: true,
      transcript: true,
      // explicitly disabled — listed for clarity even though absence = false
      phone_calls: false, bulk_calls: false, voice_cloning: false, multilingual: false,
      webhooks: false, api_access: false, advanced_analytics: false,
    },
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For small teams testing voice AI in production.',
    price: 999,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Phone + web calls, basic bulk campaigns, basic CRM integration.',
    features: {
      agents: 3,
      included_minutes: 500,
      concurrent_calls: 2,
      knowledge_base_mb: 25,
      rate_per_min: 4.5,
      extra_per_min: 0.5,
      support: 'Email',
      highlights: ['3 AI agents', '500 included minutes', 'Phone + web calls', 'Basic bulk campaigns (500 contacts)', 'CRM basics', 'Email notifications'],
    },
    feature_flags: {
      web_calls: true, phone_calls: true,
      bulk_calls: true, transcript: true, recording: true,
      basic_analytics: true, crm_basic: true,
    },
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For growing businesses scaling voice automation.',
    price: 4999,
    popular: true,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Multilingual, advanced analytics, webhooks, calendar, CSV bulk campaigns, retry logic.',
    features: {
      agents: 10,
      included_minutes: 1500,
      concurrent_calls: 5,
      knowledge_base_mb: 100,
      rate_per_min: 3.5,
      extra_per_min: 0.4,
      support: 'Priority email',
      highlights: ['10 AI agents', '1,500 included minutes', 'Bulk CSV campaigns', 'Multilingual (Te/Hi/En + 10 more)', 'Advanced analytics', 'Webhooks + calendar', 'Call retry logic'],
    },
    feature_flags: {
      web_calls: true, phone_calls: true,
      bulk_calls: true, multilingual: true, transcript: true, recording: true,
      basic_analytics: true, advanced_analytics: true, sentiment_detection: true,
      crm_basic: true, webhooks: true, calendar: true,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For serious automation and high-scale ops.',
    price: 14999,
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Unlimited agents, voice cloning, AI lead scoring, RBAC, API access, advanced CRM.',
    features: {
      agents: 'unlimited',
      included_minutes: 5000,
      concurrent_calls: 15,
      knowledge_base_mb: 500,
      rate_per_min: 2.8,
      extra_per_min: 0.3,
      support: 'Priority',
      highlights: ['Unlimited agents', '5,000 included minutes', 'Voice cloning', 'AI lead scoring + sentiment', 'Custom workflows', 'Salesforce / Zoho / HubSpot', 'Multi-team + RBAC', 'API access'],
    },
    feature_flags: {
      web_calls: true, phone_calls: true, whatsapp: true,
      bulk_calls: true, voice_cloning: true, multilingual: true,
      transcript: true, recording: true,
      basic_analytics: true, advanced_analytics: true, sentiment_detection: true, lead_scoring: true,
      crm_basic: true, crm_advanced: true, webhooks: true, calendar: true, custom_workflows: true, api_access: true,
      multi_team: true, rbac: true,
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large companies — custom pricing & deployment.',
    price: 0,
    custom: true,                  // sales quote required, no self-serve checkout
    currency: 'INR',
    billing_cycle: 'monthly',
    description: 'Custom AI models, agent training from recordings, on-prem option, SLA, dedicated support.',
    features: {
      agents: 'unlimited',
      included_minutes: 0,         // bespoke
      concurrent_calls: 100,
      knowledge_base_mb: 5000,
      rate_per_min: 2.0,           // ₹2/min target — actual rate negotiated per contract
      extra_per_min: 0,
      support: 'Dedicated CSM + SLA',
      highlights: ['Custom pricing', 'From ₹2.0/min — volume tiered', '100+ concurrent calls', 'Dedicated support + SLA', 'Custom AI models', 'Agent training from recordings', 'Custom integrations', 'On-prem / private cloud', 'SSO + SOC 2'],
    },
    feature_flags: {
      web_calls: true, phone_calls: true, whatsapp: true,
      bulk_calls: true, voice_cloning: true, multilingual: true,
      transcript: true, recording: true,
      basic_analytics: true, advanced_analytics: true, sentiment_detection: true, lead_scoring: true,
      crm_basic: true, crm_advanced: true, webhooks: true, calendar: true, custom_workflows: true, api_access: true,
      multi_team: true, rbac: true, sso: true,
      dedicated_support: true, sla: true, custom_models: true, on_prem: true, agent_training_from_recordings: true,
    },
  },
];

// ── Public API ─────────────────────────────────────────────────────────────
export function getPlan(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId);
}

// Legacy plan-id migration. Old catalog had jump_starter and early; map them
// onto the closest equivalents in the new 5-tier so existing subscriptions
// (and the seed data) don't break on the next ensureSubscription call.
const LEGACY_MAP: Record<string, string> = {
  jump_starter: 'starter',
  early: 'growth',
};
export function migratePlanId(planId: string): string {
  if (LEGACY_MAP[planId]) return LEGACY_MAP[planId];
  if (getPlan(planId)) return planId;
  return DEFAULT_PLAN_ID;
}

export function resolveFeatures(planId: string): FeatureFlags {
  const plan = getPlan(migratePlanId(planId));
  return plan?.feature_flags || {};
}

// Resolve a single feature flag with default false. Used at call sites:
//   if (!hasFeature(plan, 'voice_cloning')) throw new ForbiddenError(...)
export function hasFeature(planId: string, feature: FeatureKey): boolean {
  return !!resolveFeatures(planId)[feature];
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
