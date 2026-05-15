import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, Play, X, AlertCircle, RotateCcw, Phone, PhoneOff,
  Clock, Search, CheckCircle2, AlertTriangle, PhoneCall, MessageSquare, Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import api from '@/services/api';
import { formatDate } from '@/utils/formatters';

interface Recall {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  phone_number: string;
  lead_status: string | null;
  retry_count: number;
  last_call_status: string | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  preferred_callback_time: string | null;
  state: 'PENDING' | 'IN_FLIGHT' | 'COMPLETED' | 'UNREACHABLE' | 'CANCELLED' | string;
  retry_reason: string | null;
  created_at: string;
  updated_at: string;
}

const STATE_FILTERS = ['ALL', 'PENDING', 'IN_FLIGHT', 'COMPLETED', 'UNREACHABLE', 'CANCELLED'] as const;
const LEAD_STATUSES = ['ALL', 'HOT_INTERESTED', 'INTERESTED', 'CALLBACK_SCHEDULED', 'COUNSELOR_MEETING_REQUIRED', 'FOLLOW_UP_REQUIRED'] as const;

const STATE_PILL: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  IN_FLIGHT: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  UNREACHABLE: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  CANCELLED: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
};

const CALL_OUTCOME_PILL: Record<string, { cls: string; icon: any }> = {
  CONNECTED:        { cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', icon: CheckCircle2 },
  NO_ANSWER:        { cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',       icon: PhoneOff },
  BUSY:             { cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',       icon: Phone },
  REJECTED:         { cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',          icon: PhoneOff },
  SWITCHED_OFF:     { cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',          icon: PhoneOff },
  FAILED:           { cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',          icon: AlertTriangle },
  MESSAGE_SENT:     { cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', icon: MessageSquare },
  MESSAGE_FAILED:   { cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',          icon: MessageSquare },
  INITIATE_FAILED:  { cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',          icon: AlertTriangle },
};

const LEAD_STATUS_PILL: Record<string, string> = {
  HOT_INTERESTED: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  INTERESTED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CALLBACK_SCHEDULED: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  COUNSELOR_MEETING_REQUIRED: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  FOLLOW_UP_REQUIRED: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
};

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const past = ms < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return past ? 'just now' : 'in <1 min';
  if (mins < 60) return past ? `${mins} min ago` : `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return past ? `${hrs} h ago` : `in ${hrs} h`;
  const days = Math.round(hrs / 24);
  return past ? `${days} d ago` : `in ${days} d`;
}

export function RecallsPage() {
  const [rows, setRows] = useState<Recall[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [leadFilter, setLeadFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (stateFilter !== 'ALL') params.state = stateFilter;
      if (leadFilter !== 'ALL') params.lead_status = leadFilter;
      const { data } = await api.get('/recalls', { params });
      setRows(data.data || []);
      setCounts(data.counts || {});
      setLeadCounts(data.leadCounts || {});
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load recalls');
    } finally {
      setLoading(false);
    }
  }, [stateFilter, leadFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const action = async (id: string, act: 'retry_now' | 'cancel' | 'reset') => {
    setBusyId(id);
    try {
      await api.patch(`/recalls/${id}`, { action: act });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  // Client-side phone search on top of server-side state/lead filters.
  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (r.phone_number || '').toLowerCase().includes(q) ||
      (r.lead_id || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const kpis = [
    { label: 'Pending',     key: 'PENDING',     icon: Clock,        accent: 'text-amber-600 bg-amber-50' },
    { label: 'In flight',   key: 'IN_FLIGHT',   icon: PhoneCall,    accent: 'text-blue-600 bg-blue-50' },
    { label: 'Completed',   key: 'COMPLETED',   icon: CheckCircle2, accent: 'text-emerald-600 bg-emerald-50' },
    { label: 'Unreachable', key: 'UNREACHABLE', icon: AlertTriangle,accent: 'text-rose-600 bg-rose-50' },
  ];

  return (
    <div className="space-y-2">
      {/* Compact header — single line */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-1">
        <div className="flex items-center gap-2 min-w-0">
          <PhoneCall className="h-4 w-4 text-primary-600 flex-shrink-0" />
          <h1 className="text-base font-semibold text-gray-900 leading-tight">Recall Queue</h1>
          <span className="text-[11px] text-gray-400 truncate">· 1h → 3h → next day → WhatsApp+SMS → counselor · 9 AM–9 PM IST</span>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="rounded-md h-7 text-xs shrink-0" disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      {/* KPI strip — same compact treatment as Leads */}
      <div className="grid grid-cols-4 gap-2">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.key} className="bg-white rounded-md border border-gray-100 shadow-sm px-2.5 py-1.5 flex items-center justify-between">
              <div className="leading-tight">
                <p className="text-[10px] uppercase tracking-wider font-medium text-gray-500">{k.label}</p>
                <p className="text-base font-semibold text-gray-900">{counts[k.key] || 0}</p>
              </div>
              <div className={`p-1 rounded ${k.accent}`}><Icon className="h-3.5 w-3.5" /></div>
            </div>
          );
        })}
      </div>

      {/* Toolbar — search + filter pills */}
      {/* Toolbar — no card chrome, two compact rows */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs min-w-[200px]">
            <Search className="h-3 w-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by phone or lead id…"
              className="w-full text-xs pl-7 pr-2 py-1 border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary-100"
            />
          </div>
          <span className="text-[10px] uppercase tracking-wider font-medium text-gray-500 ml-1">State</span>
          {STATE_FILTERS.map((s) => {
            const isActive = stateFilter === s;
            const count = s === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[s] || 0);
            return (
              <button
                key={s}
                onClick={() => setStateFilter(s)}
                className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 transition-colors ${
                  isActive
                    ? 'border-primary-400 bg-primary-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s.toLowerCase().replace('_', ' ')}
                <span className={`text-[10px] font-mono ${isActive ? 'text-primary-100' : 'text-gray-400'}`}>{count}</span>
              </button>
            );
          })}
          {(stateFilter !== 'ALL' || leadFilter !== 'ALL' || search) && (
            <button onClick={() => { setStateFilter('ALL'); setLeadFilter('ALL'); setSearch(''); }}
              className="text-[11px] text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline ml-1">Clear</button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider font-medium text-gray-500">Lead</span>
          {LEAD_STATUSES.map((s) => {
            const isActive = leadFilter === s;
            const count = s === 'ALL'
              ? Object.values(leadCounts).reduce((a, b) => a + b, 0)
              : (leadCounts[s] || 0);
            return (
              <button
                key={s}
                onClick={() => setLeadFilter(s)}
                className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 transition-colors ${
                  isActive
                    ? 'border-primary-400 bg-primary-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s.toLowerCase().replace(/_/g, ' ')}
                <span className={`text-[10px] font-mono ${isActive ? 'text-primary-100' : 'text-gray-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-1.5 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-800">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Recipient</th>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Lead status</th>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Attempts</th>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Last outcome</th>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">State</th>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Next retry</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-wider font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center">
                  <div className="inline-flex flex-col items-center gap-1.5">
                    <Inbox className="h-10 w-10 text-gray-300" />
                    <p className="text-sm font-medium text-gray-600">No recalls match your filters</p>
                    <p className="text-xs text-gray-400 max-w-sm">
                      Recalls are queued automatically when an interested lead completes a call.
                    </p>
                  </div>
                </td></tr>
              )}
              {visibleRows.map((r) => {
                const outcomeMeta = r.last_call_status ? CALL_OUTCOME_PILL[r.last_call_status] : null;
                const OutcomeIcon = outcomeMeta?.icon;
                const isOverdue = r.state === 'PENDING' && r.next_retry_at && new Date(r.next_retry_at).getTime() < Date.now() - 60_000;
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
                    {/* Recipient */}
                    <td className="px-3 py-0.5 align-middle">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-700 flex items-center justify-center flex-shrink-0">
                          <Phone className="h-2.5 w-2.5" />
                        </div>
                        <div className="leading-none">
                          <a href={`tel:${r.phone_number}`} className="font-mono text-xs text-gray-800 hover:text-primary-600">
                            {r.phone_number}
                          </a>
                          <p className="text-[10px] text-gray-400 mt-0.5">{r.lead_id.slice(0, 8)}…</p>
                        </div>
                      </div>
                    </td>

                    {/* Lead status */}
                    <td className="px-3 py-0.5 align-middle">
                      {r.lead_status ? (
                        <span className={`inline-block px-1.5 py-0 rounded text-[10px] font-medium ${
                          LEAD_STATUS_PILL[r.lead_status] || 'bg-gray-100 text-gray-700 ring-1 ring-gray-200'
                        }`}>
                          {r.lead_status.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>

                    {/* Attempts */}
                    <td className="px-3 py-0.5 align-middle">
                      <div className="inline-flex items-center gap-1">
                        {[1,2,3,4,5].map((n) => (
                          <span
                            key={n}
                            className={`w-1 h-3 rounded-sm ${
                              n <= r.retry_count
                                ? r.state === 'UNREACHABLE' ? 'bg-rose-400' : 'bg-primary-500'
                                : 'bg-gray-200'
                            }`}
                            title={`Attempt ${n}`}
                          />
                        ))}
                        <span className="ml-1.5 text-[10px] font-mono text-gray-600">{r.retry_count}/5</span>
                      </div>
                    </td>

                    {/* Last outcome */}
                    <td className="px-3 py-0.5 align-middle">
                      {r.last_call_status && outcomeMeta ? (
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-medium ${outcomeMeta.cls}`}>
                          {OutcomeIcon && <OutcomeIcon className="h-2.5 w-2.5" />}
                          {r.last_call_status.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>

                    {/* State */}
                    <td className="px-3 py-0.5 align-middle">
                      <span className={`inline-block px-1.5 py-0 rounded text-[10px] font-medium ${
                        STATE_PILL[r.state] || 'bg-gray-100 text-gray-700 ring-1 ring-gray-200'
                      }`}>
                        {r.state.toLowerCase().replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Next retry */}
                    <td className="px-3 py-0.5 align-middle">
                      {r.next_retry_at ? (
                        <div className={`leading-none ${isOverdue ? 'text-rose-600' : 'text-gray-700'}`}>
                          <span className="inline-flex items-center gap-1 text-[11px]">
                            <Clock className={`h-2.5 w-2.5 ${isOverdue ? 'text-rose-500' : 'text-gray-400'}`} />
                            {relativeTime(r.next_retry_at)}
                          </span>
                          <p className="text-[9px] text-gray-400 ml-3.5 mt-0.5">{formatDate(r.next_retry_at)}</p>
                        </div>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-0.5 align-middle text-right">
                      <div className="inline-flex items-center gap-0.5">
                        {(r.state === 'PENDING' || r.state === 'IN_FLIGHT') && (
                          <button
                            onClick={() => action(r.id, 'retry_now')}
                            disabled={busyId === r.id}
                            className="p-1 rounded text-primary-600 hover:bg-primary-50 disabled:opacity-50 transition-colors"
                            title="Retry now"
                          >
                            {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          </button>
                        )}
                        {(r.state === 'UNREACHABLE' || r.state === 'CANCELLED' || r.state === 'COMPLETED') && (
                          <button
                            onClick={() => action(r.id, 'reset')}
                            disabled={busyId === r.id}
                            className="p-1 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                            title="Reset & requeue"
                          >
                            {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                          </button>
                        )}
                        {r.state !== 'CANCELLED' && r.state !== 'COMPLETED' && (
                          <button
                            onClick={() => action(r.id, 'cancel')}
                            disabled={busyId === r.id}
                            className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                            title="Cancel"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 text-center">
        Auto-refresh 30 s · scheduler 60 s · 9 AM–9 PM IST
      </p>
    </div>
  );
}
