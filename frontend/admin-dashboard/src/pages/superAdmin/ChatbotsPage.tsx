import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, Search, X, Download, MessageSquare, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import { superAdminApi, downloadCsv } from '@/services/superAdmin.api';

const CATEGORY_LABEL: Record<string, { label: string; emoji: string; color: string }> = {
  lead_gen:    { label: 'Lead Gen',     emoji: '🎯', color: 'bg-amber-100 text-amber-700' },
  support:     { label: 'Support',      emoji: '💬', color: 'bg-sky-100 text-sky-700' },
  appointment: { label: 'Appointment',  emoji: '📅', color: 'bg-emerald-100 text-emerald-700' },
  sales:       { label: 'Sales',        emoji: '🛍️', color: 'bg-violet-100 text-violet-700' },
  admission:   { label: 'Admission',    emoji: '🎓', color: 'bg-rose-100 text-rose-700' },
  real_estate: { label: 'Real Estate',  emoji: '🏠', color: 'bg-cyan-100 text-cyan-700' },
  healthcare:  { label: 'Healthcare',   emoji: '🏥', color: 'bg-teal-100 text-teal-700' },
  recruitment: { label: 'Recruitment',  emoji: '💼', color: 'bg-orange-100 text-orange-700' },
  custom:      { label: 'Custom',       emoji: '✨', color: 'bg-slate-100 text-slate-700' },
};

const STATUS_PILL: Record<string, string> = {
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ACTIVE:    'bg-emerald-100 text-emerald-700',
  DRAFT:     'bg-slate-100 text-slate-600',
  ARCHIVED:  'bg-slate-200 text-slate-500',
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SuperAdminChatbotsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await superAdminApi.chatbots({
        page, limit: 25,
        tenant_id: tenantId || undefined,
        status, category,
        search: search.trim() || undefined,
      });
      setRows(r.data);
      setTotal(r.total);
    } finally { setLoading(false); }
  }, [page, tenantId, status, category, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tenantId, status, category, search]);

  const totalPages = Math.max(1, Math.ceil(total / 25));
  const hasFilters = tenantId || status !== 'all' || category !== 'all' || search;

  const counts = useMemo(() => ({
    total,
    published: rows.filter((r) => String(r.status).toUpperCase() === 'PUBLISHED' || String(r.status).toUpperCase() === 'ACTIVE').length,
    draft: rows.filter((r) => String(r.status).toUpperCase() === 'DRAFT').length,
    sessions: rows.reduce((a, r) => a + (Number(r.sessions) || 0), 0),
  }), [rows, total]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-amber-500" /> Chatbots
          </h1>
          <p className="text-sm text-slate-500 mt-1">{total} chatbots across all tenants. Click a row to inspect the underlying agent.</p>
        </div>
        <button
          onClick={() => downloadCsv(`chatbots-${new Date().toISOString().slice(0,10)}.csv`, rows, [
            { key: 'id', label: 'Chatbot ID' },
            { key: 'tenant_id', label: 'Tenant ID' },
            { key: 'tenant_name', label: 'Tenant' },
            { key: 'name', label: 'Name' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'llm_provider', label: 'LLM Provider' },
            { key: 'llm_model', label: 'LLM Model' },
            { key: 'sessions', label: 'Sessions' },
            { key: 'last_session_at', label: 'Last session' },
            { key: 'created_at', label: 'Created' },
          ])}
          className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total chatbots"  value={counts.total} />
        <Kpi label="Live (this page)" value={counts.published} accent="emerald" />
        <Kpi label="Draft (this page)" value={counts.draft} accent="amber" />
        <Kpi label="Chat sessions"   value={counts.sessions} accent="violet" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by chatbot name…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID (UUID)"
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white min-w-[260px] font-mono" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([key, m]) => (
            <option key={key} value={key}>{m.emoji} {m.label}</option>
          ))}
        </select>
        {hasFilters && (
          <button onClick={() => { setTenantId(''); setStatus('all'); setCategory('all'); setSearch(''); }}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-slate-400">No chatbots match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Chatbot</th>
                <th className="text-left px-4 py-3 font-medium">Tenant</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">LLM</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Sessions</th>
                <th className="text-left px-4 py-3 font-medium">Last session</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c: any) => {
                const cat = CATEGORY_LABEL[c.category] || CATEGORY_LABEL.custom;
                const stat = String(c.status || '').toUpperCase();
                const cfg = c.chatbot_config || {};
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: (cfg.theme?.color || '#f59e0b') + '1a' }}>
                          <span>{cat.emoji}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate max-w-[220px]">{c.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{c.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.tenant_id ? (
                        <Link to={`/super-admin/tenants/${c.tenant_id}`} className="group">
                          <div className="text-xs text-slate-700 group-hover:text-amber-700 truncate max-w-[160px]">{c.tenant_name || c.tenant_id.slice(0, 8)}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{c.tenant_id.slice(0, 8)}</div>
                        </Link>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cat.color}`}>
                        {cat.emoji} {cat.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 font-mono">
                      {c.llm_provider || '—'} · {c.llm_model || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_PILL[stat] || 'bg-slate-100 text-slate-600'}`}>
                        {stat || 'DRAFT'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{c.sessions || 0}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(c.last_session_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/super-admin/calls?tenant_id=${c.tenant_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-medium"
                        title="View this tenant's chat sessions">
                        <ExternalLink className="h-3 w-3" /> Sessions
                      </Link>
                    </td>
                  </tr>
                );
              })}
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

function Kpi({ label, value, accent = 'amber' }: { label: string; value: number; accent?: 'amber' | 'emerald' | 'violet' }) {
  const map: Record<string, string> = {
    amber: 'from-amber-500 to-orange-500',
    emerald: 'from-emerald-500 to-teal-500',
    violet: 'from-violet-500 to-purple-500',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${map[accent]} flex items-center justify-center shadow-md`}>
        <MessageSquare className="h-5 w-5 text-white" />
      </div>
    </div>
  );
}
