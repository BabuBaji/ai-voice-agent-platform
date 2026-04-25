import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Bot,
  ArrowLeft, MessageSquare, TrendingUp, Clock, Hash,
  Sparkles, User, FileText, Lightbulb, AlertTriangle, Send, Loader2, X,
} from 'lucide-react';
import { agentApi } from '@/services/agent.api';
import { conversationApi, type ConversationAnalysis } from '@/services/conversation.api';
import { voiceApi, toDeepgramLang } from '@/services/voice.api';

interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

type CallState = 'preamble' | 'connected' | 'ending' | 'ended';

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { resolve(voices); return; }
    const handler = () => {
      const v = window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = null;
      resolve(v);
    };
    window.speechSynthesis.onvoiceschanged = handler;
    setTimeout(() => {
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    }, 1500);
  });
}

function findVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  let match = voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase());
  if (match) return match;
  const base = lang.split('-')[0].toLowerCase();
  match = voices.find((v) => v.lang?.toLowerCase().startsWith(base));
  return match || null;
}

export function AgentCallPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [agentName, setAgentName] = useState('AI Agent');
  const [agentGreeting, setAgentGreeting] = useState('Hello! How can I help you today?');
  const [requestedLanguage, setRequestedLanguage] = useState('en-US');
  const [languageWarning, setLanguageWarning] = useState<string | null>(null);

  const [callState, setCallState] = useState<CallState>('preamble');
  const [elapsed, setElapsed] = useState(0);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecordingTurn, setIsRecordingTurn] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [micAllowed, setMicAllowed] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [micLevel, setMicLevel] = useState(0); // 0-100 VU-meter value
  const [showTranscript, setShowTranscript] = useState(false);

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [savingText, setSavingText] = useState('');

  // Refs
  const callStateRef = useRef<CallState>('preamble');
  const isSpeakerOnRef = useRef(true);
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const agentVoiceIdRef = useRef<string | null>(null);
  const requestedLanguageRef = useRef('en-US');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const fullCallRecorderRef = useRef<MediaRecorder | null>(null);
  const fullCallChunksRef = useRef<Blob[]>([]);
  const turnRecorderRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const chatHistoryRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const pttActiveRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vuRafRef = useRef<number | null>(null);

  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { isSpeakerOnRef.current = isSpeakerOn; }, [isSpeakerOn]);
  useEffect(() => { requestedLanguageRef.current = requestedLanguage; }, [requestedLanguage]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Fetch agent + create conversation
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const agent: any = await agentApi.get(id);
        if (cancelled) return;
        setAgentName(agent.name || 'AI Agent');
        setAgentGreeting(
          agent.greeting_message || agent.greetingMessage || agent.greeting || 'Hello! How can I help you today?'
        );
        const vc = agent.voice_config || agent.voiceConfig || {};
        const reqLang = vc.language || vc.lang || 'en-US';
        setRequestedLanguage(reqLang);
        agentVoiceIdRef.current = vc.voice_id || vc.voiceId || null;

        const voices = await loadVoices();
        let voice = findVoice(voices, reqLang);
        if (!voice) voice = findVoice(voices, 'en-US');
        ttsVoiceRef.current = voice;

        try {
          const conv = await conversationApi.create({
            agent_id: id,
            channel: 'WEB',
            language: reqLang,
            metadata: { source: 'web-call-page' },
          });
          if (!cancelled) {
            setConversationId(conv.id);
            conversationIdRef.current = conv.id;
          }
        } catch (e) { console.warn('Conv create failed:', e); }
      } catch (e) { console.warn('Agent fetch failed:', e); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const persistMessage = useCallback((role: 'user' | 'assistant', content: string, latencyMs?: number) => {
    const cid = conversationIdRef.current;
    if (!cid || !content.trim()) return;
    conversationApi
      .appendMessage(cid, { role, content: content.trim(), latency_ms: latencyMs })
      .catch((e) => console.warn('persist msg failed:', e));
  }, []);

  // ---------- TTS ----------
  const speakViaBrowser = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = requestedLanguageRef.current;
      if (ttsVoiceRef.current) u.voice = ttsVoiceRef.current;
      u.onstart = () => setIsSpeaking(true);
      u.onend = () => { setIsSpeaking(false); resolve(); };
      u.onerror = () => { setIsSpeaking(false); resolve(); };
      window.speechSynthesis.speak(u);
      // Safety timeout
      const estMs = Math.max(2500, Math.min(15000, text.length * 70));
      setTimeout(() => { setIsSpeaking(false); resolve(); }, estMs + 500);
    });
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!isSpeakerOnRef.current || !text) return;
    // Pause STT while agent speaks to prevent feedback loop
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ok */ }
    }
    setIsSpeaking(true);
    try {
      const audioUrl = await voiceApi.synthesize(text, agentVoiceIdRef.current || undefined);
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* ok */ } }
      const el = new Audio(audioUrl);
      audioElRef.current = el;
      await new Promise<void>((resolve) => {
        el.onended = () => { URL.revokeObjectURL(audioUrl); setIsSpeaking(false); resolve(); };
        el.onerror = () => { URL.revokeObjectURL(audioUrl); setIsSpeaking(false); resolve(); };
        el.play().catch(() => { setIsSpeaking(false); resolve(); });
      });
    } catch (e) {
      console.warn('voice-service TTS failed, using browser TTS:', e);
      await speakViaBrowser(text);
    }
    // Resume STT after agent done speaking
    if (callStateRef.current === 'connected' && recognitionRef.current) {
      try { recognitionRef.current.start(); } catch { /* already started */ }
    }
  }, [speakViaBrowser]);

  // ---------- LLM ----------
  const sendToAgent = useCallback(async (text: string) => {
    if (!id || !text.trim()) return;
    const userText = text.trim();
    setTranscript((prev) => [...prev, { role: 'user', text: userText, timestamp: Date.now() }]);
    persistMessage('user', userText);
    setAiLoading(true);
    const history = [...chatHistoryRef.current];
    chatHistoryRef.current = [...history, { role: 'user', content: userText }];
    const sentAt = Date.now();
    try {
      const response = await agentApi.test(id, userText, history);
      const reply = (response as any).reply || (response as any).response || (response as any).message || 'Let me think about that.';
      chatHistoryRef.current = [...chatHistoryRef.current, { role: 'assistant', content: reply }];
      setTranscript((prev) => [...prev, { role: 'assistant', text: reply, timestamp: Date.now() }]);
      persistMessage('assistant', reply, Date.now() - sentAt);
      await speak(reply);
    } catch (e) {
      console.warn('Agent test call failed:', e);
      const fallback = "I'm having trouble reaching the AI right now. Could you try again?";
      chatHistoryRef.current = [...chatHistoryRef.current, { role: 'assistant', content: fallback }];
      setTranscript((prev) => [...prev, { role: 'assistant', text: fallback, timestamp: Date.now() }]);
      persistMessage('assistant', fallback);
      await speak(fallback);
    } finally {
      setAiLoading(false);
    }
  }, [id, speak, persistMessage]);

  // ---------- Mic / recorders ----------
  const startMicStream = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError('Browser does not support microphone access. You can still type.');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Attach a VU meter so the user can visually confirm the mic is hot.
      try {
        const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const ctx = new AudioContextCtor();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128);
            if (v > peak) peak = v;
          }
          // Map 0-128 -> 0-100
          setMicLevel(Math.min(100, Math.round((peak / 128) * 100)));
          vuRafRef.current = requestAnimationFrame(tick);
        };
        vuRafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        console.warn('VU meter setup failed:', e);
      }

      // Full-call recorder for storage
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      fullCallChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) fullCallChunksRef.current.push(e.data); };
      rec.start(1000);
      fullCallRecorderRef.current = rec;
      return true;
    } catch (err: any) {
      console.warn('getUserMedia failed:', err);
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        setPermissionError('Microphone access denied. You can still type to chat.');
      } else if (err?.name === 'NotFoundError') {
        setPermissionError('No microphone found. You can still type to chat.');
      } else {
        setPermissionError(`Mic unavailable: ${err?.message || err?.name}. You can still type.`);
      }
      return false;
    }
  }, []);

  const turnStartedAtRef = useRef<number>(0);

  const startTurnRecorder = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return false;
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      turnChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) turnChunksRef.current.push(e.data); };
      // No timeslice — flush once on stop() so we produce a single well-formed WebM
      // container. Timeslicing produces fragmented WebM that Deepgram can't decode.
      rec.start();
      turnRecorderRef.current = rec;
      turnStartedAtRef.current = Date.now();
      return true;
    } catch (e) {
      console.warn('startTurnRecorder failed:', e);
      return false;
    }
  }, []);

  const stopTurnRecorderAndTranscribe = useCallback(async (): Promise<void> => {
    const rec = turnRecorderRef.current;
    if (!rec || rec.state === 'inactive') return;

    const heldMs = Date.now() - turnStartedAtRef.current;

    // Reject clips shorter than ~600ms — Deepgram needs meaningful audio
    if (heldMs < 600) {
      try { rec.stop(); } catch { /* ok */ }
      turnRecorderRef.current = null;
      turnChunksRef.current = [];
      setLanguageWarning('Hold the mic button for at least 1 second, then release.');
      setTimeout(() => setLanguageWarning(null), 3000);
      return;
    }

    const mime = rec.mimeType || 'audio/webm';
    const blob: Blob | null = await new Promise((resolve) => {
      rec.onstop = () => {
        const b = turnChunksRef.current.length > 0 ? new Blob(turnChunksRef.current, { type: mime }) : null;
        resolve(b);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
    turnRecorderRef.current = null;
    turnChunksRef.current = [];
    if (!blob || blob.size < 2000) {
      setLanguageWarning('Audio clip was too short — hold the mic button and speak clearly for a second or more.');
      setTimeout(() => setLanguageWarning(null), 3000);
      return;
    }

    setTranscribing(true);
    try {
      const dgLang = toDeepgramLang(requestedLanguageRef.current);
      console.log(`[PTT] Sending ${blob.size} bytes (${heldMs}ms held) to Deepgram as language=${dgLang}`);
      const result = await voiceApi.transcribe(blob, dgLang);
      const text = (result?.text || '').trim();
      if (text) {
        setLanguageWarning(null);
        await sendToAgent(text);
      } else {
        setLanguageWarning(
          `Deepgram didn't detect speech (confidence ${Math.round((result?.confidence || 0) * 100)}%). Try speaking louder / closer to the mic, or type instead.`
        );
      }
    } catch (e) {
      console.warn('Transcription failed:', e);
      setLanguageWarning('Could not transcribe that clip. Try again, or type instead.');
    } finally {
      setTranscribing(false);
    }
  }, [sendToAgent]);

  // Push-to-talk handlers
  const handlePTTStart = useCallback(() => {
    if (!micAllowed || isSpeaking || transcribing || aiLoading || pttActiveRef.current) return;
    // Stop agent speech if user wants to interrupt
    window.speechSynthesis.cancel();
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* ok */ } }
    setIsSpeaking(false);
    pttActiveRef.current = true;
    setIsRecordingTurn(true);
    startTurnRecorder();
  }, [micAllowed, isSpeaking, transcribing, aiLoading, startTurnRecorder]);

  const handlePTTEnd = useCallback(async () => {
    if (!pttActiveRef.current) return;
    pttActiveRef.current = false;
    setIsRecordingTurn(false);
    await stopTurnRecorderAndTranscribe();
  }, [stopTurnRecorderAndTranscribe]);

  // Spacebar PTT
  useEffect(() => {
    if (callState !== 'connected') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handlePTTStart();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handlePTTEnd();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [callState, handlePTTStart, handlePTTEnd]);

  // Browser-native speech recognition — primary STT path (more reliable than MediaRecorder→Deepgram).
  const startBrowserRecognition = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = requestedLanguageRef.current || 'en-US';
      rec.onstart = () => setIsListening(true);
      rec.onresult = (event: any) => {
        const last = event.results[event.results.length - 1];
        const text = last[0].transcript;
        if (last.isFinal) {
          setInterimText('');
          if (text.trim()) sendToAgent(text.trim());
        } else {
          setInterimText(text);
        }
      };
      rec.onend = () => {
        setIsListening(false);
        if (callStateRef.current === 'connected' && !isSpeakingRef.current) {
          try { rec.start(); } catch { /* already started */ }
        }
      };
      rec.onerror = (e: any) => {
        setIsListening(false);
        if (e?.error === 'not-allowed') {
          setPermissionError('Microphone access was blocked. Check the 🔒 icon in the address bar.');
        } else if (e?.error === 'language-not-supported') {
          rec.lang = 'en-US';
          try { rec.start(); } catch { /* ok */ }
        }
      };
      rec.start();
      recognitionRef.current = rec;
      return true;
    } catch (e) {
      console.warn('SpeechRecognition failed to start:', e);
      return false;
    }
  }, [sendToAgent]);

  // Start call
  const handleStartCall = useCallback(async () => {
    // Unlock audio context via user gesture
    try {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
    } catch { /* ok */ }

    const gotMic = await startMicStream();
    setMicAllowed(gotMic);
    setCallState('connected');
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    // Seed greeting
    setTranscript([{ role: 'assistant', text: agentGreeting, timestamp: Date.now() }]);
    persistMessage('assistant', agentGreeting);
    chatHistoryRef.current = [{ role: 'assistant', content: agentGreeting }];
    await speak(agentGreeting);

    // Kick off browser STT automatically so user can just talk — no PTT needed
    if (gotMic) {
      setTimeout(() => startBrowserRecognition(), 500);
    }
  }, [agentGreeting, speak, startMicStream, persistMessage, startBrowserRecognition]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.speechSynthesis.cancel();
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* ok */ } }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ok */ }
      }
      if (fullCallRecorderRef.current && fullCallRecorderRef.current.state !== 'inactive') {
        try { fullCallRecorderRef.current.stop(); } catch { /* ok */ }
      }
      if (turnRecorderRef.current && turnRecorderRef.current.state !== 'inactive') {
        try { turnRecorderRef.current.stop(); } catch { /* ok */ }
      }
      if (vuRafRef.current) cancelAnimationFrame(vuRafRef.current);
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* ok */ } }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleSpeaker = () => {
    const next = !isSpeakerOn;
    setIsSpeakerOn(next);
    if (!next) {
      window.speechSynthesis.cancel();
      if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* ok */ } }
      setIsSpeaking(false);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = textInput.trim();
    if (!v) return;
    setTextInput('');
    sendToAgent(v);
  };

  const handleReplay = (text: string) => { speak(text); };

  // Stop call recording
  const stopFullRecordingAndGetBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = fullCallRecorderRef.current;
      if (!rec || rec.state === 'inactive') { resolve(null); return; }
      const mime = rec.mimeType || 'audio/webm';
      rec.onstop = () => {
        const blob = fullCallChunksRef.current.length > 0
          ? new Blob(fullCallChunksRef.current, { type: mime })
          : null;
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }
        resolve(blob);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }, []);

  const endCall = async () => {
    setCallState('ending');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    window.speechSynthesis.cancel();
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* ok */ } }
    setIsSpeaking(false);
    setIsRecordingTurn(false);

    const durationSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const cid = conversationIdRef.current;

    setSavingText('Saving recording...');
    const blob = await stopFullRecordingAndGetBlob();
    if (cid && blob) {
      try { await conversationApi.uploadRecording(cid, blob); }
      catch (e) { console.warn('Recording upload failed:', e); }
    }

    if (cid) {
      setSavingText('Finalizing call...');
      try { await conversationApi.end(cid, durationSec, { message_count: transcript.length }); }
      catch (e) { console.warn('Conversation end failed:', e); }
    }

    if (cid) {
      setSavingText('Analyzing conversation...');
      try {
        const result = await conversationApi.analyze(cid);
        setAnalysis(result);
      } catch (e) { console.warn('Analysis failed:', e); }
    }

    setSavingText('');
    setCallState('ended');
  };

  const sentimentConfig = {
    POSITIVE: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Positive' },
    NEUTRAL: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Neutral' },
    NEGATIVE: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'Negative' },
    MIXED: { color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Mixed' },
  } as const;

  // ---- PREAMBLE ----
  if (callState === 'preamble') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-gray-900 via-slate-900 to-gray-950 flex flex-col items-center justify-center p-6">
        <button
          onClick={() => navigate(-1)}
          className="absolute top-6 left-6 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-center space-y-6 max-w-md">
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(124,58,237,0.4)]">
            <Bot className="h-14 w-14 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{agentName}</h1>
            <p className="text-white/50 mt-1 text-sm">
              Ready when you are. Language: <span className="text-white/80 font-mono">{requestedLanguage}</span>
            </p>
          </div>
          <div className="text-left text-white/70 text-xs space-y-2 bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="font-semibold text-white/90">How to talk:</p>
            <p>🎤 <strong>Hold</strong> the big mic button <em>(or spacebar)</em> to speak. Release when done.</p>
            <p>⌨️ Or type in the text box.</p>
          </div>
          <button
            onClick={handleStartCall}
            className="w-full px-8 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white rounded-full font-semibold text-lg transition-all flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(20,184,166,0.3)]"
          >
            <Phone className="h-5 w-5" />
            Start Call
          </button>
        </div>
      </div>
    );
  }

  // ---- ENDING ----
  if (callState === 'ending') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full border-4 border-teal-500 border-t-transparent animate-spin mx-auto" />
          <h2 className="text-xl font-semibold text-white">{savingText || 'Wrapping up...'}</h2>
          <p className="text-gray-400 text-sm">Saving recording, transcript, and analysis</p>
        </div>
      </div>
    );
  }

  // ---- ENDED ----
  if (callState === 'ended') {
    const sentimentKey = (analysis?.sentiment || 'NEUTRAL') as keyof typeof sentimentConfig;
    const sentimentCfg = sentimentConfig[sentimentKey] || sentimentConfig.NEUTRAL;
    const interest = analysis?.interest_level ?? 50;
    const durationMinSec = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4 overflow-auto">
        <div className="w-full max-w-2xl space-y-6 py-8">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <PhoneOff className="h-8 w-8 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Call Ended</h1>
            <p className="text-gray-400 mt-1">with {agentName}</p>
          </div>

          {analysis && (
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-6">
              <div className="flex items-center gap-2 text-white">
                <Sparkles className="h-5 w-5 text-purple-400" />
                <h2 className="text-lg font-semibold">AI Call Analysis</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/5 rounded-xl p-4 text-center">
                  <Clock className="h-5 w-5 text-blue-400 mx-auto mb-2" />
                  <p className="text-xl font-bold text-white">{durationMinSec}</p>
                  <p className="text-xs text-gray-400 mt-1">Duration</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4 text-center">
                  <Hash className="h-5 w-5 text-purple-400 mx-auto mb-2" />
                  <p className="text-xl font-bold text-white">{transcript.length}</p>
                  <p className="text-xs text-gray-400 mt-1">Messages</p>
                </div>
                <div className={`${sentimentCfg.bg} rounded-xl p-4 text-center`}>
                  <TrendingUp className={`h-5 w-5 ${sentimentCfg.color} mx-auto mb-2`} />
                  <p className={`text-xl font-bold ${sentimentCfg.color}`}>{sentimentCfg.label}</p>
                  <p className="text-xs text-gray-400 mt-1">Sentiment</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4 text-center">
                  <Sparkles className="h-5 w-5 text-teal-400 mx-auto mb-2" />
                  <p className="text-xl font-bold text-teal-400">{interest}%</p>
                  <p className="text-xs text-gray-400 mt-1">Interest</p>
                </div>
              </div>
              {analysis.topics && analysis.topics.length > 0 && (
                <div>
                  <p className="text-sm text-gray-400 mb-2">Topics Discussed</p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.topics.map((topic) => (
                      <span key={topic} className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-sm">{topic}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-400 mb-2 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Summary</p>
                <p className="text-gray-200 text-sm leading-relaxed">{analysis.summary}</p>
              </div>
              {analysis.follow_ups && analysis.follow_ups.length > 0 && (
                <div>
                  <p className="text-sm text-gray-400 mb-2 flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5" /> Suggested Follow-ups</p>
                  <ul className="space-y-2">
                    {analysis.follow_ups.map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-200">
                        <span className="text-teal-400">→</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.outcome && (
                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <span className="text-sm text-gray-400">Outcome</span>
                  <span className="text-sm font-semibold text-white">{analysis.outcome}</span>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-sm text-gray-400 mb-2">Full Transcript</p>
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 max-h-60 overflow-y-auto space-y-2 scrollbar-thin">
              {transcript.map((entry, i) => (
                <div key={i} className={`flex gap-2 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    entry.role === 'user'
                      ? 'bg-blue-500/20 text-blue-200 rounded-br-md'
                      : 'bg-white/10 text-gray-200 rounded-bl-md'
                  }`}>
                    <p className="text-[10px] uppercase tracking-wider mb-1 opacity-50">
                      {entry.role === 'user' ? 'You' : agentName}
                    </p>
                    {entry.text}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            {conversationId && (
              <button
                onClick={() => navigate(`/calls/${conversationId}`)}
                className="px-6 py-3 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white rounded-full font-medium transition-colors flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                View Full Call Detail
              </button>
            )}
            <button
              onClick={() => navigate(`/agents/${id}`)}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full font-medium transition-colors flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- CONNECTED ----
  const bigStatus = isSpeaking
    ? 'Speaking'
    : aiLoading
    ? 'Thinking'
    : transcribing
    ? 'Processing'
    : isRecordingTurn
    ? 'Recording'
    : isListening
    ? 'Listening'
    : 'Ready';

  const showAnimatedDots = isSpeaking || aiLoading || transcribing;
  const orbScale = isSpeaking ? 1 + Math.min(0.12, (micLevel > 20 ? 0 : 0) + 0.05) : 1 + Math.min(0.15, micLevel / 400);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0e1a] flex flex-col overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full blur-3xl transition-all duration-1000 ${
            isSpeaking
              ? 'bg-gradient-to-br from-purple-500/25 via-fuchsia-500/20 to-pink-500/25'
              : isListening || isRecordingTurn
              ? 'bg-gradient-to-br from-teal-500/15 via-cyan-500/15 to-blue-500/15'
              : 'bg-gradient-to-br from-violet-500/8 via-purple-500/8 to-indigo-500/8'
          }`}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.08),_transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(20,184,166,0.06),_transparent_50%)]" />
      </div>

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-6 py-4 z-10">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          title="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3 text-white/70 text-sm">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="font-medium">Live</span>
          </div>
          <span className="text-white/20">·</span>
          <span className="tabular-nums font-mono">{formatTime(elapsed)}</span>
          <span className="text-white/20">·</span>
          <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] uppercase tracking-wide">{requestedLanguage}</span>
        </div>
        <button
          onClick={() => setShowTranscript((s) => !s)}
          className={`relative p-2 rounded-full transition-colors ${
            showTranscript ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/10'
          }`}
          title="Transcript"
        >
          <MessageSquare className="h-5 w-5" />
          {transcript.length > 0 && !showTranscript && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-500 text-[10px] font-bold text-white flex items-center justify-center">
              {transcript.length}
            </span>
          )}
        </button>
      </div>

      {/* Warnings */}
      {(permissionError || languageWarning) && (
        <div className="relative px-6 space-y-2 pb-2 z-10">
          {permissionError && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              {permissionError}
            </div>
          )}
          {languageWarning && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              {languageWarning}
            </div>
          )}
        </div>
      )}

      {/* Main stage */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 z-10">
        {/* Agent name */}
        <p className="text-[11px] text-white/40 uppercase tracking-[0.3em] mb-2 font-medium">{agentName}</p>

        {/* Status text */}
        <h1 className="text-4xl md:text-5xl font-extralight text-white mb-10 min-h-[60px] flex items-center gap-1">
          {bigStatus}
          {showAnimatedDots && (
            <span className="inline-flex items-end gap-1 ml-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </h1>

        {/* Audio-reactive orb */}
        <div className="relative mb-10">
          {isSpeaking && (
            <>
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/30 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute -inset-8 rounded-full bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 animate-ping" style={{ animationDuration: '3s' }} />
              <div className="absolute -inset-16 rounded-full bg-gradient-to-br from-purple-500/10 to-pink-500/10 animate-ping" style={{ animationDuration: '4s' }} />
            </>
          )}
          {(isListening || isRecordingTurn) && !isSpeaking && (
            <div
              className="absolute inset-0 rounded-full bg-teal-500/30 transition-transform duration-100"
              style={{ transform: `scale(${1 + Math.min(0.6, micLevel / 120)})` }}
            />
          )}
          <div
            className={`relative w-48 h-48 md:w-56 md:h-56 rounded-full flex items-center justify-center transition-all duration-300 ${
              isSpeaking
                ? 'bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 shadow-[0_0_120px_rgba(168,85,247,0.5)]'
                : isListening || isRecordingTurn
                ? 'bg-gradient-to-br from-teal-500 via-cyan-500 to-blue-500 shadow-[0_0_90px_rgba(20,184,166,0.45)]'
                : aiLoading
                ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 shadow-[0_0_90px_rgba(245,158,11,0.35)]'
                : 'bg-gradient-to-br from-violet-600 to-purple-700 shadow-[0_0_60px_rgba(124,58,237,0.3)]'
            }`}
            style={{ transform: `scale(${orbScale})` }}
          >
            <div className="absolute inset-4 rounded-full bg-white/10 blur-xl" />
            <div className="absolute inset-8 rounded-full bg-white/5 blur-2xl" />
            <Bot className="relative h-20 w-20 text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.3)]" />
          </div>
        </div>

        {/* Waveform bars */}
        <div className="flex items-center justify-center gap-1 h-12 mb-4">
          {Array.from({ length: 28 }).map((_, i) => {
            const base = isSpeaking ? 40 : isListening || isRecordingTurn ? micLevel : 4;
            const wave = Math.sin(Date.now() / 200 + i * 0.5) * 20;
            const height = Math.max(4, Math.min(48, base + wave + (i % 3) * 4));
            return (
              <div
                key={i}
                className={`w-1 rounded-full transition-all duration-150 ${
                  isSpeaking
                    ? 'bg-gradient-to-t from-purple-500 to-pink-400'
                    : isListening || isRecordingTurn
                    ? 'bg-gradient-to-t from-teal-500 to-cyan-400'
                    : 'bg-white/10'
                }`}
                style={{ height: `${isSpeaking || isListening || isRecordingTurn ? height : 6}px` }}
              />
            );
          })}
        </div>

        {/* Live interim text */}
        {interimText && (
          <div className="px-5 py-2 bg-white/5 backdrop-blur-sm rounded-full border border-white/10 max-w-md animate-fade-in">
            <p className="text-white/70 text-sm italic truncate">"{interimText}..."</p>
          </div>
        )}

        {/* Mic-no-input hint */}
        {micAllowed && micLevel < 3 && isListening && !isSpeaking && (
          <p className="text-[11px] text-yellow-400/80 mt-3 text-center max-w-xs">
            No mic input detected — check device + OS permissions.
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className="relative px-6 pb-10 z-10">
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={toggleSpeaker}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
              !isSpeakerOn
                ? 'bg-yellow-500/20 text-yellow-400 ring-2 ring-yellow-500/40'
                : 'bg-white/5 border border-white/10 text-white/80 hover:bg-white/10'
            }`}
            title={isSpeakerOn ? 'Mute speaker' : 'Unmute speaker'}
          >
            {isSpeakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          {/* Big PTT / mic button */}
          <button
            onMouseDown={handlePTTStart}
            onMouseUp={handlePTTEnd}
            onMouseLeave={handlePTTEnd}
            onTouchStart={(e) => { e.preventDefault(); handlePTTStart(); }}
            onTouchEnd={(e) => { e.preventDefault(); handlePTTEnd(); }}
            disabled={!micAllowed || aiLoading || transcribing || isSpeaking}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all select-none disabled:opacity-30 disabled:cursor-not-allowed ${
              isRecordingTurn
                ? 'bg-red-500 scale-110 shadow-[0_0_50px_rgba(239,68,68,0.7)] ring-4 ring-red-500/40'
                : 'bg-white/10 border border-white/20 text-white hover:bg-white/20 hover:scale-105'
            }`}
            title="Hold to talk (or press Space)"
          >
            {isRecordingTurn ? <MicOff className="h-8 w-8 text-white" /> : <Mic className="h-8 w-8" />}
          </button>

          <button
            onClick={endCall}
            className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-[0_0_30px_rgba(239,68,68,0.4)]"
            title="End Call"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </div>

        <p className="text-center text-[11px] text-white/30 mt-4 tracking-wide">
          {isListening && !isRecordingTurn
            ? 'Speak naturally — continuous listening active'
            : 'Hold the mic button or press '}
          {!(isListening && !isRecordingTurn) && <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 text-[10px]">Space</kbd>}
          {!(isListening && !isRecordingTurn) && ' to talk'}
        </p>
      </div>

      {/* Slide-in transcript panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 w-full max-w-md bg-black/85 backdrop-blur-2xl border-l border-white/10 z-30 transform transition-transform duration-300 ease-out flex flex-col ${
          showTranscript ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-white/60" />
            <h3 className="text-white font-medium">Live Transcript</h3>
          </div>
          <button
            onClick={() => setShowTranscript(false)}
            className="p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
          {transcript.length === 0 && (
            <p className="text-center text-white/30 text-sm py-8">Transcript will appear here as you talk.</p>
          )}
          {transcript.map((entry, i) => (
            <div key={i} className={`flex gap-2.5 ${entry.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div
                className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                  entry.role === 'user' ? 'bg-blue-500/20' : 'bg-purple-500/20'
                }`}
              >
                {entry.role === 'user' ? (
                  <User className="h-3.5 w-3.5 text-blue-400" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-purple-400" />
                )}
              </div>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm relative group ${
                  entry.role === 'user'
                    ? 'bg-blue-500/20 text-blue-100 rounded-tr-sm'
                    : 'bg-white/10 text-gray-200 rounded-tl-sm'
                }`}
              >
                {entry.text}
                {entry.role === 'assistant' && (
                  <button
                    onClick={() => handleReplay(entry.text)}
                    className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-purple-500/40 hover:bg-purple-500/70 text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Replay"
                  >
                    <Volume2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {(aiLoading || transcribing) && (
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-purple-400" />
              </div>
              <div className="bg-white/10 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        <form onSubmit={handleTextSubmit} className="p-3 border-t border-white/10 flex gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type instead..."
            className="flex-1 rounded-full bg-white/5 border border-white/10 px-4 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/40"
            disabled={aiLoading || transcribing}
          />
          <button
            type="submit"
            disabled={!textInput.trim() || aiLoading || transcribing}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 disabled:opacity-30 text-white flex items-center justify-center transition-colors"
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
