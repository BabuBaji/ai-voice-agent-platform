import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Mic, MicOff, Phone, PhoneOff,
  Loader2, AlertCircle, Activity, Volume2, Play, Download,
  CheckCircle2, Bot, User as UserIcon, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { agentApi } from '@/services/agent.api';
import { webCallApi, type WebCallAnalysis, type WebCallStartRequest } from '@/services/webCall.api';
import { WebCallSetupModal } from '@/components/webcall/WebCallSetupModal';

type CallState = 'setup' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

type Turn = {
  speaker: 'user' | 'agent';
  text: string;
  partial?: boolean;
  time?: string;
  language?: string;
};

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Web Call live session page. Mirrors the OmniDimension-style experience:
 *   Setup modal → mic permission → Connecting → Listening/Thinking/Speaking → Ended → Analysis
 */
export function AgentWebCallPage() {
  const { id: agentId } = useParams();
  const navigate = useNavigate();

  const [agentName, setAgentName] = useState('Agent');
  const [agentGreeting, setAgentGreeting] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(true);
  const [callId, setCallId] = useState<string | null>(null);
  const [config, setConfig] = useState<WebCallStartRequest | null>(null);
  const [state, setState] = useState<CallState>('setup');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState<string>('');
  const [durationSec, setDurationSec] = useState<number>(0);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<WebCallAnalysis | null>(null);
  const [recordingUrls, setRecordingUrls] = useState<{ kind: string; url: string }[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsBufRef = useRef<Uint8Array[]>([]);
  const ttsFormatRef = useRef<'mp3' | 'wav'>('mp3');
  const stoppedSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch agent name for the header
  useEffect(() => {
    if (!agentId) return;
    agentApi.get(agentId).then((a: any) => {
      setAgentName(a?.name || 'Agent');
      setAgentGreeting(a?.greeting_message || null);
    }).catch(() => {});
  }, [agentId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      teardown('unmounted');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wsBaseUrl = useMemo(() => {
    // ai-runtime WS is exposed directly (no gateway proxy for WS). In dev it's
    // on localhost:8000; in production set VITE_AI_RUNTIME_WS_URL appropriately.
    const override = (import.meta as any).env?.VITE_AI_RUNTIME_WS_URL as string | undefined;
    if (override) return override.replace(/\/$/, '');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    // Vite dev runs on :5173 while ai-runtime is :8000 → use hostname + :8000
    return `${proto}//${host}:8000`;
  }, []);

  const handleStarted = async (newCallId: string, cfg: WebCallStartRequest) => {
    setCallId(newCallId);
    setConfig(cfg);
    setError(null);
    setTurns([]);
    setAnalysis(null);
    setRecordingUrls([]);
    setEndReason(null);
    setState('connecting');
    try {
      await beginCall(newCallId, cfg);
    } catch (e: any) {
      setError(e?.message || 'Failed to start call');
      setState('ended');
    }
  };

  const beginCall = async (newCallId: string, cfg: WebCallStartRequest) => {
    // 1. Request microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
    } catch (e: any) {
      throw new Error('Microphone permission denied. Please allow mic access and try again.');
    }
    streamRef.current = stream;

    // 2. Open WS
    const ws = new WebSocket(`${wsBaseUrl}/ws/webcall/${newCallId}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start_call', call_id: newCallId }));
      startTsRef.current = Date.now();
      setDurationSec(0);
      tickRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startTsRef.current) / 1000));
      }, 500);

      // Start MediaRecorder → 250ms timeslice
      const mr = new MediaRecorder(stream, { mimeType: pickMime() });
      recorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0 && ws.readyState === WebSocket.OPEN && !muted) {
          ev.data.arrayBuffer().then((buf) => {
            ws.send(buf);
            // Fire an utterance-end nudge when the user pauses
            if (stoppedSpeakingTimerRef.current) clearTimeout(stoppedSpeakingTimerRef.current);
            stoppedSpeakingTimerRef.current = setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'user_stopped_speaking' }));
              }
            }, 1200);
          });
        }
      };
      mr.start(250);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        handleJson(ev.data);
      } else {
        // Binary: TTS audio chunk
        ttsBufRef.current.push(new Uint8Array(ev.data));
      }
    };

    ws.onerror = () => {
      setError('Connection error');
    };

    ws.onclose = () => {
      if (state !== 'ended') {
        teardownLocal();
        setState('ended');
      }
    };
  };

  const handleJson = (raw: string) => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'call_started':
        setState('listening');
        break;
      case 'listening':
        setState('listening');
        break;
      case 'partial_transcript':
        setPartial(msg.text || '');
        break;
      case 'final_transcript':
        setPartial('');
        setTurns((t) => [...t, {
          speaker: 'user',
          text: msg.text,
          language: msg.language,
          time: fmtDuration(Math.floor((Date.now() - startTsRef.current) / 1000)),
        }]);
        break;
      case 'agent_thinking':
        setState('thinking');
        break;
      case 'agent_response_text':
        setTurns((t) => [...t, {
          speaker: 'agent',
          text: msg.text,
          language: msg.language,
          time: fmtDuration(Math.floor((Date.now() - startTsRef.current) / 1000)),
        }]);
        break;
      case 'agent_audio':
        ttsBufRef.current = [];
        ttsFormatRef.current = msg.format === 'wav' ? 'wav' : 'mp3';
        setState('speaking');
        break;
      case 'agent_audio_end':
        flushTtsToAudio();
        break;
      case 'agent_speaking':
        setState('speaking');
        break;
      case 'recording_saved':
        setRecordingUrls((arr) => [...arr, { kind: msg.kind, url: msg.url }]);
        break;
      case 'call_ended':
        setEndReason(msg.reason || 'ended');
        teardownLocal();
        setState('ended');
        break;
      case 'analysis_ready':
        setAnalysis(msg.analysis);
        break;
      case 'error':
        setError(msg.message || 'Server error');
        break;
      default:
        break;
    }
  };

  const flushTtsToAudio = () => {
    if (ttsBufRef.current.length === 0) return;
    const totalLen = ttsBufRef.current.reduce((s, a) => s + a.length, 0);
    const joined = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of ttsBufRef.current) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    ttsBufRef.current = [];
    const mime = ttsFormatRef.current === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const blob = new Blob([joined], { type: mime });
    const url = URL.createObjectURL(blob);
    const el = audioElRef.current || new Audio();
    audioElRef.current = el;
    el.src = url;
    el.onended = () => {
      URL.revokeObjectURL(url);
      setState('listening');
    };
    el.play().catch(() => {
      setState('listening');
    });
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((t) => (t.enabled = !next));
      }
      return next;
    });
  };

  const interrupt = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt_agent' }));
    }
    if (audioElRef.current) {
      try { audioElRef.current.pause(); } catch {}
    }
    setState('listening');
  };

  const endCall = async (reason: string = 'user_ended') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end_call', reason }));
    }
    // Also call REST as a belt-and-braces — idempotent
    if (callId) {
      try {
        await webCallApi.end(callId, { end_reason: reason, duration_seconds: durationSec });
      } catch (_e) { /* ignore */ }
    }
    teardownLocal();
    setState('ended');
  };

  const teardownLocal = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (stoppedSpeakingTimerRef.current) { clearTimeout(stoppedSpeakingTimerRef.current); stoppedSpeakingTimerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
  };

  const teardown = (_reason: string) => {
    teardownLocal();
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
  };

  const statusLabel = state === 'setup' ? 'Ready'
    : state === 'connecting' ? 'Connecting...'
    : state === 'listening' ? 'Listening'
    : state === 'thinking' ? 'Thinking'
    : state === 'speaking' ? 'Speaking'
    : 'Ended';

  const statusPulse =
    state === 'listening' ? 'bg-green-500' :
    state === 'thinking' ? 'bg-amber-500' :
    state === 'speaking' ? 'bg-indigo-500' :
    state === 'ended' ? 'bg-gray-400' :
    'bg-blue-500';

  const fetchAnalysis = async () => {
    if (!callId) return;
    try {
      const a = await webCallApi.runAnalysis(callId);
      setAnalysis(a);
    } catch (_e) { /* ignore */ }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot className="h-7 w-7 text-indigo-500" /> Web Call — {agentName}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {state === 'setup' ? 'Configure and start a browser-based voice call.' : `Status: ${statusLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state !== 'setup' && state !== 'ended' && (
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${statusPulse} animate-pulse`} />
              <span className="text-sm font-medium text-gray-700">{statusLabel}</span>
              <span className="text-sm text-gray-400 ml-2 tabular-nums">{fmtDuration(durationSec)}</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {state === 'setup' && (
        <Card className="p-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
            <Phone className="h-8 w-8 text-indigo-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Ready to start?</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            You'll be asked to share microphone access. Pick your language and voice in the next step.
          </p>
          <div className="mt-4">
            <Button onClick={() => setShowSetup(true)}>
              <Phone className="h-4 w-4 mr-2" /> Configure & Start
            </Button>
          </div>
        </Card>
      )}

      {(state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Agent avatar + status */}
          <Card className="lg:col-span-1 p-6 flex flex-col items-center">
            <div className={`relative w-32 h-32 rounded-full flex items-center justify-center ${state === 'speaking' ? 'bg-indigo-100 ring-4 ring-indigo-300 animate-pulse' : 'bg-gray-100'}`}>
              <Bot className="h-16 w-16 text-indigo-600" />
              {state === 'speaking' && (
                <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-9 h-9 rounded-full bg-indigo-600 text-white">
                  <Volume2 className="h-5 w-5" />
                </span>
              )}
            </div>
            <div className="mt-4 text-center">
              <div className="font-semibold text-gray-900">{agentName}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">{statusLabel}</div>
              <div className="text-xs text-gray-400 mt-2">
                {config?.primary_language}
                {config?.voice_name ? ` · ${config.voice_name}` : ''}
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2">
              <Button variant={muted ? 'secondary' : 'ghost'} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" onClick={interrupt} title="Interrupt agent">
                <Activity className="h-4 w-4" />
              </Button>
              <Button variant="danger" onClick={() => endCall('user_ended')}>
                <PhoneOff className="h-4 w-4 mr-1" /> End Call
              </Button>
            </div>

            {config?.recording_enabled && (
              <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Recording
              </div>
            )}
          </Card>

          {/* Live transcript */}
          <Card className="lg:col-span-2 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Live Transcript</div>
            <div className="max-h-[420px] overflow-y-auto space-y-2">
              {turns.length === 0 && (
                <div className="text-sm text-gray-400 py-6 text-center">Waiting for conversation to begin...</div>
              )}
              {turns.map((t, i) => (
                <div key={i} className={`flex gap-2 ${t.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${t.speaker === 'user' ? 'bg-indigo-50 text-indigo-900' : 'bg-gray-100 text-gray-900'}`}>
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">
                      {t.speaker === 'user' ? <UserIcon className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      {t.speaker} {t.time ? `· ${t.time}` : ''} {t.language ? `· ${t.language}` : ''}
                    </div>
                    <div>{t.text}</div>
                  </div>
                </div>
              ))}
              {partial && (
                <div className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl px-3 py-2 text-sm bg-indigo-50/60 text-indigo-800 italic">
                    {partial}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {state === 'ended' && (
        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-green-600" />
              </div>
              <div>
                <div className="font-semibold text-gray-900">Call ended</div>
                <div className="text-sm text-gray-500">
                  Duration {fmtDuration(durationSec)}{endReason ? ` · ${endReason}` : ''}
                </div>
              </div>
              <div className="ml-auto">
                <Button onClick={() => { setShowSetup(true); setState('setup'); }} variant="secondary">
                  Start another call
                </Button>
              </div>
            </div>
          </Card>

          {recordingUrls.length > 0 && (
            <Card className="p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recording</div>
              <div className="space-y-3">
                {recordingUrls.map((r) => (
                  <div key={r.kind} className="flex items-center gap-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 uppercase">{r.kind}</span>
                    <audio controls src={r.url} className="flex-1" />
                    <a href={r.url} download className="text-sm text-indigo-600 flex items-center gap-1">
                      <Download className="h-4 w-4" /> Download
                    </a>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transcript</div>
            </div>
            <div className="max-h-[340px] overflow-y-auto space-y-2 mt-2">
              {turns.map((t, i) => (
                <div key={i} className={`flex gap-2 ${t.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${t.speaker === 'user' ? 'bg-indigo-50 text-indigo-900' : 'bg-gray-100 text-gray-900'}`}>
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">
                      {t.speaker} {t.time ? `· ${t.time}` : ''}
                    </div>
                    <div>{t.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI Analysis</div>
              </div>
              {!analysis && (
                <Button size="sm" variant="secondary" onClick={fetchAnalysis}>
                  <Play className="h-3 w-3 mr-1" /> Generate analysis
                </Button>
              )}
            </div>
            {!analysis ? (
              <div className="mt-3 text-sm text-gray-500">
                Analysis will appear here a few seconds after the call ends.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <KV label="Summary" value={analysis.summary} />
                <KV label="Detailed Summary" value={analysis.detailed_summary} />
                <KV label="Customer Intent" value={analysis.customerIntent} />
                <KV label="Sentiment" value={analysis.sentiment} />
                <KV label="Interest Level" value={analysis.interestLevel} />
                <KV label="Lead Score" value={analysis.leadScore} />
                <KV label="Next Best Action" value={analysis.nextBestAction} />
                <KV label="Follow-up Required" value={String(analysis.followUpRequired)} />
                <KV label="Agent Performance" value={analysis.agentPerformanceScore} />
                {analysis.objections?.length > 0 && (
                  <KV label="Objections" value={analysis.objections.join(', ')} />
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {agentId && (
        <WebCallSetupModal
          open={showSetup && state === 'setup'}
          onClose={() => setShowSetup(false)}
          agentId={agentId}
          onStarted={handleStarted}
        />
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-gray-900 mt-0.5 whitespace-pre-wrap">{value || <span className="text-gray-400">—</span>}</div>
    </div>
  );
}

function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && (MediaRecorder as any).isTypeSupported?.(m)) return m;
  }
  return 'audio/webm';
}
