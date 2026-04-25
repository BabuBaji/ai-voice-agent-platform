import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, Phone, PhoneOff, Activity, Loader2, AlertCircle, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { agentApi } from '@/services/agent.api';

type Turn = { role: 'user' | 'assistant'; text: string; partial?: boolean; ts: number };

/**
 * Live streaming voice call — sub-second latency path.
 *
 * Connects to ai-runtime's `/ws/voice/:agentId` and streams mic chunks live
 * (via MediaRecorder timeslice). Receives:
 *   • interim+final transcripts as text frames
 *   • TTS reply audio as binary chunks (queued and played via MediaSource API)
 *
 * This is intentionally simpler than full WebRTC — single WS, no SDP/ICE — but
 * the latency feel is comparable for typical office network conditions because
 * STT runs on streaming partials and TTS bytes start arriving while OpenAI is
 * still generating.
 */
export function AgentLiveCallPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agentName, setAgentName] = useState<string>('Agent');
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'live' | 'ended'>('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState<string>('');
  const [speaking, setSpeaking] = useState(false);
  const [stats, setStats] = useState({ chunks: 0, ttsBytes: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Per-reply audio buffer — flushed to a blob and played when reply_done arrives
  const ttsBufRef = useRef<Uint8Array[]>([]);
  const playQueueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  // Fetch agent metadata for the header
  useEffect(() => {
    if (!id) return;
    agentApi.get(id).then((a: any) => {
      setAgentName(a?.name || 'Agent');
      setAgentStatus(a?.status || '');
    }).catch(() => {});
  }, [id]);

  const playNextFromQueue = () => {
    if (playingRef.current) return;
    const next = playQueueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    setSpeaking(true);
    const el = audioElRef.current || new Audio();
    audioElRef.current = el;
    el.src = next;
    el.onended = () => {
      playingRef.current = false;
      setSpeaking(false);
      URL.revokeObjectURL(next);
      playNextFromQueue();
    };
    el.onerror = () => {
      playingRef.current = false;
      setSpeaking(false);
      URL.revokeObjectURL(next);
      playNextFromQueue();
    };
    el.play().catch(() => {
      playingRef.current = false;
      setSpeaking(false);
    });
  };

  const flushTtsBuffer = () => {
    if (ttsBufRef.current.length === 0) return;
    const totalLen = ttsBufRef.current.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of ttsBufRef.current) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    ttsBufRef.current = [];
    const blob = new Blob([merged], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    playQueueRef.current.push(url);
    playNextFromQueue();
  };

  const startCall = async () => {
    if (!id) return;
    setError(null);
    setCallState('connecting');
    setTurns([]);
    setPartial('');
    setStats({ chunks: 0, ttsBytes: 0 });

    // Resolve API host — same origin works in prod; in dev we have to point at ai-runtime directly
    const apiHost = (import.meta.env.VITE_PUBLIC_AI_RUNTIME_URL as string | undefined)
      || `${window.location.protocol}//${window.location.hostname}:8000`;
    const wsUrl = apiHost.replace(/^http/, 'ws') + `/ws/voice/${id}`;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e: any) {
      setError(`Microphone access denied: ${e?.message || 'unknown'}`);
      setCallState('idle');
      return;
    }
    mediaStreamRef.current = stream;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start' }));
      // Start MediaRecorder feeding the WS in 250ms chunks
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        e.data.arrayBuffer().then((buf) => {
          ws.send(buf);
          setStats((s) => ({ ...s, chunks: s.chunks + 1 }));
        }).catch(() => {});
      };
      rec.start(250);
      setCallState('live');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        let m: any;
        try { m = JSON.parse(event.data); } catch { return; }
        switch (m.type) {
          case 'transcript_partial':
            setPartial(m.text || '');
            break;
          case 'transcript_final':
            setPartial('');
            setTurns((t) => [...t, { role: 'user', text: m.text, ts: Date.now() }]);
            break;
          case 'reply_text':
            setTurns((t) => [...t, { role: 'assistant', text: m.text, ts: Date.now() }]);
            ttsBufRef.current = []; // start a fresh audio buffer for this reply
            break;
          case 'reply_done':
            flushTtsBuffer();
            break;
          case 'conversation_id':
            // could store somewhere if we want to thread across page reloads
            break;
          case 'tts_error':
            setError(`TTS: ${m.message}`);
            break;
          case 'error':
            setError(m.message || 'server error');
            break;
        }
      } else if (event.data instanceof ArrayBuffer) {
        const chunk = new Uint8Array(event.data);
        ttsBufRef.current.push(chunk);
        setStats((s) => ({ ...s, ttsBytes: s.ttsBytes + chunk.byteLength }));
      }
    };

    ws.onerror = () => setError('WebSocket connection error');
    ws.onclose = () => {
      setCallState('ended');
      stopMedia();
    };
  };

  const stopMedia = () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  const endCall = () => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
        wsRef.current.close();
      }
    } catch {}
    wsRef.current = null;
    stopMedia();
    setCallState('ended');
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      mediaStreamRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = !next; });
      return next;
    });
  };

  // Cleanup on unmount
  useEffect(() => () => { try { wsRef.current?.close(); } catch {}; stopMedia(); }, []);

  const isActive = callState === 'connecting' || callState === 'live';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(`/agents/${id}`)} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary-600" /> Live Call · {agentName}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Streaming Deepgram STT + chunked OpenAI TTS over a single WebSocket. Sub-second latency.
          </p>
        </div>
        {agentStatus && agentStatus !== 'ACTIVE' && (
          <span className="text-xs px-2 py-1 rounded bg-warning-100 text-warning-700 font-medium">
            Agent is {agentStatus} — switch to ACTIVE for production calls
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className={`relative flex h-3 w-3`}>
              {callState === 'live' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${
                callState === 'live' ? 'bg-success-500' :
                callState === 'connecting' ? 'bg-amber-500' :
                callState === 'ended' ? 'bg-gray-400' : 'bg-gray-300'
              }`} />
            </span>
            <span className="text-sm font-medium text-gray-700">
              {callState === 'idle' ? 'Ready' : callState === 'connecting' ? 'Connecting…' : callState === 'live' ? 'Live' : 'Ended'}
            </span>
            {speaking && (
              <span className="text-xs text-primary-600 flex items-center gap-1 animate-pulse">
                <Volume2 className="h-3.5 w-3.5" /> Agent speaking
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isActive ? (
              <Button variant="primary" onClick={startCall} disabled={callState === 'connecting' || agentStatus !== 'ACTIVE'}>
                {callState === 'connecting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Start live call
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={toggleMute}>
                  {muted ? <><MicOff className="h-4 w-4" /> Unmute</> : <><Mic className="h-4 w-4" /> Mute</>}
                </Button>
                <Button variant="outline" onClick={endCall} className="border-danger-200 text-danger-700 hover:bg-danger-50">
                  <PhoneOff className="h-4 w-4" /> Hang up
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Live partial transcript */}
        {partial && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-500 italic">
            {partial}
            <span className="inline-block w-1.5 h-3 bg-primary-400 ml-1 animate-pulse align-middle" />
          </div>
        )}

        {/* Turn-by-turn transcript */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
          {turns.length === 0 && callState === 'idle' && (
            <div className="text-center py-10 text-sm text-gray-400">
              <Mic className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Click <strong>Start live call</strong> to begin.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                  t.role === 'user'
                    ? 'bg-primary-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                }`}
              >
                {t.text}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
          <span>chunks sent: {stats.chunks}</span>
          <span>tts received: {(stats.ttsBytes / 1024).toFixed(1)} KB</span>
          <span>turns: {turns.length}</span>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">How this works</h3>
        <ul className="text-xs text-gray-600 space-y-1.5 leading-relaxed">
          <li><strong>Mic → server:</strong> the browser's MediaRecorder produces 250ms Opus chunks; we stream them over a WebSocket as binary frames.</li>
          <li><strong>STT:</strong> ai-runtime forwards each chunk to Deepgram's streaming endpoint and pushes back partial+final transcripts in real time.</li>
          <li><strong>LLM + reply:</strong> on each final transcript we run the agent (same path as the chat widget), then stream the OpenAI TTS bytes straight back over the same WebSocket.</li>
          <li><strong>Playback:</strong> reply audio bytes accumulate per turn and play in sequence so the agent never interrupts itself.</li>
          <li className="text-amber-700"><strong>Requires:</strong> DEEPGRAM_API_KEY for STT and OPENAI_API_KEY (or compatible TTS) — we'll show the actual error in the box above if either is missing or out of credit.</li>
        </ul>
      </Card>
    </div>
  );
}
