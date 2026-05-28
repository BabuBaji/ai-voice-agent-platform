import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, ChevronLeft, ChevronRight, Search, X, Download,
  RefreshCw, ArrowUpDown, ChevronDown, Clock, Copy, Bot, Phone, IndianRupee,
} from 'lucide-react';
import { superAdminApi, downloadCsv, type AgentRow } from '@/services/superAdmin.api';

// Compact summary chip used in the table toolbar.
function SummaryChip({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
      <Icon className="h-3 w-3 text-slate-400" />
      <span className="text-slate-400 uppercase tracking-wider text-[10px]">{label}</span>
      <span className="font-semibold text-slate-700">{value}</span>
    </span>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</div>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  );
}
function DetailMono({ label, value, onCopy, copied }: { label: string; value: string; onCopy?: () => void; copied?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-slate-700 truncate">{value}</span>
        {onCopy && <button onClick={onCopy} title="Copy" className="text-slate-400 hover:text-amber-600 flex-shrink-0"><Copy className="h-3 w-3" /></button>}
        {copied && <span className="text-[10px] text-emerald-600">copied</span>}
      </div>
    </div>
  );
}

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

  // Advanced client-side table controls (additive — server filters untouched).
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'total_calls' | 'cost_per_min'>('total_calls');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };
  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).then(() => { setCopiedId(id); setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200); }).catch(() => {});
  };

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
  useEffect(() => { if (!loading) setLastLoaded(new Date()); }, [rows, loading]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { load(); }, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Client-side filter + sort over the loaded page.
  const displayRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = rows;
    if (q) r = r.filter((a) => [a.name, a.tenant_name, a.tenant_id, a.status, a.direction, a.llm_provider, a.llm_model]
      .some((v) => String(v || '').toLowerCase().includes(q)));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => {
      if (sortKey === 'name') return String(a.name || '').localeCompare(String(b.name || '')) * dir;
      if (sortKey === 'cost_per_min') return ((a.cost_per_min || 0) - (b.cost_per_min || 0)) * dir;
      return ((a.total_calls || 0) - (b.total_calls || 0)) * dir;
    });
  }, [rows, query, sortKey, sortDir]);
  const summary = useMemo(() => {
    const calls = displayRows.reduce((s, a) => s + (a.total_calls || 0), 0);
    const costs = displayRows.map((a) => a.cost_per_min || 0).filter((c) => c > 0);
    const active = displayRows.filter((a) => a.status === 'ACTIVE' || a.status === 'PUBLISHED').length;
    return { count: displayRows.length, calls, active, avgCost: costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : 0 };
  }, [displayRows]);

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

      {/* ── Advanced table toolbar (client search, sort, auto-refresh, summary) ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Refine this page — tenant, provider, model, status…"
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 text-sm" />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="inline-flex items-center gap-1 text-xs">
          <span className="text-slate-400 uppercase tracking-wider text-[10px]">Sort</span>
          {([['total_calls', 'Calls'], ['cost_per_min', '₹/min'], ['name', 'Name']] as const).map(([k, label]) => (
            <button key={k} onClick={() => toggleSort(k)}
              className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 ${sortKey === k ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}>
              {label}{sortKey === k && <ArrowUpDown className="h-3 w-3" />}
            </button>
          ))}
        </div>
        <button onClick={() => setAutoRefresh((a) => !a)}
          className={`text-xs px-2.5 py-2 rounded-lg border inline-flex items-center gap-1.5 ${autoRefresh ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} /> Auto {autoRefresh ? 'on' : 'off'}
        </button>
        <button onClick={() => load()} className="text-xs px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        {lastLoaded && <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Clock className="h-3 w-3" />{lastLoaded.toLocaleTimeString()}</span>}
        <div className="w-full flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 mt-1">
          <SummaryChip icon={Bot} label="Shown" value={summary.count} />
          <SummaryChip icon={Bot} label="Active" value={summary.active} />
          <SummaryChip icon={Phone} label="Total calls" value={summary.calls.toLocaleString()} />
          <SummaryChip icon={IndianRupee} label="Avg ₹/min" value={summary.avgCost ? `₹${summary.avgCost.toFixed(2)}` : '—'} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : displayRows.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400">{query ? `No agents match “${query}” on this page.` : 'No agents found.'}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">
                  <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-slate-700">Name {sortKey === 'name' && <ArrowUpDown className="h-3 w-3 text-amber-500" />}</button>
                </th>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Direction</th>
                <th className="text-left px-4 py-3 font-medium">LLM</th>
                <th className="text-right px-4 py-3 font-medium">
                  <button onClick={() => toggleSort('total_calls')} className="inline-flex items-center gap-1 hover:text-slate-700 ml-auto">Calls {sortKey === 'total_calls' && <ArrowUpDown className="h-3 w-3 text-amber-500" />}</button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button onClick={() => toggleSort('cost_per_min')} className="inline-flex items-center gap-1 hover:text-slate-700 ml-auto">₹/min {sortKey === 'cost_per_min' && <ArrowUpDown className="h-3 w-3 text-amber-500" />}</button>
                </th>
                <th className="px-4 py-3 w-1" />
              </tr>
            </thead>
            <tbody>
              {displayRows.map((a) => {
                const open = expandedId === a.id;
                return (
                  <Fragment key={a.id}>
                    <tr className={`border-t border-slate-100 hover:bg-slate-50/60 ${open ? 'bg-amber-50/40' : ''}`}>
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
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setExpandedId(open ? null : a.id)} title="Details" className="inline-flex items-center px-1.5 py-0.5 rounded-md hover:bg-slate-100 text-slate-500">
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-amber-50/30 border-t border-amber-100">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <Detail label="Direction" value={a.direction || '—'} />
                            <Detail label="LLM" value={`${a.llm_provider || '—'} / ${a.llm_model || '—'}`} />
                            <Detail label="Total calls" value={String(a.total_calls ?? 0)} />
                            <Detail label="Cost / min" value={a.cost_per_min ? `₹${a.cost_per_min.toFixed(2)}` : '—'} />
                            <Detail label="Created" value={(a as any).created_at ? new Date((a as any).created_at).toLocaleString() : '—'} />
                            <DetailMono label="Agent ID" value={a.id} copied={copiedId === a.id} onCopy={() => copyId(a.id)} />
                            <DetailMono label="Tenant ID" value={a.tenant_id || '—'} copied={copiedId === a.tenant_id} onCopy={a.tenant_id ? () => copyId(a.tenant_id) : undefined} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500">Showing {displayRows.length}{query ? ' filtered' : ''} of {total}</p>
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
