import { Link } from 'react-router-dom';
import { Lock, Sparkles, ArrowRight } from 'lucide-react';
import { useFeatures } from '@/stores/features.context';

// Wraps a feature behind its plan's flag. If the current tenant's plan
// doesn't include `flag`, render an "Upgrade required" call-out instead of
// the children. If it does, just render children. Single line at the call site:
//   <FeatureGate flag="voice_cloning"><CloneStudio /></FeatureGate>

interface Props {
  flag: string;
  children: React.ReactNode;
  // Override the default upgrade pitch — useful when context matters (e.g.
  // "Voice cloning is part of Pro" vs. "API access is part of Pro").
  feature_label?: string;
  // Compact variant — inline pill instead of a full block. Used on small
  // surfaces (a button, a sidebar item).
  compact?: boolean;
}

export function FeatureGate({ flag, children, feature_label, compact }: Props) {
  const { features, has, requiredPlanFor, loading } = useFeatures();

  // Quietly hide the gate while features are still loading on first paint —
  // showing an "upgrade required" flash for half a second is worse than a
  // brief blank.
  if (loading && !features) return null;

  // Super admins / unauthenticated users have no resolved feature set.
  // Default to allowing — the routes themselves are protected elsewhere.
  if (!features) return <>{children}</>;

  if (has(flag)) return <>{children}</>;

  const required = requiredPlanFor(flag) || 'a higher';
  const label = feature_label || flag.replace(/_/g, ' ');

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase tracking-wider">
        <Lock className="h-3 w-3" /> {required}+ only
      </span>
    );
  }

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-2xl p-7 text-center">
      <div className="w-12 h-12 mx-auto bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-md">
        <Sparkles className="h-6 w-6 text-white" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">
        {label.charAt(0).toUpperCase() + label.slice(1)} is part of {required}
      </h3>
      <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
        Your current plan ({features.plan_name}) doesn't include this feature. Upgrade to unlock it.
      </p>
      <Link to={`/settings/pricing`}
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold rounded-xl shadow hover:shadow-md">
        Upgrade to {required} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

// Small "Locked" pill for nav items — caller decides whether to render the
// item at all or just decorate it.
export function FeatureLockBadge({ flag, plan }: { flag: string; plan?: string }) {
  const { has, requiredPlanFor } = useFeatures();
  if (has(flag)) return null;
  const req = plan || requiredPlanFor(flag);
  if (!req) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-wider">
      <Lock className="h-2.5 w-2.5" /> {req}+
    </span>
  );
}
