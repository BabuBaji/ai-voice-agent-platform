import { ArrowLeftCircle, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

// Sticky strip rendered at the top of DashboardLayout when a super-admin is
// impersonating a tenant. Clicking "Return to admin" restores the original
// platform-admin tokens stashed on user.impersonating and bounces back into
// the super-admin shell. If there's no impersonation in progress this
// component renders nothing — zero footprint on regular tenant sessions.
export function ImpersonationBanner() {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);

  if (!user?.impersonating) return null;

  const restore = () => {
    const { originalAccessToken, originalRefreshToken, originalUser } = user.impersonating!;
    login(originalUser, originalAccessToken, originalRefreshToken);
    window.location.href = '/super-admin';
  };

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-3 sticky top-0 z-40">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="h-4 w-4" />
        <span>Impersonating <b>{user.email}</b> · all actions are logged</span>
      </div>
      <button
        onClick={restore}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-950 text-amber-100 text-xs font-semibold hover:bg-amber-900"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" /> Return to admin
      </button>
    </div>
  );
}
