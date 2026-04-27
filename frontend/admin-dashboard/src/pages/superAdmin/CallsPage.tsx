import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ChevronLeft, ChevronRight, Eye, Search, X, Download } from 'lucide-react';
import { superAdminApi, downloadCsv, type CallRow } from '@/services/superAdmin.api';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-700',
  ENDED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
};

export function SuperAdminCallsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Filters are URL-bound, so deep links from the dashboard / external bookmarks
  // restore the same view. ?since=YYYY-MM-DD, ?status=FAILED, ?channel=PHONE,
  // ?tenant_id=<uuid>.
  const tenantId = params.get('tenant_id') || '';
  const status   = params.get('status')    || 'all';
  const channel  = params.get('channel')   || 'all';
  const since    = params.get('since')     || '';

  const [rows, setRows] = useState<CallRow[]>([]);
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
      const r = await superAdminApi.calls({
        page, limit: 25,
        tenant_id: tenantId || undefined,
        status, channel,
        since: since || undefined,
      });
      setRows(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, tenantId, status, channel, since]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.callsStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [tenantId, status, channel, since]);

  const totalPages = Math.max(1, Math.ceil(total / 25));
  const hasFilters = tenantId || (status !== 'all') || (channel !== 'all') || since;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calls</h1>
          <p className="text-sm text-slate-500 mt-1">{total} calls match the current filters</p>
        </div>
        <button
          onClick={() => downloadCsv(`calls-${new Date().toISOString().slice(0,10)}.csv`, rows, [
            { key: 'id', label: 'Call ID' },
            { key: 'tenant_id', label: 'Tenant ID' },
            { key: 'tenant_name', label: 'Tenant' },
            { key: 'agent_id', label: 'Agent ID' },
            { key: 'channel', label: 'Channel' },
            { key: 'status', label: 'Status' },
            { key: 'caller_number', label: 'From' },
            { key: 'called_number', label: 'To' },
            { key: 'started_at', label: 'Started' },
            { key: 'ended_at', label: 'Ended' },
            { key: 'duration_seconds', label: 'Duration (s)' },
            { key: 'outcome', label: 'Outcome' },
            { key: 'sentiment', label: 'Sentiment' },
          ])}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Analytics strip */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MiniStat label="Today"     value={stats.today.count}     sub={`${stats.today.minutes}m`} />
          <MiniStat label="Yesterday" value={stats.yesterday.count} />
          <MiniStat label="Last 7 days" value={stats.last7days.count} />
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">By status (7d)</p>
            <div className="mt-1.5 space-y-0.5">
              {stats.by_status.slice(0, 3).map((s: any) => (
                <button key={s.status} onClick={() => setFilter('status', s.status)} className="w-full flex justify-between text-xs hover:text-amber-700">
                  <span>{s.status}</span><span className="font-mono">{s.n}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">By channel (7d)</p>
            <div className="mt-1.5 space-y-0.5">
              {stats.by_channel.slice(0, 3).map((c: any) => (
                <button key={c.channel} onClick={() => setFilter('channel', c.channel)} className="w-full flex justify-between text-xs hover:text-amber-700">
                  <span>{c.channel}</span><span className="font-mono">{c.n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={tenantId} onChange={(e) => setFilter('tenant_id', e.target.value)} placeholder="Tenant ID (UUID) — exact match"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All statuses</option>
          <option value="ENDED">Ended</option>
          <option value="ACTIVE">Active</option>
          <option value="FAILED">Failed</option>
        </select>
        <select value={channel} onChange={(e) => setFilter('channel', e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All channels</option>
          <option value="PHONE">Phone</option>
          <option value="WEB">Web</option>
          <option value="WHATSAPP">WhatsApp</option>
        </select>
        <input type="date" value={since} onChange={(e) => setFilter('since', e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white" title="Started on or after" />
        {hasFilters && (
          <button onClick={() => setParams({}, { replace: true })}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400">No calls match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Started</th>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">From → To</th>
                <th className="text-left px-4 py-3 font-medium">Channel</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-xs text-slate-700">{new Date(c.started_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-700">{c.tenant_name || '—'}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{c.tenant_id?.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{c.caller_number || '—'} → {c.called_number || '—'}</td>
                  <td className="px-4 py-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{c.channel}</span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{c.duration_seconds ? `${Math.round(c.duration_seconds)}s` : '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/super-admin/calls/${c.id}`)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-medium">
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

function MiniStat({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
