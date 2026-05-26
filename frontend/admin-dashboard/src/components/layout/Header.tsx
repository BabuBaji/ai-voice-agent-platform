import { LogOut, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';

// Page titles shown inline in the global header. Keyed by route prefix.
const PAGE_TITLES: { match: string; title: string; subtitle?: string }[] = [
  { match: '/settings/billing', title: 'Balance & Plans', subtitle: 'View your balance and choose right plan' },
  { match: '/settings/api', title: 'API Access', subtitle: 'Manage your API keys and integrate with the platform' },
  { match: '/settings', title: 'Settings', subtitle: 'Manage your account, team, and platform configuration' },
  { match: '/calls/live', title: 'Live Calls', subtitle: 'In-flight calls with live transcripts, auto-refreshing every 3 seconds' },
  { match: '/calls', title: 'Call Logs', subtitle: 'View and analyze your call history' },
  { match: '/knowledge', title: 'File Management', subtitle: 'Upload and manage documents your agents can search' },
  { match: '/help/contact', title: 'Contact Us', subtitle: 'Send us a message — we usually reply within one business day' },
];

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const page = PAGE_TITLES.find((p) => location.pathname.startsWith(p.match));

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-20">
      {page ? (
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900 tracking-tight leading-tight truncate">{page.title}</h1>
          {page.subtitle && <p className="text-xs text-gray-500 truncate">{page.subtitle}</p>}
        </div>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => window.dispatchEvent(new Event('open-tenant-assistant'))}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-primary-600 to-accent-600 text-white hover:shadow-lg hover:scale-[1.02] transition-all"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Help
        </button>
        <button
          onClick={handleLogout}
          title={user?.name ? `Sign out (${user.name})` : 'Sign out'}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium text-gray-600 hover:text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </header>
  );
}
