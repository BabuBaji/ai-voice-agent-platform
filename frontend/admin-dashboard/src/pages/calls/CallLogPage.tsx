import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Download, Filter, AlertCircle, Loader2, Eye, Play, Pause,
  ChevronLeft, ChevronRight, Settings as SettingsIcon, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { formatDuration, formatDate } from '@/utils/formatters';
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
  endedBy: string;
  cost: number;
  recordingUrl: string | null;
  createdAt: string;
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
  { key: 'cost',      label: 'Cost',       default: true },
  { key: 'recording', label: 'Recording',  default: true },
];

const ROWS_OPTIONS = [10, 25, 50, 100];

export function CallLogPage() {
  const navigate = useNavigate();

  // Data
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);

  // Filters
  const [showFilters, setShowFilters] = useState(true);
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

  // Pagination + columns
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [showColPicker, setShowColPicker] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(
    ALL_COLUMNS.filter((c) => c.default).map((c) => c.key),
  );

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [result, agentList] = await Promise.all([
        conversationApi.list({ page, limit: perPage }),
        agentApi.list().catch(() => [] as any[]),
      ]);
      const agentMap = new Map<string, string>();
      const agentArr = Array.isArray(agentList) ? agentList : (agentList as any)?.data || [];
      agentArr.forEach((a: any) => agentMap.set(a.id, a.name));
      setAgents(agentArr.map((a: any) => ({ id: a.id, name: a.name })));

      const rows: CallRow[] = (result.data || []).map((c: any) => ({
        id: c.id,
        callerNumber: c.caller_number || '—',
        calledNumber: c.called_number || '—',
        agentId: c.agent_id || '',
        agentName: agentMap.get(c.agent_id) || 'Agent',
        channel: c.channel || 'PHONE',
        direction: (c.direction || 'INBOUND').toLowerCase(),
        duration: c.duration_seconds ?? 0,
        outcome: c.outcome || '',
        status: (c.outcome || c.status || 'completed').toLowerCase().replace(/\s+/g, '-'),
        endedBy: c.ended_by || (c.outcome ? 'agent' : 'user'),
        cost: parseFloat(c.cost || (c.duration_seconds ? c.duration_seconds * 0.0019 : 0).toFixed(3)),
        recordingUrl: c.recording_url || null,
        createdAt: c.started_at || c.created_at || '',
      }));
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

  // Client-side filter (server already paginated; filtering on the page is fine for now)
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
        default:             return '';
      }
    }).join(',')).join('\n');
    const blob = new Blob([header + '\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `call-logs-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full space-y-6">
      {/* ─── Filters card ─── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
            <span className="text-xs font-normal text-gray-500">Filter call logs by bot, date range, status, and more</span>
          </h3>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="text-xs px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 font-medium hover:bg-primary-100"
          >
            {showFilters ? 'Hide' : 'Show'}
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
            <FilterSelect label="Bot" value={bot} onChange={setBot} options={[{ value: 'all', label: 'All Bots' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
            <FilterSelect label="Bulk Calls" value="all" onChange={() => {}} options={[{ value: 'all', label: 'Select bulk calls' }]} />
            <FilterSelect label="Call Status" value={callStatus} onChange={setCallStatus} options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'completed', label: 'Completed' },
              { value: 'transferred', label: 'Transferred' },
              { value: 'voicemail', label: 'Voicemail' },
              { value: 'dropped', label: 'Dropped' },
              { value: 'no-answer', label: 'No Answer' },
              { value: 'failed', label: 'Failed' },
            ]} />
            <FilterSelect label="Call Direction" value={direction} onChange={setDirection} options={[
              { value: 'all', label: 'All Directions' },
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' },
            ]} />
            <FilterSelect label="Channel Type" value={channel} onChange={setChannel} options={[
              { value: 'all', label: 'All Channels' },
              { value: 'phone', label: 'Phone' },
              { value: 'web', label: 'Web' },
              { value: 'whatsapp', label: 'WhatsApp' },
            ]} />
            <FilterSelect label="Call Transferred" value={transferred} onChange={setTransferred} options={[
              { value: 'all', label: 'All' },
              { value: 'yes', label: 'Transferred' },
              { value: 'no', label: 'Not Transferred' },
            ]} />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Call Duration (seconds)</label>
              <div className="flex gap-2">
                <input value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="Minimum" className="w-1/2 text-sm border border-gray-200 rounded-lg px-3 py-2" />
                <input value={durationMax} onChange={(e) => setDurationMax(e.target.value)} placeholder="Maximum" className="w-1/2 text-sm border border-gray-200 rounded-lg px-3 py-2" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Call ID</label>
              <input value={callIdFilter} onChange={(e) => setCallIdFilter(e.target.value)} placeholder="Enter call ID" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To Phone Number</label>
              <input value={toNumberFilter} onChange={(e) => setToNumberFilter(e.target.value)} placeholder="Enter phone number" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            </div>
          </div>
        )}
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
          <button onClick={fetchCalls} className="ml-auto text-warning-800 underline text-xs font-medium">Retry</button>
        </div>
      )}

      {/* ─── Toolbar: rows / columns / download ─── */}
      <div className="flex items-center justify-end gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500 font-medium">Rows</span>
          <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            {ROWS_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="relative">
          <span className="text-gray-500 font-medium mr-2">Columns</span>
          <button onClick={() => setShowColPicker((s) => !s)} className="inline-flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50">
            <SettingsIcon className="h-3.5 w-3.5" /> Show / hide <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showColPicker && (
            <div className="absolute right-0 mt-1 z-20 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
              {ALL_COLUMNS.filter((c) => !c.always).map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={isVisible(c.key)}
                    onChange={(e) => setVisibleCols((prev) => e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key))}
                    className="accent-primary-600"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <span className="text-gray-500 font-medium mr-2">Download</span>
          <button onClick={downloadCsv} className="inline-flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* ─── Table ─── */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <Card padding={false} className="shadow-card overflow-x-auto">
          <table className="w-full text-sm table-auto">
            <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
              <tr>
                {ALL_COLUMNS.filter((c) => isVisible(c.key)).map((c) => (
                  <th key={c.key} className="text-left px-3 py-2.5 font-medium whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length} className="text-center py-12 text-sm text-gray-400">
                    No call logs match the current filters.
                  </td>
                </tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors">
                  {isVisible('view') && (
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => navigate(`/calls/${c.id}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 text-[11px] font-medium whitespace-nowrap"
                      >
                        <Eye className="h-3 w-3" /> View Logs
                      </button>
                    </td>
                  )}
                  {isVisible('createdAt') && <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-700">{formatDate(c.createdAt)}</td>}
                  {isVisible('agentName') && <td className="px-3 py-2.5 max-w-[140px]"><div className="font-medium text-gray-900 truncate text-xs">{c.agentName}</div></td>}
                  {isVisible('callerNumber') && <td className="px-3 py-2.5 font-mono text-[11px] text-gray-700 whitespace-nowrap">{c.callerNumber}</td>}
                  {isVisible('calledNumber') && <td className="px-3 py-2.5 font-mono text-[11px] text-gray-700 whitespace-nowrap">{c.calledNumber}</td>}
                  {isVisible('duration') && <td className="px-3 py-2.5 font-mono text-xs text-gray-700 whitespace-nowrap">{formatDuration(c.duration)}</td>}
                  {isVisible('channel') && <td className="px-3 py-2.5"><span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-700">Call</span></td>}
                  {isVisible('status') && <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={c.status} /></td>}
                  {isVisible('endedBy') && <td className="px-3 py-2.5"><span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-700 capitalize whitespace-nowrap">{c.endedBy}</span></td>}
                  {isVisible('cost') && <td className="px-3 py-2.5 font-mono text-xs text-gray-700 whitespace-nowrap">${c.cost.toFixed(3)}</td>}
                  {isVisible('recording') && (
                    <td className="px-3 py-2.5 min-w-[180px]">
                      <RecordingPlayer conversationId={c.id} recordingUrl={c.recordingUrl} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer pagination */}
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-500">Showing {filtered.length} of {total} calls</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-gray-700 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- Inline recording player for a single row ---------- */

function RecordingPlayer({ conversationId, recordingUrl }: { conversationId: string; recordingUrl: string | null }) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = (window as any)._audioRefs ||= {} as Record<string, HTMLAudioElement>;

  const ensureUrl = async (): Promise<string | null> => {
    if (resolvedUrl) return resolvedUrl;
    setLoading(true);
    try {
      let blob: Blob | null = null;
      if (recordingUrl && /^https?:\/\//i.test(recordingUrl)) {
        // Phone-call WAV from ngrok tunnel. Header bypasses ngrok-free's
        // browser-warning interstitial; <audio src> can't do that.
        const resp = await fetch(recordingUrl, { headers: { 'ngrok-skip-browser-warning': '1' } });
        if (resp.ok) blob = await resp.blob();
      } else {
        const r = await api.get(`/conversations/${conversationId}/recording`, { responseType: 'blob' });
        blob = r.data;
      }
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
    return <span className="text-[11px] text-gray-400 italic">Not recorded</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={loading}
        className="w-7 h-7 rounded-full bg-primary-50 text-primary-600 hover:bg-primary-100 flex items-center justify-center"
        title={playing ? 'Pause' : 'Play recording'}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />)}
      </button>
      <button onClick={download} className="text-gray-400 hover:text-gray-700" title="Download recording">
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ---------- Reusable filter <select> ---------- */

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
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
