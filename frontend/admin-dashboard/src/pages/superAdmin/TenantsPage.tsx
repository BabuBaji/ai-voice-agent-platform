import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Loader2, ChevronLeft, ChevronRight, Eye, X, Download, ShieldAlert } from 'lucide-react';
import { superAdminApi, downloadCsv, type TenantListRow } from '@/services/superAdmin.api';

export function SuperAdminTenantsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const search = params.get('search') || '';
  const plan   = params.get('plan')   || 'all';
  const status = params.get('status') || 'all';

  const [rows, setRows] = useState<TenantListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [stats, setStats] = useState<any>(null);
  const [healthMap, setHealthMap] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);

  const setFilter = (key: string, val: string) => {
    const next = new URLSearchParams(params);
    if (!val || val === 'all') next.delete(key);
    else next.set(key, val);
    setParams(next, { replace: true });
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await superAdminApi.tenants({ page, limit, search: search || undefined, plan, status });
      setRows(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, plan, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.tenantsStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => {
    superAdminApi.healthScores()
      .then((r) => setHealthMap(new Map(r.data.map((h) => [h.tenant_id, h]))))
      .catch(() => {});
  }, []);
  useEffect(() => { setPage(1); }, [search, plan, status]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = search || plan !== 'all' || status !== 'all';

  const exportCsv = () => {
    downloadCsv(`tenants-${new Date().toISOString().slice(0,10)}.csv`, rows, [
      { key: 'id',          label: 'Tenant ID' },
      { key: 'name',        label: 'Name' },
      { key: 'slug',        label: 'Slug' },
      { key: 'plan',        label: 'Plan' },
      { key: 'company_size', label: 'Company size', render: (r) => r.company_size || '' },
      { key: 'is_active',   label: 'Active', render: (r) => r.is_active ? 'yes' : 'no' },
      { key: 'wallet_balance', label: 'Wallet (₹)' },
      { key: 'user_count',  label: 'Users' },
      { key: 'owner_email', label: 'Owner email' },
      { key: 'last_login_at', label: 'Last login' },
      { key: 'created_at',  label: 'Created' },
      { key: 'health_score', label: 'Health score', render: (r) => healthMap.get(r.id)?.score ?? '' },
      { key: 'health_flag',  label: 'Health flag',  render: (r) => healthMap.get(r.id)?.flag  ?? '' },
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tenants</h1>
          <p className="text-sm text-slate-500 mt-1">{total} customers match the current filters</p>
        </div>
        <button onClick={exportCsv} className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Analytics strip */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <button onClick={() => setFilter('status', 'active')} className="bg-white border border-slate-200 rounded-2xl p-3 text-left hover:border-emerald-300">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Active</p>
            <p className="text-xl font-bold text-emerald-700">{stats.active}</p>
          </button>
          <button onClick={() => setFilter('status', 'suspended')} className="bg-white border border-slate-200 rounded-2xl p-3 text-left hover:border-rose-300">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Suspended</p>
            <p className="text-xl font-bold text-rose-700">{stats.suspended}</p>
          </button>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">New today</p>
            <p className="text-xl font-bold text-slate-900">{stats.new_today}</p>
            <p className="text-[10px] text-slate-400">{stats.new_week} this week</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Wallet float</p>
            <p className="text-xl font-bold text-slate-900">₹{Number(stats.wallet.total).toLocaleString()}</p>
            <p className="text-[10px] text-slate-400">{stats.wallet.count} wallets</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">By plan</p>
            <div className="mt-1 space-y-0.5">
              {stats.plan_distribution.map((p: any) => (
                <button key={p.plan} onClick={() => setFilter('plan', p.plan)} className="w-full flex justify-between text-xs hover:text-amber-700">
                  <span className="capitalize">{p.plan}</span><span className="font-mono">{p.n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search name or slug…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
        </div>
        <select value={plan} onChange={(e) => setFilter('plan', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {hasFilters && (
          <button onClick={() => setParams({}, { replace: true })}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400">No tenants match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">Owner</th>
                <th className="text-left px-4 py-3 font-medium">Plan</th>
                <th className="text-left px-4 py-3 font-medium">Size</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Health</th>
                <th className="text-right px-4 py-3 font-medium">Wallet</th>
                <th className="text-right px-4 py-3 font-medium">Users</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{t.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{t.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{t.owner_email || '—'}</td>
                  <td className="px-4 py-3"><span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600">{t.plan}</span></td>
                  <td className="px-4 py-3">
                    {t.company_size ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{t.company_size}</span>
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      t.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>{t.is_active ? 'Active' : 'Suspended'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const h = healthMap.get(t.id);
                      if (!h) return <span className="text-[10px] text-slate-400">—</span>;
                      const colorMap = { green: 'bg-emerald-100 text-emerald-700', yellow: 'bg-amber-100 text-amber-700', red: 'bg-rose-100 text-rose-700' };
                      return (
                        <span title={h.reasons.join(' · ') || 'healthy'}
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorMap[h.flag as keyof typeof colorMap]}`}>
                          {h.flag === 'red' && <ShieldAlert className="h-3 w-3" />} {h.score}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">₹{t.wallet_balance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{t.user_count}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/super-admin/tenants/${t.id}`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-medium"
                    >
                      <Eye className="h-3 w-3" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500">Showing {rows.length} of {total}</p>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-slate-600">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
