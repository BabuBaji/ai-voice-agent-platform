import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, ChevronLeft, ChevronRight, Search, X, Download } from 'lucide-react';
import { superAdminApi, downloadCsv, type AgentRow } from '@/services/superAdmin.api';

export function SuperAdminAgentsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '';
  const status = params.get('status') || 'all';
  const tenantId = params.get('tenant_id') || '';

  const [rows, setRows] = useState<AgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<any>(null);
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
      const r = await superAdminApi.agents({ page, limit: 25, search: search || undefined, status, tenant_id: tenantId || undefined });
      setRows(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, search, status, tenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.agentsStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [search, status, tenantId]);

  const totalPages = Math.max(1, Math.ceil(total / 25));
  const hasFilters = search || status !== 'all' || tenantId;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agents</h1>
          <p className="text-sm text-slate-500 mt-1">{total} agents match the current filters</p>
        </div>
        <button
          onClick={() => downloadCsv(`agents-${new Date().toISOString().slice(0,10)}.csv`, rows, [
            { key: 'id', label: 'Agent ID' },
            { key: 'name', label: 'Name' },
            { key: 'tenant_id', label: 'Tenant ID' },
            { key: 'tenant_name', label: 'Tenant' },
            { key: 'status', label: 'Status' },
            { key: 'direction', label: 'Direction' },
            { key: 'llm_provider', label: 'LLM provider' },
            { key: 'llm_model', label: 'LLM model' },
            { key: 'cost_per_min', label: '₹/min' },
            { key: 'total_calls', label: 'Total calls' },
            { key: 'created_at', label: 'Created' },
          ])}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Analytics strip */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">By status</p>
            <div className="mt-1.5 space-y-0.5">
              {stats.by_status.map((s: any) => (
                <button key={s.status} onClick={() => setFilter('status', s.status)} className="w-full flex justify-between text-xs hover:text-amber-700">
                  <span>{s.status}</span><span className="font-mono">{s.n}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Top LLM providers</p>
            <div className="mt-1.5 space-y-0.5">
              {stats.by_provider.slice(0, 4).map((p: any) => (
                <div key={p.llm_provider} className="flex justify-between text-xs">
                  <span>{p.llm_provider}</span><span className="font-mono">{p.n}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Cost per minute (₹)</p>
            <p className="text-xl font-bold text-slate-900">
              {stats.cost_per_min.avg ? `₹${stats.cost_per_min.avg.toFixed(2)}` : '—'}
            </p>
            <p className="text-[10px] text-slate-400">
              avg · range ₹{stats.cost_per_min.min ?? 0}–₹{stats.cost_per_min.max ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Top tenants by agent count</p>
            <div className="mt-1.5 space-y-0.5">
              {stats.top_tenants.slice(0, 3).map((t: any) => (
                <button key={t.tenant_id} onClick={() => setFilter('tenant_id', t.tenant_id)} className="w-full flex justify-between text-xs hover:text-amber-700">
                  <span className="font-mono truncate">{t.tenant_id.slice(0, 8)}</span><span className="font-mono">{t.n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Search agent name…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
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
          <div className="text-center py-16 text-sm text-slate-400">No agents found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Direction</th>
                <th className="text-left px-4 py-3 font-medium">LLM</th>
                <th className="text-right px-4 py-3 font-medium">Calls</th>
                <th className="text-right px-4 py-3 font-medium">₹/min</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{a.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{a.id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">{a.tenant_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${a.status === 'ACTIVE' || a.status === 'PUBLISHED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{a.direction}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{a.llm_provider || '—'} <span className="text-slate-400">/ {a.llm_model || '—'}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{a.total_calls}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{a.cost_per_min ? `₹${a.cost_per_min.toFixed(2)}` : '—'}</td>
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
