import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useFeatures } from '@/stores/features.context';

// Subtle inline banner version of FeatureGate. Doesn't hide content — sits
// at the top of a page when a feature isn't unlocked, nudging the user to
// upgrade. Renders nothing when the feature IS unlocked.
export function UpgradeBanner({ flag, label, sub }: { flag: string; label: string; sub?: string }) {
  const { features, has, requiredPlanFor } = useFeatures();
  if (!features) return null;        // not loaded / not a tenant user
  if (has(flag)) return null;         // feature unlocked, no nudge needed
  const required = requiredPlanFor(flag) || 'a higher';
  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">{label} requires {required}</p>
        {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
        {!sub && <p className="text-xs text-slate-600 mt-0.5">You're on {features.plan_name} — upgrade to use this.</p>}
      </div>
      <Link to="/settings/pricing"
        className="text-xs px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold inline-flex items-center gap-1 whitespace-nowrap">
        Upgrade <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
