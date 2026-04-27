import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Loader2, Wallet, TrendingUp, RefreshCw, Calendar, Crown, X, Download,
  ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react';
import { superAdminApi, downloadCsv } from '@/services/superAdmin.api';

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  trialing: 'bg-sky-100 text-sky-700',
  canceled: 'bg-slate-100 text-slate-600',
  past_due: 'bg-rose-100 text-rose-700',
};

export function SuperAdminSubscriptionsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const planFilter   = params.get('plan')   || '';
  const statusFilter = params.get('status') || '';

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showSide, setShowSide] = useState(true);

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (!v) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    setLoading(true);
    superAdminApi.subscriptions({ plan: planFilter || undefined, status: statusFilter || undefined })
      .then(setData)
      .finally(() => setLoading(false));
  }, [planFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const visibleRows = data?.data || [];
  const totalRevenue = useMemo(
    () => visibleRows.reduce((s: number, r: any) => s + (r.status === 'active' ? Number(r.price || 0) : 0), 0),
    [visibleRows],
  );

  if (loading && !data) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (!data) return null;

  const exportCsv = () => {
    downloadCsv(`subscriptions-${new Date().toISOString().slice(0,10)}.csv`, visibleRows, [
      { key: 'tenant_name', label: 'Tenant' },
      { key: 'tenant_id',   label: 'Tenant ID' },
      { key: 'owner_email', label: 'Owner email' },
      { key: 'plan_name',   label: 'Plan' },
      { key: 'plan_id',     label: 'Plan ID' },
      { key: 'price',       label: 'Price (₹/mo)' },
      { key: 'status',      label: 'Status' },
      { key: 'auto_renew',  label: 'Auto-renew', render: (r) => r.auto_renew ? 'yes' : 'no' },
      { key: 'next_renewal_date', label: 'Next renewal' },
      { key: 'wallet_balance', label: 'Wallet (₹)' },
      { key: 'last_login_at', label: 'Last login' },
      { key: 'created_at',  label: 'Subscribed at' },
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Crown className="h-6 w-6 text-amber-500" /> Subscriptions
          </h1>
          <p className="text-sm text-slate-500 mt-1">Every tenant's current plan, renewal status, and contribution to MRR</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={exportCsv} className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Top stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat icon={Wallet}      label="MRR"             value={`₹${Number(data.totals.mrr).toLocaleString()}`}      sub="across active subs" accent="emerald" />
        <Stat icon={TrendingUp}  label="ARR (projected)" value={`₹${Number(data.totals.arr).toLocaleString()}`}      sub="MRR × 12"           accent="sky" />
        <Stat icon={Crown}       label="Paid tenants"    value={data.totals.paid_count}                              sub="price > ₹0"         accent="amber" />
        <Stat icon={Sparkles}    label="Free tenants"    value={data.totals.free_count}                                                       accent="violet" />
        <Stat icon={X}           label="Canceled"        value={data.totals.canceled_count}                                                   accent="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Plan distribution */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">MRR by plan</h3>
          {data.plan_distribution.length === 0 ? (
            <p className="text-sm text-slate-400">No active subscriptions yet.</p>
          ) : (
            <div className="space-y-2">
              {data.plan_distribution.map((p: any) => {
                const max = Math.max(...data.plan_distribution.map((x: any) => Number(x.mrr_contribution || 0)));
                const pct = max > 0 ? (Number(p.mrr_contribution || 0) / max) * 100 : 0;
                return (
                  <button key={p.plan_id} onClick={() => setFilter('plan', p.plan_id)} className="w-full text-left">
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-slate-700 hover:text-amber-700">
                        <span className="font-semibold">{p.plan_name}</span>
                        <span className="text-slate-500 ml-2">· {p.tenant_count} tenant{p.tenant_count === 1 ? '' : 's'}</span>
                      </span>
                      <span className="font-mono font-medium text-slate-900">₹{Number(p.mrr_contribution || 0).toLocaleString()}/mo</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded">
                      <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded" style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming renewals */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-amber-500" /> Renewals (next 7 days)
          </h3>
          {data.upcoming_renewals.length === 0 ? (
            <p className="text-xs text-slate-400">No renewals scheduled this week.</p>
          ) : (
            <ul className="space-y-1">
              {data.upcoming_renewals.map((r: any) => (
                <li key={r.tenant_id} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                  <Link to={`/super-admin/tenants/${r.tenant_id}`} className="text-slate-800 hover:text-amber-700 truncate max-w-[160px]">
                    {r.tenant_name}
                  </Link>
                  <div className="text-right">
                    <p className="font-mono text-slate-900">₹{Number(r.price).toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400">{new Date(r.next_renewal_date).toLocaleDateString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Filter strip */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 font-medium">Filter:</span>
        <select value={planFilter} onChange={(e) => setFilter('plan', e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="">All plans</option>
          {data.plan_distribution.map((p: any) => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="canceled">Canceled</option>
          <option value="past_due">Past due</option>
          <option value="trialing">Trialing</option>
        </select>
        {(planFilter || statusFilter) && (
          <button onClick={() => setParams({}, { replace: true })} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-slate-500">
          {visibleRows.length} subscription{visibleRows.length === 1 ? '' : 's'} · matching MRR ₹{totalRevenue.toLocaleString()}
        </span>
      </div>

      {/* Main table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Tenant</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-right px-4 py-3 font-medium">Price</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-center px-4 py-3 font-medium">Auto-renew</th>
              <th className="text-left px-4 py-3 font-medium">Next renewal</th>
              <th className="text-right px-4 py-3 font-medium">Wallet</th>
              <th className="text-left px-4 py-3 font-medium">Subscribed</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-sm text-slate-400">No subscriptions match these filters.</td></tr>
            ) : visibleRows.map((s: any) => (
              <tr key={s.tenant_id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                onClick={() => navigate(`/super-admin/tenants/${s.tenant_id}`)}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900 truncate">{s.tenant_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{s.tenant_slug} · {s.owner_email || 'no owner'}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{s.plan_name}</p>
                  <p className="text-[10px] text-slate-400">{s.billing_cycle}</p>
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-900 font-semibold">
                  {s.price > 0 ? `₹${Number(s.price).toLocaleString()}` : <span className="text-slate-400 font-normal">free</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status] || 'bg-slate-100 text-slate-600'}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-xs">
                  {s.auto_renew ? <span className="text-emerald-700">✓</span> : <span className="text-slate-400">—</span>}
                  {s.cancel_at_period_end && <span className="text-rose-600 text-[10px] ml-1">(canceling)</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-700">
                  {s.next_renewal_date ? new Date(s.next_renewal_date).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  <span className={s.wallet_balance <= 0 ? 'text-rose-600 font-bold' : 'text-slate-700'}>
                    ₹{Number(s.wallet_balance || 0).toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{new Date(s.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Side feeds: newest paid subs + recent plan changes */}
      <button onClick={() => setShowSide((v) => !v)} className="text-xs text-slate-600 inline-flex items-center gap-1 hover:text-slate-900">
        {showSide ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {showSide ? 'Hide' : 'Show'} recent activity feeds
      </button>
      {showSide && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Newest paid subscriptions</h3>
            {data.newest_paid_subscriptions.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : (
              <ul className="space-y-1">
                {data.newest_paid_subscriptions.map((r: any, i: number) => (
                  <li key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                    <Link to={`/super-admin/tenants/${r.tenant_id}`} className="text-slate-800 hover:text-amber-700 truncate max-w-[200px]">
                      {r.tenant_name}
                    </Link>
                    <div className="text-right">
                      <p className="font-mono">{r.plan_name} · ₹{Number(r.price).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">{new Date(r.created_at).toLocaleDateString()}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Recent plan changes</h3>
            {data.recent_plan_changes.length === 0 ? <p className="text-xs text-slate-400">No upgrades/downgrades yet.</p> : (
              <ul className="space-y-1">
                {data.recent_plan_changes.map((r: any, i: number) => (
                  <li key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                    <Link to={`/super-admin/tenants/${r.tenant_id}`} className="text-slate-800 hover:text-amber-700 truncate max-w-[200px]">
                      {r.tenant_name}
                    </Link>
                    <div className="text-right">
                      <p className="font-mono">→ {r.plan_name}</p>
                      <p className="text-[10px] text-slate-400">{new Date(r.updated_at).toLocaleString()}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: any; sub?: string; accent: string }) {
  const accentMap: Record<string, string> = {
    amber: 'from-amber-500 to-orange-500',
    sky: 'from-sky-500 to-cyan-500',
    emerald: 'from-emerald-500 to-teal-500',
    rose: 'from-rose-500 to-pink-500',
    violet: 'from-violet-500 to-purple-500',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
          {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
        </div>
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${accentMap[accent]} flex items-center justify-center shadow`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </div>
    </div>
  );
}
