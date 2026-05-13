import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Phone, ArrowDownLeft, ArrowUpRight, Globe, MessageSquare,
  Loader2, Eye, Pause, Play, RefreshCw, AlertCircle, Radio,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { conversationApi, Conversation, ConversationMessage } from '@/services/conversation.api';
import { agentApi } from '@/services/agent.api';

const POLL_MS = 3000;
const STALE_MS = 5 * 60 * 1000;
const TRANSCRIPT_LIMIT = 8;

interface LiveCall extends Conversation {
  agent_name: string;
  duration_live: number;
  latest_user?: string;
  latest_assistant?: string;
  message_count_live?: number;
}

export function LiveCallsPage() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [agentMap, setAgentMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [tick, setTick] = useState(0); // re-renders duration counter every 1s
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

      // Fetch transcripts for the top-N most recent calls in parallel.
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
        return {
          ...c,
          agent_name: map.get(c.agent_id) || 'Agent',
          duration_live: started > 0 ? Math.floor((now - started) / 1000) : 0,
          latest_user: latestUser?.content,
          latest_assistant: latestAsst?.content,
          message_count_live: msgs.length || c.message_count,
        };
      });
      setCalls(rows);
      setError(null);
      setLastFetched(new Date());
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to fetch live calls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchOnce, paused]);

  // Local 1s ticker so the duration counter advances smoothly between polls.
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const activeCount = calls.length;
  const totalAgents = useMemo(() => new Set(calls.map((c) => c.agent_id)).size, [calls]);

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Radio className="h-5 w-5 text-red-500 animate-pulse" /> Live Calls
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
              {activeCount} active
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All in-flight calls for your workspace. Polls every {POLL_MS / 1000}s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[11px] text-gray-500 font-mono">
              updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} className="rounded-lg">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={<Activity className="h-4 w-4" />} label="Active calls" value={activeCount} accent="red" />
        <SummaryCard icon={<Phone className="h-4 w-4" />} label="Agents busy" value={totalAgents} accent="primary" />
        <SummaryCard
          icon={<ArrowDownLeft className="h-4 w-4" />}
          label="Inbound"
          value={calls.filter((c) => (((c as any).direction || (c.metadata as any)?.direction || 'INBOUND') as string).toUpperCase() === 'INBOUND').length}
          accent="emerald"
        />
        <SummaryCard
          icon={<ArrowUpRight className="h-4 w-4" />}
          label="Outbound"
          value={calls.filter((c) => (((c as any).direction || (c.metadata as any)?.direction || 'INBOUND') as string).toUpperCase() === 'OUTBOUND').length}
          accent="blue"
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
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : calls.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Phone className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">No live calls right now</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              When a call comes in or you launch a campaign, it will appear here in real time with a live transcript.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {calls.map((c) => <CallCard key={c.id} call={c} tick={tick} onOpen={() => navigate(`/calls/${c.id}`)} />)}
        </div>
      )}
    </div>
  );
}

function CallCard({ call, tick, onOpen }: { call: LiveCall; tick: number; onOpen: () => void }) {
  // Recompute duration locally on every tick so it doesn't appear frozen
  // between server polls.
  void tick;
  const started = new Date(call.started_at || (call as any).created_at || 0).getTime();
  const liveSeconds = started > 0 ? Math.floor((Date.now() - started) / 1000) : call.duration_live;
  const direction = (((call as any).direction || (call.metadata as any)?.direction || 'INBOUND') as string).toUpperCase();
  const channel = (call.channel || 'PHONE').toUpperCase();
  const isWeb = channel === 'WEB';

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
              direction === 'OUTBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
            }`}>
              {direction === 'OUTBOUND' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
              {direction}
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
              isWeb ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
            }`}>
              {isWeb ? <Globe className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
              {channel}
            </span>
            {call.language && (
              <span className="text-[10px] uppercase font-mono text-gray-500 px-1.5 py-0.5 rounded bg-gray-100">
                {call.language}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-sm font-semibold text-gray-900 truncate">{call.agent_name}</div>
          <div className="text-[11px] text-gray-500 font-mono truncate">
            {call.caller_number || '—'} → {call.called_number || '—'}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-mono font-semibold text-gray-900 tabular-nums">{fmtDuration(liveSeconds)}</div>
          <div className="text-[10px] text-gray-400 uppercase">duration</div>
        </div>
      </div>

      <div className="space-y-1.5">
        <TranscriptLine role="user" text={call.latest_user} />
        <TranscriptLine role="assistant" text={call.latest_assistant} />
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {call.message_count_live ?? 0} {call.message_count_live === 1 ? 'msg' : 'msgs'}
        </span>
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 text-[11px] font-medium"
        >
          <Eye className="h-3 w-3" /> Open
        </button>
      </div>
    </Card>
  );
}

function TranscriptLine({ role, text }: { role: 'user' | 'assistant'; text?: string }) {
  const isUser = role === 'user';
  if (!text) {
    return (
      <div className="text-[11px] text-gray-400 italic">
        {isUser ? 'Waiting for caller…' : 'Agent is listening…'}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-1.5 text-[11px]">
      <span className={`text-[9px] uppercase font-semibold px-1 py-0.5 rounded mt-0.5 flex-shrink-0 ${
        isUser ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
      }`}>
        {isUser ? 'caller' : 'agent'}
      </span>
      <span className="text-gray-700 line-clamp-2">{text}</span>
    </div>
  );
}

function SummaryCard({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: number;
  accent: 'red' | 'primary' | 'emerald' | 'blue';
}) {
  const cls = {
    red:     'border-red-200 bg-red-50/40 text-red-700',
    primary: 'border-primary-200 bg-primary-50/40 text-primary-700',
    emerald: 'border-emerald-200 bg-emerald-50/40 text-emerald-700',
    blue:    'border-blue-200 bg-blue-50/40 text-blue-700',
  }[accent];
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase font-semibold opacity-80">{icon}{label}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
