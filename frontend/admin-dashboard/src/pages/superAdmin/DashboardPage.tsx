import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, PhoneCall, Bot, Wallet, AlertTriangle, TrendingUp, Loader2,
  Activity, ArrowRight,
} from 'lucide-react';
import { superAdminApi, type DashboardSummary, type DashboardTimeseries } from '@/services/superAdmin.api';
import { kindMeta, relativeTime, collapseRepeats } from '@/utils/activityFormat';

// Every card on the overview is a Link with deep-link query params, so
// "Calls Today" → calls list filtered to today, "Failed Today" → calls list
// filtered to FAILED + today, "Wallet Float" → billing page, etc. The bar
// chart bars also navigate to the calls list pre-filtered to that day.

type Accent = 'amber' | 'sky' | 'emerald' | 'rose' | 'violet';
const accentMap: Record<Accent, string> = {
  amber:   'from-amber-500 to-orange-500',
  sky:     'from-sky-500 to-cyan-500',
  emerald: 'from-emerald-500 to-teal-500',
  rose:    'from-rose-500 to-pink-500',
  violet:  'from-violet-500 to-purple-500',
};

function StatLink({
  to, icon: Icon, label, value, sub, accent = 'amber',
}: {
  to: string; icon: any; label: string; value: string | number; sub?: string; accent?: Accent;
}) {
  return (
    <Link to={to} className="group bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${accentMap[accent]} flex items-center justify-center shadow-md`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-3 inline-flex items-center gap-1 group-hover:text-amber-700">
        Drill in <ArrowRight className="h-3 w-3" />
      </p>
    </Link>
  );
}

export function SuperAdminDashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [series, setSeries] = useState<DashboardTimeseries | null>(null);
  const [recent, setRecent] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, t, a] = await Promise.all([
          superAdminApi.dashboard(),
          superAdminApi.timeseries(),
          superAdminApi.globalActivityFeed({ hours: 24, limit: 12 }),
        ]);
        if (cancelled) return;
        setSummary(s);
        setSeries(t);
        setRecent(a.events);
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || e?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (error || !summary) return <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error}</div>;

  const maxCalls = Math.max(1, ...(series?.days.map((d) => d.calls) || [1]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform overview</h1>
          <p className="text-sm text-slate-500 mt-1">Click any card to drill into the underlying data</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          identity · conversation · agent — healthy
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatLink to="/super-admin/tenants" icon={Building2} label="Total Tenants" value={summary.tenants.total}
          sub={`${summary.tenants.active} active · +${summary.tenants.new_today} today`} accent="amber" />
        <StatLink to={`/super-admin/calls?since=${today}`} icon={PhoneCall} label="Calls Today" value={summary.calls.today}
          sub={`${summary.calls.minutes_today}m talk time`} accent="sky" />
        <StatLink to="/super-admin/agents?status=ACTIVE" icon={Bot} label="Active Agents" value={summary.agents.active}
          sub={`${summary.agents.total} total`} accent="emerald" />
        <StatLink to="/super-admin/billing" icon={Wallet} label="Wallet Float" value={`₹${summary.revenue.total_wallet_balance_inr.toLocaleString()}`}
          sub={`${summary.revenue.wallet_count} wallets`} accent="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatLink to="/super-admin/calls" icon={TrendingUp} label="Calls This Month" value={summary.calls.this_month}
          sub={`${summary.calls.minutes_month}m total`} accent="sky" />
        <StatLink to={`/super-admin/calls?status=FAILED&since=${today}`} icon={AlertTriangle} label="Failed Today" value={summary.calls.failed_today}
          sub={summary.calls.failed_today === 0 ? 'no failures' : 'investigate'} accent="rose" />
        <StatLink to="/super-admin/tenants?status=active" icon={Building2} label="New This Month" value={summary.tenants.new_month}
          sub="signups" accent="emerald" />
      </div>

      {/* Calls/day chart — bars are clickable, drilling into that exact day */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-900">Calls — last 14 days</h3>
          <p className="text-[11px] text-slate-500">Click a bar to filter call list to that day</p>
        </div>
        <div className="flex items-end gap-1.5 h-32">
          {(series?.days || []).map((d) => (
            <button
              key={d.day}
              onClick={() => navigate(`/super-admin/calls?since=${d.day.slice(0, 10)}`)}
              className="flex-1 flex flex-col items-center gap-1 group"
              title={`${d.calls} calls · ${d.minutes}m — click to view`}
            >
              <div
                className="w-full rounded-t bg-gradient-to-t from-amber-500 to-orange-400 group-hover:from-amber-600 group-hover:to-orange-500 transition-colors"
                style={{ height: `${(d.calls / maxCalls) * 100}%`, minHeight: d.calls > 0 ? 4 : 0 }}
              />
              <span className="text-[9px] text-slate-400 group-hover:text-amber-700">{d.day.slice(5, 10)}</span>
            </button>
          ))}
          {(series?.days || []).length === 0 && (
            <div className="text-sm text-slate-400 w-full text-center">No call data yet</div>
          )}
        </div>
      </div>

      {/* Recent activity preview — collapses repeats, full feed at /super-admin/activity */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900">Recent platform activity</h3>
            <span className="text-[10px] text-slate-400">last 24h</span>
          </div>
          <Link to="/super-admin/activity" className="text-xs text-amber-700 hover:underline inline-flex items-center gap-1">
            See full feed <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {!recent || recent.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">No activity in the last 24 hours.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {collapseRepeats(recent).slice(0, 8).map((e, i) => {
              const meta = kindMeta(e.kind);
              return (
                <li key={i} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/50">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                    <meta.icon className={`h-4 w-4 ${meta.fg}`} />
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                    <p className="col-span-7 text-sm text-slate-800 truncate">
                      <span className="font-medium">{e.actor || e.summary}</span>
                      <span className="text-slate-500 font-normal">{e.action ? ` ${e.action}` : ''}</span>
                      {e.count > 1 && (
                        <span className="ml-2 text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          ×{e.count}
                        </span>
                      )}
                    </p>
                    <div className="col-span-3 text-xs text-slate-500 truncate">
                      {e.tenant_id ? (
                        <Link to={`/super-admin/tenants/${e.tenant_id}`} className="text-amber-700 hover:underline truncate">
                          {e.tenant_name || e.tenant_id.slice(0, 8)}
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </div>
                    <p className="col-span-2 text-right text-[11px] text-slate-500 font-mono whitespace-nowrap" title={new Date(e.ts).toLocaleString()}>
                      {relativeTime(e.ts)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Link to="/super-admin/tenants" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-slate-700">Manage tenants →</p>
          <p className="text-xs text-slate-500 mt-1">Suspend, impersonate, adjust wallet</p>
        </Link>
        <Link to="/super-admin/audit-logs" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-slate-700">Audit log →</p>
          <p className="text-xs text-slate-500 mt-1">Every super-admin action</p>
        </Link>
        <Link to="/super-admin/integrations" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-slate-700">Integrations →</p>
          <p className="text-xs text-slate-500 mt-1">Provider keys + tenant installs</p>
        </Link>
      </div>
    </div>
  );
}

