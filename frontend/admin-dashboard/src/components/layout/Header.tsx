import { LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';

// Page titles shown inline in the global header. Keyed by route prefix.
const PAGE_TITLES: { match: string; title: string; subtitle?: string }[] = [
  { match: '/settings/billing', title: 'Balance & Plans', subtitle: 'View your balance and choose right plan' },
  { match: '/settings/api', title: 'API Access', subtitle: 'Manage your API keys and integrate with the platform' },
  { match: '/settings', title: 'Settings', subtitle: 'Manage your account, team, and platform configuration' },
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
      <button
        onClick={handleLogout}
        title={user?.name ? `Sign out (${user.name})` : 'Sign out'}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium text-gray-600 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </header>
  );
}
