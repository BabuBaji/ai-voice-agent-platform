import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Download, Filter, AlertCircle, Loader2, Eye, Play, Pause,
  ChevronLeft, ChevronRight, Settings as SettingsIcon, ChevronDown,
  Phone, Clock, TrendingUp, Users, X, ExternalLink, MessageSquare,
  Mic, FileText, Smile, Frown, Meh, ArrowUpRight, ArrowDownRight,
  PhoneIncoming, PhoneOutgoing, Bot, User, Volume2, Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { formatDuration, formatDate, formatINR } from '@/utils/formatters';

const USD_TO_INR = Number(import.meta.env.VITE_USD_TO_INR) || 83;
import { conversationApi } from '@/services/conversation.api';
import { agentApi } from '@/services/agent.api';
import api from '@/services/api';

interface CallRow {
  id: string;
  callerNumber: string;
  calledNumber: string;
  agentId: string;
  agentName: string;
  channel: string;
  direction: string;
  duration: number;
  outcome: string;
  status: string;
  sentiment: string;
  endedBy: string;
  cost: number;
  costInr: number;
  recordingUrl: string | null;
  createdAt: string;
  summary: string;
}

const ALL_COLUMNS = [
  { key: 'view',      label: 'Call Logs',  default: true,  always: true },
  { key: 'createdAt', label: 'Call Date',  default: true },
  { key: 'agentName', label: 'Bot Name',   default: true },
  { key: 'callerNumber', label: 'From Number', default: true },
  { key: 'calledNumber', label: 'To Number',   default: true },
  { key: 'duration',  label: 'Duration',   default: true },
  { key: 'channel',   label: 'Call Type',  default: true },
  { key: 'status',    label: 'Status',     default: true },
  { key: 'endedBy',   label: 'Ended By',   default: true },
  { key: 'cost',      label: 'Cost (USD)', default: true },
  { key: 'costInr',   label: 'Cost (INR)', default: true },
  { key: 'recording', label: 'Recording',  default: true },
];

const ROWS_OPTIONS = [10, 25, 50, 100];

export function CallLogPage() {
  const navigate = useNavigate();

  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);

  const [showFilters, setShowFilters] = useState(false);
  const [bot, setBot] = useState('all');
  const [callStatus, setCallStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const [channel, setChannel] = useState('all');
  const [transferred, setTransferred] = useState('all');
  const [durationMin, setDurationMin] = useState('');
  const [durationMax, setDurationMax] = useState('');
  const [callIdFilter, setCallIdFilter] = useState('');
  const [toNumberFilter, setToNumberFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [showColPicker, setShowColPicker] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(
    ALL_COLUMNS.filter((c) => c.default).map((c) => c.key),
  );

  // Detail panel state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailConv, setDetailConv] = useState<any>(null);
  const [detailMessages, setDetailMessages] = useState<any[]>([]);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [result, agentList] = await Promise.all([
        conversationApi.list({ page, limit: perPage }),
        agentApi.list().catch(() => [] as any[]),
      ]);
      const agentMap = new Map<string, string>();
      const agentCostMap = new Map<string, number>();
      const agentArr = Array.isArray(agentList) ? agentList : (agentList as any)?.data || [];
      agentArr.forEach((a: any) => {
        agentMap.set(a.id, a.name);
        const cpm = a.cost_per_min != null ? parseFloat(a.cost_per_min) : NaN;
        if (Number.isFinite(cpm)) agentCostMap.set(a.id, cpm);
      });
      setAgents(agentArr.map((a: any) => ({ id: a.id, name: a.name })));

      const STALE_MS = 5 * 60 * 1000;
      const now = Date.now();
      const filteredRaw = (result.data || []).filter((c: any) => {
        if ((c.status || '').toUpperCase() !== 'ACTIVE') return true;
        const started = new Date(c.started_at || c.created_at || 0).getTime();
        return started > 0 && now - started < STALE_MS;
      });

      const rows: CallRow[] = filteredRaw.map((c: any) => {
        const seconds = Number(c.duration_seconds) || 0;
        const ratePerMin = agentCostMap.get(c.agent_id || '') ?? 0.115;
        const costUsd = Number(((seconds / 60) * ratePerMin).toFixed(3));
        return {
          id: c.id,
          callerNumber: c.caller_number || '—',
          calledNumber: c.called_number || '—',
          agentId: c.agent_id || '',
          agentName: agentMap.get(c.agent_id) || 'Agent',
          channel: c.channel || 'PHONE',
          direction: (c.direction || 'OUTBOUND').toLowerCase(),
          duration: c.duration_seconds ?? 0,
          outcome: c.outcome || '',
          status: (c.outcome || c.status || 'completed').toLowerCase().replace(/\s+/g, '-'),
          sentiment: c.sentiment || '',
          endedBy: c.ended_by || (c.outcome ? 'agent' : 'user'),
          cost: costUsd,
          costInr: costUsd * USD_TO_INR,
          recordingUrl: c.recording_url || null,
          createdAt: c.started_at || c.created_at || '',
          summary: c.summary || '',
        };
      });
      setCalls(rows);
      setTotal(result.total ?? rows.length);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load calls');
      setCalls([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, perPage]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);
  useEffect(() => { setPage(1); }, [bot, callStatus, direction, channel, transferred, durationMin, durationMax, callIdFilter, toNumberFilter, startDate, endDate]);

  // Load detail panel data when selection changes
  useEffect(() => {
    if (!selectedId) { setDetailConv(null); setDetailMessages([]); return; }
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      conversationApi.get(selectedId),
      conversationApi.getMessages(selectedId),
    ]).then(([conv, msgs]) => {
      if (cancelled) return;
      setDetailConv(conv);
      setDetailMessages(msgs || []);
    }).catch(() => {}).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      if (bot !== 'all' && c.agentId !== bot) return false;
      if (callStatus !== 'all' && c.status !== callStatus) return false;
      if (direction !== 'all' && c.direction !== direction) return false;
      if (channel !== 'all' && c.channel.toLowerCase() !== channel) return false;
      if (durationMin && c.duration < parseInt(durationMin)) return false;
      if (durationMax && c.duration > parseInt(durationMax)) return false;
      if (callIdFilter && !c.id.includes(callIdFilter)) return false;
      if (toNumberFilter && !c.calledNumber.includes(toNumberFilter)) return false;
      if (startDate && new Date(c.createdAt) < new Date(startDate)) return false;
      if (endDate && new Date(c.createdAt) > new Date(endDate + 'T23:59:59')) return false;
      return true;
    });
  }, [calls, bot, callStatus, direction, channel, durationMin, durationMax, callIdFilter, toNumberFilter, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const isVisible = (key: string) => visibleCols.includes(key);

  // KPI stats
  const stats = useMemo(() => {
    const completed = filtered.filter((c) => c.status === 'completed' || c.status === 'ended').length;
    const totalDur = filtered.reduce((s, c) => s + c.duration, 0);
    const avgDur = filtered.length > 0 ? totalDur / filtered.length : 0;
    const inbound = filtered.filter((c) => c.direction === 'inbound').length;
    const outbound = filtered.filter((c) => c.direction === 'outbound').length;
    const totalCost = filtered.reduce((s, c) => s + c.cost, 0);
    return { total: filtered.length, completed, avgDur, inbound, outbound, totalCost, totalDur };
  }, [filtered]);

  const downloadCsv = () => {
    const cols = ALL_COLUMNS.filter((c) => isVisible(c.key) && c.key !== 'view' && c.key !== 'recording');
    const header = cols.map((c) => c.label).join(',');
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map((r) => cols.map((c) => {
      switch (c.key) {
        case 'createdAt':    return esc(formatDate(r.createdAt));
        case 'agentName':    return esc(r.agentName);
        case 'callerNumber': return esc(r.callerNumber);
        case 'calledNumber': return esc(r.calledNumber);
        case 'duration':     return esc(r.duration);
        case 'channel':      return esc(r.channel);
        case 'status':       return esc(r.status);
        case 'endedBy':      return esc(r.endedBy);
        case 'cost':         return esc(`$${r.cost.toFixed(3)}`);
        case 'costInr':      return esc(`₹${r.costInr.toFixed(2)}`);
        default:             return '';
      }
    }).join(',')).join('\n');
    const blob = new Blob([header + '\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `call-logs-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const selectedCall = selectedId ? calls.find((c) => c.id === selectedId) : null;

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-gray-900 tracking-tight">Call Logs</h1>
          <p className="text-xs text-gray-500 mt-0.5">Monitor, analyze, and review all voice conversations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              showFilters ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Filter className="h-3.5 w-3.5" /> Filters
          </button>
          <button onClick={downloadCsv} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 font-semibold">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* ─── KPI strip ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniKpi label="Total Calls" value={stats.total} icon={<Phone className="h-4 w-4" />} color="primary" />
        <MiniKpi label="Inbound" value={stats.inbound} icon={<PhoneIncoming className="h-4 w-4" />} color="teal" />
        <MiniKpi label="Outbound" value={stats.outbound} icon={<PhoneOutgoing className="h-4 w-4" />} color="indigo" />
        <MiniKpi label="Avg Duration" value={`${(stats.avgDur / 60).toFixed(1)}m`} icon={<Clock className="h-4 w-4" />} color="amber" />
        <MiniKpi label="Completed" value={stats.completed} icon={<TrendingUp className="h-4 w-4" />} color="success" />
        <MiniKpi label="Total Cost" value={`$${stats.totalCost.toFixed(2)}`} icon={<Hash className="h-4 w-4" />} color="purple" />
      </div>

      {/* ─── Filters ─── */}
      {showFilters && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card animate-slide-down">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
            <FilterSelect label="Bot" value={bot} onChange={setBot} options={[{ value: 'all', label: 'All Bots' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
            <FilterSelect label="Status" value={callStatus} onChange={setCallStatus} options={[
              { value: 'all', label: 'All' },
              { value: 'completed', label: 'Completed' },
              { value: 'transferred', label: 'Transferred' },
              { value: 'voicemail', label: 'Voicemail' },
              { value: 'dropped', label: 'Dropped' },
              { value: 'no-answer', label: 'No Answer' },
              { value: 'failed', label: 'Failed' },
            ]} />
            <FilterSelect label="Direction" value={direction} onChange={setDirection} options={[
              { value: 'all', label: 'All' },
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' },
            ]} />
            <FilterSelect label="Channel" value={channel} onChange={setChannel} options={[
              { value: 'all', label: 'All' },
              { value: 'phone', label: 'Phone' },
              { value: 'web', label: 'Web' },
              { value: 'whatsapp', label: 'WhatsApp' },
            ]} />
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Duration (sec)</label>
              <div className="flex gap-2">
                <input value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="Min" className="w-1/2 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
                <input value={durationMax} onChange={(e) => setDurationMax(e.target.value)} placeholder="Max" className="w-1/2 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Call ID</label>
              <input value={callIdFilter} onChange={(e) => setCallIdFilter(e.target.value)} placeholder="Search..." className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          <button onClick={fetchCalls} className="ml-auto text-warning-800 underline text-xs font-medium">Retry</button>
        </div>
      )}

      {/* ─── Main layout: table + detail panel ─── */}
      <div className="flex gap-5 items-start">
        {/* Left: table */}
        <div className={`transition-all duration-300 ${selectedId ? 'w-[55%] min-w-0' : 'w-full'}`}>
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs text-gray-500 font-medium">
              {filtered.length} of {total} calls
            </p>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500 font-medium">Rows</span>
                <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
                  {ROWS_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="relative">
                <button onClick={() => setShowColPicker((s) => !s)} className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1 bg-white hover:bg-gray-50">
                  <SettingsIcon className="h-3 w-3" /> Columns <ChevronDown className="h-3 w-3" />
                </button>
                {showColPicker && (
                  <div className="absolute right-0 mt-1 z-20 w-52 bg-white border border-gray-200 rounded-xl shadow-lg p-2">
                    {ALL_COLUMNS.filter((c) => !c.always).map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-xs">
                        <input type="checkbox" checked={isVisible(c.key)}
                          onChange={(e) => setVisibleCols((prev) => e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key))}
                          className="accent-primary-600" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-7 w-7 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/80">
                    <tr>
                      {ALL_COLUMNS.filter((c) => isVisible(c.key)).map((c) => (
                        <th key={c.key} className="text-left px-3 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={visibleCols.length} className="text-center py-16 text-sm text-gray-400">
                          <Phone className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                          No call logs match the current filters.
                        </td>
                      </tr>
                    ) : filtered.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                        className={`border-t border-gray-50 cursor-pointer transition-colors ${
                          c.id === selectedId
                            ? 'bg-primary-50/60 border-l-2 border-l-primary-500'
                            : 'hover:bg-gray-50/60'
                        }`}
                      >
                        {isVisible('view') && (
                          <td className="px-3 py-2.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/calls/${c.id}`); }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 text-[10px] font-semibold whitespace-nowrap"
                            >
                              <Eye className="h-3 w-3" /> View
                            </button>
                          </td>
                        )}
                        {isVisible('createdAt') && <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{formatDate(c.createdAt)}</td>}
                        {isVisible('agentName') && (
                          <td className="px-3 py-2.5 max-w-[120px]">
                            <span className="font-semibold text-gray-900 truncate block">{c.agentName}</span>
                          </td>
                        )}
                        {isVisible('callerNumber') && <td className="px-3 py-2.5 font-mono text-[10px] text-gray-600 whitespace-nowrap">{c.callerNumber}</td>}
                        {isVisible('calledNumber') && <td className="px-3 py-2.5 font-mono text-[10px] text-gray-600 whitespace-nowrap">{c.calledNumber}</td>}
                        {isVisible('duration') && (
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className="font-mono text-gray-700 font-medium">{formatDuration(c.duration)}</span>
                          </td>
                        )}
                        {isVisible('channel') && (
                          <td className="px-3 py-2.5">
                            <DirectionBadge direction={c.direction} channel={c.channel} />
                          </td>
                        )}
                        {isVisible('status') && <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={c.status} /></td>}
                        {isVisible('endedBy') && <td className="px-3 py-2.5"><span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 capitalize whitespace-nowrap">{c.endedBy}</span></td>}
                        {isVisible('cost') && <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">${c.cost.toFixed(3)}</td>}
                        {isVisible('costInr') && <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">{formatINR(c.costInr, { decimals: 2 })}</td>}
                        {isVisible('recording') && (
                          <td className="px-3 py-2.5 min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                            <RecordingPlayer conversationId={c.id} recordingUrl={c.recordingUrl} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between bg-gray-50/30">
                <p className="text-[11px] text-gray-500">{filtered.length} of {total} calls</p>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg h-7 w-7 p-0">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-[11px] text-gray-600 px-2 font-medium">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg h-7 w-7 p-0">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selectedId && (
          <div className="w-[45%] min-w-[380px] sticky top-4 animate-slide-in-right">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden">
              {/* Panel header */}
              <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-primary-50 to-accent-50/30 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white flex-shrink-0">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold text-gray-900 truncate">{selectedCall?.agentName || 'Call Details'}</p>
                    <p className="text-[10px] text-gray-500 font-mono truncate">{selectedId.slice(0, 16)}…</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => navigate(`/calls/${selectedId}`)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-white/80 text-primary-700 hover:bg-white border border-primary-100"
                  >
                    <ExternalLink className="h-3 w-3" /> Full Details
                  </button>
                  <button onClick={() => setSelectedId(null)} className="h-7 w-7 rounded-lg hover:bg-white/80 flex items-center justify-center text-gray-500">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {detailLoading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
                </div>
              ) : (
                <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                  {/* Quick stats */}
                  {selectedCall && (
                    <div className="grid grid-cols-4 gap-px bg-gray-100 border-b border-gray-100">
                      <DetailStat label="Duration" value={formatDuration(selectedCall.duration)} />
                      <DetailStat label="Direction" value={selectedCall.direction} />
                      <DetailStat label="Status" value={selectedCall.status} />
                      <DetailStat label="Cost" value={`$${selectedCall.cost.toFixed(3)}`} />
                    </div>
                  )}

                  {/* Sentiment + Outcome */}
                  {detailConv && (
                    <div className="px-5 py-3 border-b border-gray-100 space-y-2">
                      <div className="flex items-center gap-4">
                        {detailConv.sentiment && (
                          <div className="flex items-center gap-1.5">
                            <SentimentIcon sentiment={detailConv.sentiment} />
                            <span className="text-xs font-semibold text-gray-700 capitalize">{detailConv.sentiment}</span>
                          </div>
                        )}
                        {detailConv.outcome && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 font-semibold">{detailConv.outcome}</span>
                        )}
                        {detailConv.interest_level != null && (
                          <div className="flex items-center gap-1.5 ml-auto">
                            <span className="text-[10px] text-gray-500">Interest</span>
                            <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${Math.min(100, detailConv.interest_level)}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-gray-700">{detailConv.interest_level}%</span>
                          </div>
                        )}
                      </div>
                      {detailConv.summary && (
                        <p className="text-xs text-gray-600 leading-relaxed">{detailConv.summary}</p>
                      )}
                    </div>
                  )}

                  {/* Recording */}
                  {selectedCall?.recordingUrl && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Recording</p>
                      <RecordingPlayer conversationId={selectedId} recordingUrl={selectedCall.recordingUrl} />
                    </div>
                  )}

                  {/* Key info */}
                  {detailConv && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Call Info</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <InfoRow label="From" value={selectedCall?.callerNumber || '—'} mono />
                        <InfoRow label="To" value={selectedCall?.calledNumber || '—'} mono />
                        <InfoRow label="Agent" value={selectedCall?.agentName || '—'} />
                        <InfoRow label="Date" value={selectedCall ? formatDate(selectedCall.createdAt) : '—'} />
                        {detailConv.language && <InfoRow label="Language" value={detailConv.language} />}
                        <InfoRow label="Channel" value={selectedCall?.channel || '—'} />
                      </div>
                    </div>
                  )}

                  {/* Topics */}
                  {detailConv?.topics && Array.isArray(detailConv.topics) && detailConv.topics.length > 0 && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Topics</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detailConv.topics.map((t: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Points */}
                  {detailConv?.key_points && Array.isArray(detailConv.key_points) && detailConv.key_points.length > 0 && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Key Points</p>
                      <ul className="space-y-1">
                        {detailConv.key_points.map((kp: string, i: number) => (
                          <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                            <span className="text-primary-400 mt-0.5">•</span>
                            <span>{kp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Transcript */}
                  <div className="px-5 py-3">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                      <MessageSquare className="h-3 w-3 inline mr-1" />
                      Transcript ({detailMessages.length} messages)
                    </p>
                    {detailMessages.length === 0 ? (
                      <p className="text-xs text-gray-400 italic py-4 text-center">No transcript available</p>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                        {detailMessages.map((m: any, i: number) => (
                          <div key={m.id || i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {m.role !== 'user' && (
                              <div className="h-6 w-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Bot className="h-3 w-3 text-primary-600" />
                              </div>
                            )}
                            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                              m.role === 'user'
                                ? 'bg-primary-600 text-white rounded-br-sm'
                                : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                            }`}>
                              {m.content}
                            </div>
                            {m.role === 'user' && (
                              <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <User className="h-3 w-3 text-gray-600" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

const KPI_COLORS: Record<string, string> = {
  primary: 'text-primary-600 bg-primary-50',
  teal: 'text-teal-600 bg-teal-50',
  indigo: 'text-indigo-600 bg-indigo-50',
  amber: 'text-amber-600 bg-amber-50',
  success: 'text-success-600 bg-success-50',
  purple: 'text-purple-600 bg-purple-50',
};

function MiniKpi({ label, value, icon, color = 'primary' }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) {
  const c = KPI_COLORS[color] || KPI_COLORS.primary;
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-2.5 shadow-card flex items-center gap-3">
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${c}`}>{icon}</div>
      <div>
        <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{label}</p>
        <p className="text-base font-display font-extrabold text-gray-900 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function DirectionBadge({ direction, channel }: { direction: string; channel: string }) {
  const isIn = direction === 'inbound';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
      isIn ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700'
    }`}>
      {isIn ? <PhoneIncoming className="h-2.5 w-2.5" /> : <PhoneOutgoing className="h-2.5 w-2.5" />}
      {isIn ? 'In' : 'Out'}
    </span>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-2 text-center">
      <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">{label}</p>
      <p className="text-xs font-bold text-gray-900 capitalize tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
      <p className={`text-xs font-semibold text-gray-800 truncate ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</p>
    </div>
  );
}

function SentimentIcon({ sentiment }: { sentiment: string }) {
  const s = sentiment.toLowerCase();
  if (s === 'positive' || s === 'interested') return <Smile className="h-4 w-4 text-success-500" />;
  if (s === 'negative') return <Frown className="h-4 w-4 text-danger-500" />;
  return <Meh className="h-4 w-4 text-amber-500" />;
}

function RecordingPlayer({ conversationId, recordingUrl }: { conversationId: string; recordingUrl: string | null }) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = (window as any)._audioRefs ||= {} as Record<string, HTMLAudioElement>;

  const ensureUrl = async (): Promise<string | null> => {
    if (resolvedUrl) return resolvedUrl;
    setLoading(true);
    try {
      const r = await api.get(`/conversations/${conversationId}/recording`, { responseType: 'blob' });
      const blob: Blob | null = r.data;
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      setResolvedUrl(url);
      return url;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    const url = await ensureUrl();
    if (!url) return;
    let el = audioRef[conversationId];
    if (!el) {
      el = new Audio(url);
      el.onended = () => setPlaying(false);
      audioRef[conversationId] = el;
    }
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().catch(() => {}); setPlaying(true); }
  };

  const download = async () => {
    const url = await ensureUrl();
    if (!url) return;
    const a = document.createElement('a');
    const ext = url.endsWith('.wav') ? 'wav' : 'webm';
    a.href = url; a.download = `recording-${conversationId}.${ext}`; a.click();
  };

  if (!recordingUrl) {
    return <span className="text-[10px] text-gray-400 italic">Not recorded</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={loading}
        className="w-6 h-6 rounded-full bg-primary-50 text-primary-600 hover:bg-primary-100 flex items-center justify-center"
        title={playing ? 'Pause' : 'Play recording'}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : (playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />)}
      </button>
      <button onClick={download} className="text-gray-400 hover:text-gray-700" title="Download recording">
        <Download className="h-3 w-3" />
      </button>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
