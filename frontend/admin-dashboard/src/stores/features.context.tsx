import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { billingApi, type ResolvedFeatures } from '@/services/billing.api';
import { useAuthStore } from '@/stores/auth.store';

// Single source of truth for the current tenant's plan + feature flags.
// Mounted near the root so anything in the dashboard can read it via
// useFeature('voice_cloning'). Auto-refreshes on demand (e.g. after a
// successful plan upgrade) so newly-unlocked features appear instantly
// without a page reload.

interface Ctx {
  features: ResolvedFeatures | null;
  loading: boolean;
  refresh: () => Promise<void>;
  has: (key: string) => boolean;
  // Pretty plan name + minimum plan that unlocks a given feature flag.
  // Used by the "Upgrade required" inline blocks.
  requiredPlanFor: (key: string) => string | null;
}

const FeaturesContext = createContext<Ctx>({
  features: null, loading: false,
  refresh: async () => {},
  has: () => false,
  requiredPlanFor: () => null,
});

// Static map of which plan FIRST introduces each capability. Surfaced as
// "Upgrade to <plan>" in the gating UI. Mirrors the catalog in plans.ts.
const FIRST_PLAN_WITH: Record<string, string> = {
  phone_calls: 'Starter', bulk_calls: 'Starter', recording: 'Starter', crm_basic: 'Starter',
  multilingual: 'Growth', advanced_analytics: 'Growth', sentiment_detection: 'Growth',
  webhooks: 'Growth', calendar: 'Growth',
  voice_cloning: 'Pro', lead_scoring: 'Pro', custom_workflows: 'Pro', crm_advanced: 'Pro',
  api_access: 'Pro', multi_team: 'Pro', rbac: 'Pro', whatsapp: 'Pro',
  sso: 'Enterprise', dedicated_support: 'Enterprise', sla: 'Enterprise',
  custom_models: 'Enterprise', on_prem: 'Enterprise', agent_training_from_recordings: 'Enterprise',
};

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const isPlatformAdmin = useAuthStore((s) => !!s.user?.isPlatformAdmin);
  const [features, setFeatures] = useState<ResolvedFeatures | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    // Only tenant users have a tenant-scoped subscription. Platform admins
    // would just 500 here (their JWT carries the synthetic platform tenant).
    if (!isAuthed || isPlatformAdmin) return;
    setLoading(true);
    try {
      const f = await billingApi.getFeatures();
      setFeatures(f);
    } catch {
      // Ignore — UI degrades to "everything locked", which fails closed
    } finally {
      setLoading(false);
    }
  }, [isAuthed, isPlatformAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const value: Ctx = {
    features, loading, refresh,
    has: (key: string) => !!features?.flags[key],
    requiredPlanFor: (key: string) => FIRST_PLAN_WITH[key] || null,
  };

  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): Ctx {
  return useContext(FeaturesContext);
}

// Convenience hook for a single flag — returns true/false.
export function useFeature(key: string): boolean {
  return useContext(FeaturesContext).has(key);
}
