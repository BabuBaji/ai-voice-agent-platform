import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Phone, ArrowDownLeft, ArrowUpRight, Globe, MessageSquare,
  Loader2, Eye, Pause, Play, RefreshCw, AlertCircle, Radio,
  Mic, Volume2, Brain, Zap, ShieldAlert, PhoneIncoming, PhoneOutgoing,
  Clock, Bot, User, Wifi, WifiOff, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { conversationApi, Conversation, ConversationMessage } from '@/services/conversation.api';
import { agentApi } from '@/services/agent.api';

const POLL_MS = 3000;
const STALE_MS = 5 * 60 * 1000;
const TRANSCRIPT_LIMIT = 8;

interface LiveState {
  call_state?: string;
  stt_backend?: string;
  tts_backend?: string;
  language?: string;
  is_inbound?: boolean;
  last_event?: string;
  last_event_at?: number;
  ttft_ms?: number | null;
  ttfa_ms?: number | null;
  provider_pref?: string;
  stt_downshifted?: boolean;
  dg_dead?: boolean;
  from?: string;
  to?: string;
  reason?: string;
}

interface LiveCall extends Conversation {
  agent_name: string;
  duration_live: number;
  latest_user?: string;
  latest_assistant?: string;
  message_count_live?: number;
  live_state?: LiveState;
}

const STATE_LABELS: Record<string, { label: string; color: string; icon: typeof Mic }> = {
  IDLE:           { label: 'Idle',          color: 'bg-gray-100 text-gray-600',    icon: Clock },
  LISTENING:      { label: 'Listening',     color: 'bg-blue-100 text-blue-700',    icon: Mic },
  USER_SPEAKING:  { label: 'User Speaking', color: 'bg-cyan-100 text-cyan-700',    icon: User },
  THINKING:       { label: 'Thinking',      color: 'bg-amber-100 text-amber-700',  icon: Brain },
  AGENT_SPEAKING: { label: 'Agent Speaking',color: 'bg-emerald-100 text-emerald-700', icon: Volume2 },
  ENDED:          { label: 'Ended',         color: 'bg-gray-100 text-gray-500',    icon: Phone },
};

export function LiveCallsPage() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [agentMap, setAgentMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMessages, setDetailMessages] = useState<ConversationMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const [{ data }, agentList] = await Promise.all([
        conversationApi.list({ status: 'ACTIVE', limit: 50 }),
        agentApi.list().catch(() => [] as any[]),
      ]);
      const agentArr = Array.isArray(agentList) ? agentList : (agentList as any)?.data || [];
      const map = new Map<string, string>();
      agentArr.forEach((a: any) => map.set(a.id, a.name));
      setAgentMap(map);

      const now = Date.now();
      const fresh = (data || []).filter((c) => {
        const started = new Date(c.started_at || (c as any).created_at || 0).getTime();
        return started > 0 && now - started < STALE_MS;
      });

      const focus = fresh.slice(0, TRANSCRIPT_LIMIT);
      const transcripts = await Promise.all(
        focus.map((c) =>
          conversationApi.getMessages(c.id)
            .then((msgs) => ({ id: c.id, msgs }))
            .catch(() => ({ id: c.id, msgs: [] as ConversationMessage[] })),
        ),
      );
      const transcriptMap = new Map<string, ConversationMessage[]>();
      transcripts.forEach((t) => transcriptMap.set(t.id, t.msgs));

      const rows: LiveCall[] = fresh.map((c) => {
        const started = new Date(c.started_at || (c as any).created_at || 0).getTime();
        const msgs = transcriptMap.get(c.id) || [];
        const latestUser = [...msgs].reverse().find((m) => m.role === 'user');
        const latestAsst = [...msgs].reverse().find((m) => m.role === 'assistant');
        const liveState = (c.metadata as any)?.live_state as LiveState | undefined;
        return {
          ...c,
          agent_name: map.get(c.agent_id) || 'Agent',
          duration_live: started > 0 ? Math.floor((now - started) / 1000) : 0,
          latest_user: latestUser?.content,
          latest_assistant: latestAsst?.content,
          message_count_live: msgs.length || c.message_count,
          live_state: liveState,
        };
      });
      setCalls(rows);
      setError(null);
      setLastFetched(new Date());

      // Refresh detail transcript if a call is selected
      if (selectedId) {
        const selMsgs = transcriptMap.get(selectedId);
        if (selMsgs) setDetailMessages(selMsgs);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to fetch live calls');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchOnce, paused]);

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // Load full transcript when a call is selected
  useEffect(() => {
    if (!selectedId) { setDetailMessages([]); return; }
    conversationApi.getMessages(selectedId).then(setDetailMessages).catch(() => setDetailMessages([]));
  }, [selectedId]);

  const activeCount = calls.length;
  const totalAgents = useMemo(() => new Set(calls.map((c) => c.agent_id)).size, [calls]);
  const selectedCall = selectedId ? calls.find((c) => c.id === selectedId) : null;

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
            <Radio className="h-5 w-5 text-red-500 animate-pulse" /> Live Call Monitor
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 tabular-nums">
              {activeCount} active
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time call states, latency, providers, transcript — auto-refreshes every {POLL_MS / 1000}s
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[10px] text-gray-400 font-mono">
              {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} className="rounded-lg h-8 text-xs">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg h-8 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Activity className="h-4 w-4" />} label="Active Calls" value={activeCount} color="red" />
        <KpiCard icon={<Bot className="h-4 w-4" />} label="Agents Busy" value={totalAgents} color="primary" />
        <KpiCard
          icon={<PhoneIncoming className="h-4 w-4" />}
          label="Inbound"
          value={calls.filter((c) => c.live_state?.is_inbound || (((c as any).direction || '') as string).toUpperCase() === 'INBOUND').length}
          color="teal"
        />
        <KpiCard
          icon={<PhoneOutgoing className="h-4 w-4" />}
          label="Outbound"
          value={calls.filter((c) => !c.live_state?.is_inbound && (((c as any).direction || '') as string).toUpperCase() !== 'INBOUND').length}
          color="indigo"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && calls.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-7 w-7 animate-spin text-primary-600" />
        </div>
      ) : calls.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-card">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Phone className="h-7 w-7 text-gray-300" />
            </div>
            <h3 className="text-sm font-display font-bold text-gray-700">No live calls right now</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              When a call comes in or you launch a campaign, it will appear here with live state, transcript, and latency metrics.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          {/* Call cards grid */}
          <div className={`transition-all duration-300 ${selectedId ? 'w-[55%]' : 'w-full'}`}>
            <div className={`grid gap-3 ${selectedId ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
              {calls.map((c) => (
                <CallCard
                  key={c.id}
                  call={c}
                  tick={tick}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id === selectedId ? null : c.id)}
                  onOpen={() => navigate(`/calls/${c.id}`)}
                />
              ))}
            </div>
          </div>

          {/* Right panel: live detail */}
          {selectedCall && (
            <div className="w-[45%] min-w-[380px] sticky top-4 animate-slide-in-right">
              <div className="rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden">
                {/* Panel header */}
                <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-red-50 to-primary-50/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500 to-primary-500 flex items-center justify-center text-white">
                      <Radio className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-display text-sm font-bold text-gray-900">{selectedCall.agent_name}</p>
                      <p className="text-[10px] text-gray-500 font-mono">{selectedCall.caller_number || '—'} → {selectedCall.called_number || '—'}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>

                <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                  {/* Live state badges */}
                  {selectedCall.live_state && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Runtime State</p>
                      <div className="flex flex-wrap gap-1.5">
                        <StateBadge state={selectedCall.live_state.call_state || 'IDLE'} />
                        {selectedCall.live_state.stt_backend && (
                          <ProviderPill label="STT" value={selectedCall.live_state.stt_backend} icon={<Mic className="h-2.5 w-2.5" />} />
                        )}
                        {selectedCall.live_state.tts_backend && (
                          <ProviderPill label="TTS" value={selectedCall.live_state.tts_backend} icon={<Volume2 className="h-2.5 w-2.5" />} />
                        )}
                        {selectedCall.live_state.language && (
                          <ProviderPill label="Lang" value={selectedCall.live_state.language} icon={<Globe className="h-2.5 w-2.5" />} />
                        )}
                        {selectedCall.live_state.dg_dead && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-bold">
                            <WifiOff className="h-2.5 w-2.5" /> STT Dead
                          </span>
                        )}
                        {selectedCall.live_state.stt_downshifted && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 font-bold">
                            <AlertTriangle className="h-2.5 w-2.5" /> Fallback
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Latency metrics */}
                  {selectedCall.live_state && (selectedCall.live_state.ttft_ms || selectedCall.live_state.ttfa_ms) && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Latency (last turn)</p>
                      <div className="grid grid-cols-2 gap-3">
                        {selectedCall.live_state.ttft_ms != null && (
                          <LatencyMetric label="STT → LLM" ms={selectedCall.live_state.ttft_ms} threshold={1000} />
                        )}
                        {selectedCall.live_state.ttfa_ms != null && (
                          <LatencyMetric label="LLM → Audio" ms={selectedCall.live_state.ttfa_ms} threshold={700} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Last event */}
                  {selectedCall.live_state?.last_event && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Last Event</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-gray-800">{selectedCall.live_state.last_event}</span>
                        {selectedCall.live_state.last_event_at && (
                          <span className="text-[10px] text-gray-400">{new Date(selectedCall.live_state.last_event_at).toLocaleTimeString()}</span>
                        )}
                      </div>
                      {selectedCall.live_state.reason && (
                        <p className="text-[10px] text-gray-500 mt-0.5">{selectedCall.live_state.reason}</p>
                      )}
                    </div>
                  )}

                  {/* Live transcript */}
                  <div className="px-5 py-3">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                      <MessageSquare className="h-3 w-3 inline mr-1" />
                      Live Transcript ({detailMessages.length} msgs)
                    </p>
                    {detailMessages.length === 0 ? (
                      <p className="text-xs text-gray-400 italic py-4 text-center">Waiting for conversation…</p>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                        {detailMessages.map((m, i) => (
                          <div key={m.id || i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {m.role !== 'user' && (
                              <div className="h-5 w-5 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Bot className="h-2.5 w-2.5 text-primary-600" />
                              </div>
                            )}
                            <div className={`max-w-[80%] px-2.5 py-1.5 rounded-xl text-[11px] leading-relaxed ${
                              m.role === 'user'
                                ? 'bg-primary-600 text-white rounded-br-sm'
                                : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                            }`}>
                              {m.content}
                            </div>
                            {m.role === 'user' && (
                              <div className="h-5 w-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <User className="h-2.5 w-2.5 text-gray-600" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function CallCard({ call, tick, selected, onSelect, onOpen }: {
  call: LiveCall; tick: number; selected: boolean; onSelect: () => void; onOpen: () => void;
}) {
  void tick;
  const started = new Date(call.started_at || (call as any).created_at || 0).getTime();
  const liveSeconds = started > 0 ? Math.floor((Date.now() - started) / 1000) : call.duration_live;
  const ls = call.live_state;
  const direction = ls?.is_inbound ? 'INBOUND' : (((call as any).direction || 'INBOUND') as string).toUpperCase();
  const channel = (call.channel || 'PHONE').toUpperCase();
  const isWeb = channel === 'WEB';

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border bg-white shadow-card p-4 cursor-pointer transition-all hover:shadow-md ${
        selected ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-100'
      }`}
    >
      {/* Top row: badges + duration */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-red-100 text-red-700">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
          </span>
          <span className={`inline-flex items-center gap-0.5 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-md ${
            direction === 'OUTBOUND' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'
          }`}>
            {direction === 'OUTBOUND' ? <PhoneOutgoing className="h-2.5 w-2.5" /> : <PhoneIncoming className="h-2.5 w-2.5" />}
            {direction === 'OUTBOUND' ? 'Out' : 'In'}
          </span>
          <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-md ${
            isWeb ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {channel}
          </span>
          {ls?.call_state && <StateBadge state={ls.call_state} />}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-mono font-bold text-gray-900 tabular-nums">{fmtDuration(liveSeconds)}</div>
        </div>
      </div>

      {/* Agent + numbers */}
      <div className="mb-2">
        <p className="text-sm font-display font-bold text-gray-900 truncate">{call.agent_name}</p>
        <p className="text-[10px] text-gray-500 font-mono truncate">{call.caller_number || '—'} → {call.called_number || '—'}</p>
      </div>

      {/* Provider pills */}
      {ls && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {ls.stt_backend && <ProviderPill label="STT" value={ls.stt_backend} icon={<Mic className="h-2.5 w-2.5" />} />}
          {ls.tts_backend && <ProviderPill label="TTS" value={ls.tts_backend} icon={<Volume2 className="h-2.5 w-2.5" />} />}
          {ls.language && <ProviderPill label="" value={ls.language} icon={<Globe className="h-2.5 w-2.5" />} />}
          {ls.dg_dead && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-bold">STT ✕</span>}
          {ls.stt_downshifted && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 font-bold">Fallback</span>}
        </div>
      )}

      {/* Latency bar */}
      {ls && (ls.ttft_ms != null || ls.ttfa_ms != null) && (
        <div className="flex items-center gap-3 mb-2 text-[10px]">
          {ls.ttft_ms != null && (
            <span className={`font-mono font-bold tabular-nums ${ls.ttft_ms > 1000 ? 'text-red-600' : ls.ttft_ms > 500 ? 'text-amber-600' : 'text-emerald-600'}`}>
              ⚡ {ls.ttft_ms}ms
            </span>
          )}
          {ls.ttfa_ms != null && (
            <span className={`font-mono font-bold tabular-nums ${ls.ttfa_ms > 700 ? 'text-red-600' : ls.ttfa_ms > 400 ? 'text-amber-600' : 'text-emerald-600'}`}>
              🔊 {ls.ttfa_ms}ms
            </span>
          )}
        </div>
      )}

      {/* Transcript preview */}
      <div className="space-y-1">
        <TranscriptLine role="user" text={call.latest_user} />
        <TranscriptLine role="assistant" text={call.latest_assistant} />
      </div>

      {/* Footer */}
      <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[10px] text-gray-500 inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {call.message_count_live ?? 0} msgs
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 text-[10px] font-semibold"
        >
          <Eye className="h-3 w-3" /> Full Detail
        </button>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const cfg = STATE_LABELS[state] || STATE_LABELS.IDLE;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-md ${cfg.color}`}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

function ProviderPill({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 font-semibold uppercase">
      {icon}
      {label ? `${label}: ` : ''}{value}
    </span>
  );
}

function LatencyMetric({ label, ms, threshold }: { label: string; ms: number; threshold: number }) {
  const color = ms > threshold ? 'text-red-600' : ms > threshold * 0.6 ? 'text-amber-600' : 'text-emerald-600';
  const barPct = Math.min(100, (ms / (threshold * 1.5)) * 100);
  const barColor = ms > threshold ? 'bg-red-500' : ms > threshold * 0.6 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500 font-medium">{label}</span>
        <span className={`text-xs font-mono font-bold tabular-nums ${color}`}>{ms}ms</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

function TranscriptLine({ role, text }: { role: 'user' | 'assistant'; text?: string }) {
  const isUser = role === 'user';
  if (!text) {
    return (
      <div className="text-[10px] text-gray-400 italic">
        {isUser ? 'Waiting for caller…' : 'Agent is listening…'}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-1.5 text-[10px]">
      <span className={`text-[8px] uppercase font-bold px-1 py-0.5 rounded mt-0.5 flex-shrink-0 ${
        isUser ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
      }`}>
        {isUser ? 'caller' : 'agent'}
      </span>
      <span className="text-gray-700 line-clamp-2">{text}</span>
    </div>
  );
}

const KPI_CLS: Record<string, string> = {
  red: 'border-red-200 bg-red-50/50 text-red-700',
  primary: 'border-primary-200 bg-primary-50/50 text-primary-700',
  teal: 'border-teal-200 bg-teal-50/50 text-teal-700',
  indigo: 'border-indigo-200 bg-indigo-50/50 text-indigo-700',
};

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border p-3 ${KPI_CLS[color] || KPI_CLS.primary}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold opacity-80">{icon}{label}</div>
      <div className="text-2xl font-display font-extrabold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
