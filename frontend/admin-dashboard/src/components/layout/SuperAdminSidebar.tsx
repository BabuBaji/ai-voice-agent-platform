import { NavLink, useNavigate } from 'react-router-dom';
import {
  Shield, LayoutDashboard, Building2, PhoneCall, Bot, CreditCard,
  ScrollText, Plug, LogOut, Activity, AlertTriangle, TrendingDown,
  Webhook, Megaphone, Lock, Crown,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type Item = { label: string; path: string; icon: any; end?: boolean };
const sections: Array<{ title?: string; items: Item[] }> = [
  { items: [
    { label: 'Overview',     path: '/super-admin',              icon: LayoutDashboard, end: true },
    { label: 'Activity',     path: '/super-admin/activity',     icon: Activity },
    { label: 'Alerts',       path: '/super-admin/alerts',       icon: AlertTriangle },
  ]},
  { title: 'Operations', items: [
    { label: 'Tenants',      path: '/super-admin/tenants',      icon: Building2 },
    { label: 'Calls',        path: '/super-admin/calls',        icon: PhoneCall },
    { label: 'Failed calls', path: '/super-admin/failed-calls', icon: AlertTriangle },
    { label: 'Agents',       path: '/super-admin/agents',       icon: Bot },
  ]},
  { title: 'Money', items: [
    { label: 'Subscriptions', path: '/super-admin/subscriptions', icon: Crown },
    { label: 'Billing',       path: '/super-admin/billing',       icon: CreditCard },
    { label: 'Cost analysis', path: '/super-admin/cost',          icon: TrendingDown },
  ]},
  { title: 'Admin tools', items: [
    { label: 'Audit Logs',   path: '/super-admin/audit-logs',   icon: ScrollText },
    { label: 'Integrations', path: '/super-admin/integrations', icon: Plug },
    { label: 'Webhooks',     path: '/super-admin/webhooks',     icon: Webhook },
    { label: 'Broadcasts',   path: '/super-admin/broadcasts',   icon: Megaphone },
    { label: '2FA',          path: '/super-admin/2fa',          icon: Lock },
  ]},
];

export function SuperAdminSidebar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/super-admin/login', { replace: true });
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[230px] bg-slate-950 text-slate-200 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center shadow-md shadow-amber-500/20">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-tight">Platform Admin</p>
          <p className="text-[10px] uppercase tracking-wider text-amber-300/80">Super Admin</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-3 overflow-y-auto">
        {sections.map((s, i) => (
          <div key={i}>
            {s.title && <p className="px-3 mb-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{s.title}</p>}
            <div className="space-y-0.5">
              {s.items.map((it) => (
                <NavLink
                  key={it.path}
                  to={it.path}
                  end={it.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-amber-500/15 text-amber-200 font-medium'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`
                  }
                >
                  <it.icon className="h-[18px] w-[18px]" />
                  {it.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-slate-800">
        <div className="px-3 pb-2 text-xs text-slate-400 truncate">{user?.email}</div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors"
        >
          <LogOut className="h-[18px] w-[18px]" /> Sign out
        </button>
      </div>
    </aside>
  );
}
