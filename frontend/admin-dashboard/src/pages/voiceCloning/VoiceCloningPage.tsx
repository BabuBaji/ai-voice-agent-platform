import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mic, Square, Play, Pause, Upload, Trash2, Loader2, CheckCircle2,
  AlertCircle, FileAudio, X, Volume2, Sparkles, RefreshCw, Lock, Zap,
} from 'lucide-react';
import { voiceCloneApi, type ClonedVoice, type VoiceCloneQuota } from '@/services/voiceClone.api';
import { agentApi } from '@/services/agent.api';
import type { Agent } from '@/types';

type Msg = { type: 'success' | 'error'; text: string };

const GENDERS = [
  { value: '', label: 'Select gender' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'neutral', label: 'Neutral' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'te', label: 'Telugu' },
  { value: 'ta', label: 'Tamil' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'mr', label: 'Marathi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'pt', label: 'Portuguese' },
];

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceCloningPage() {
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [quota, setQuota] = useState<VoiceCloneQuota | null>(null);

  const refreshQuota = async () => {
    try { setQuota(await voiceCloneApi.quota()); } catch { /* non-fatal */ }
  };

  // Form
  const [name, setName] = useState('');
  const [gender, setGender] = useState('female');
  const [language, setLanguage] = useState('en');
  const [description, setDescription] = useState('');

  // Sample
  const [sampleBlob, setSampleBlob] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleDuration, setSampleDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Recorder
  const [isRecording, setIsRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vuRafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const [submitting, setSubmitting] = useState(false);

  // Load list on mount
  const reload = async () => {
    setLoadingList(true);
    try {
      const list = await voiceCloneApi.list();
      setVoices(list);
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Failed to load voices: ' + (err?.message || '') });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { reload(); refreshQuota(); }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sampleUrl) URL.revokeObjectURL(sampleUrl);
      stopRecording(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = (silent = false) => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (vuRafRef.current) { cancelAnimationFrame(vuRafRef.current); vuRafRef.current = null; }
    try {
      mediaRecorderRef.current?.stop();
    } catch { /* already stopped */ }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setIsRecording(false);
    if (!silent) setRecordElapsed(0);
  };

  const startRecording = async () => {
    setMsg(null);
    if (sampleUrl) { URL.revokeObjectURL(sampleUrl); setSampleUrl(null); }
    setSampleBlob(null);
    setSampleDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // VU meter
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128);
          if (v > peak) peak = v;
        }
        setMicLevel(Math.min(100, Math.round((peak / 128) * 200)));
        vuRafRef.current = requestAnimationFrame(loop);
      };
      vuRafRef.current = requestAnimationFrame(loop);

      // Recorder
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      recordedChunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setSampleBlob(blob);
        setSampleUrl(url);
      };

      rec.start();
      setIsRecording(true);
      setRecordElapsed(0);
      timerRef.current = setInterval(() => {
        setRecordElapsed((s) => {
          // Cap at 3 minutes
          if (s + 1 >= 180) {
            stopRecording();
            return 180;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Microphone access denied: ' + (err?.message || '') });
      stopRecording(true);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|m4a|webm|ogg)$/i)) {
      setMsg({ type: 'error', text: 'Please upload an audio file (mp3, wav, m4a, webm, ogg)' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMsg({ type: 'error', text: 'File too large — max 10 MB' });
      return;
    }
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    const url = URL.createObjectURL(file);
    setSampleBlob(file);
    setSampleUrl(url);
    setMsg(null);
    // Reset input so uploading the same file twice works
    e.target.value = '';
  };

  const clearSample = () => {
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    setSampleUrl(null);
    setSampleBlob(null);
    setSampleDuration(0);
    setIsPlaying(false);
  };

  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (isPlaying) { el.pause(); } else { el.play().catch(() => {}); }
  };

  const handleClone = async () => {
    if (!sampleBlob) { setMsg({ type: 'error', text: 'Please record or upload a voice sample first' }); return; }
    if (!name.trim()) { setMsg({ type: 'error', text: 'Voice name is required' }); return; }
    if (!gender) { setMsg({ type: 'error', text: 'Please select a gender' }); return; }

    setSubmitting(true);
    setMsg(null);
    try {
      await voiceCloneApi.create({
        audio: sampleBlob,
        name: name.trim(),
        gender,
        language,
        description: description.trim() || undefined,
      });
      setMsg({ type: 'success', text: `Voice "${name}" cloned successfully` });
      // Reset form
      setName(''); setDescription(''); clearSample();
      reload();
      refreshQuota();
    } catch (err: any) {
      const detail = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Clone failed';
      setMsg({ type: 'error', text: detail });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (v: ClonedVoice) => {
    if (!confirm(`Delete voice "${v.name}"? This cannot be undone.`)) return;
    try {
      await voiceCloneApi.delete(v.id);
      reload();
    } catch (err: any) {
      setMsg({ type: 'error', text: 'Delete failed: ' + (err?.message || '') });
    }
  };

  const handleRetry = async (v: ClonedVoice) => {
    try {
      const updated = await voiceCloneApi.retry(v.id);
      setVoices((prev) => prev.map((x) => (x.id === v.id ? updated : x)));
      if (updated.status === 'ready') {
        setMsg({ type: 'success', text: `"${v.name}" cloned successfully.` });
      } else {
        setMsg({ type: 'error', text: updated.error_message || 'Retry failed' });
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err?.response?.data?.message || 'Retry failed: ' + (err?.message || '') });
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-teal-600" /> Voice Cloning
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Record or upload a 30-second clean voice sample. We'll clone it via ElevenLabs and make it available in the
          voice selector for any agent.
        </p>
      </div>

      {/* Demo-quota banner. Hidden when the user is on a plan that includes
          voice_cloning (has_unlimited). Replaces the form with a paywall when
          the 50 free demo clones are used up. */}
      {quota && !quota.has_unlimited && (
        <div className={`rounded-2xl border p-4 ${quota.exhausted
            ? 'bg-rose-50 border-rose-200'
            : (quota.remaining ?? Infinity) <= 5 ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${quota.exhausted ? 'bg-rose-500' : (quota.remaining ?? Infinity) <= 5 ? 'bg-amber-500' : 'bg-teal-500'}`}>
              {quota.exhausted ? <Lock className="h-5 w-5 text-white" /> : <Zap className="h-5 w-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${quota.exhausted ? 'text-rose-900' : 'text-slate-900'}`}>
                {quota.exhausted
                  ? 'Demo limit reached'
                  : `${quota.used} / ${quota.limit} demo voice clones used`}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {quota.exhausted
                  ? `You've used all ${quota.limit} free demo clones. Upgrade your plan to keep cloning new voices.`
                  : `${quota.remaining} cloning attempt${quota.remaining === 1 ? '' : 's'} remaining on the free demo. Upgrade for unlimited.`}
              </p>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 bg-white/70 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${quota.exhausted ? 'bg-rose-500' : (quota.remaining ?? Infinity) <= 5 ? 'bg-amber-500' : 'bg-teal-500'}`}
                  style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }}
                />
              </div>
            </div>
            <Link to="/settings/pricing" className={`text-xs px-3 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 flex-shrink-0 ${quota.exhausted ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}>
              {quota.exhausted ? 'Upgrade now' : 'See pricing'}
            </Link>
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
            msg.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Recorder / uploader */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-gray-900 space-y-5">
          <h2 className="text-lg font-semibold">Voice Sample</h2>

          {!sampleUrl && !isRecording && (
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-teal-500/10 flex items-center justify-center mb-3">
                <Mic className="h-7 w-7 text-teal-400" />
              </div>
              <p className="text-gray-700 text-sm mb-4">Record a voice sample or upload an audio file</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={startRecording}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white text-sm font-medium shadow-[0_0_30px_rgba(20,184,166,0.2)]"
                >
                  <Mic className="h-4 w-4" /> Start Recording
                </button>
                <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-100 border border-gray-300 hover:bg-gray-200 text-gray-900 text-sm font-medium cursor-pointer">
                  <Upload className="h-4 w-4" /> Upload File
                  <input type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" className="hidden" onChange={handleUpload} />
                </label>
              </div>
              <p className="text-[11px] text-gray-500 mt-4">
                For best results: 30 seconds+ of clean speech, no background noise, mono 44.1kHz.
              </p>
            </div>
          )}

          {/* Recording in progress */}
          {isRecording && (
            <div className="border border-red-500/30 bg-red-500/5 rounded-xl p-6 text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Recording · {fmtTime(recordElapsed)}
              </div>

              {/* Animated mic orb */}
              <div className="relative mx-auto w-24 h-24">
                <div
                  className="absolute inset-0 rounded-full bg-red-500/30 transition-transform duration-100"
                  style={{ transform: `scale(${1 + micLevel / 150})` }}
                />
                <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.4)]">
                  <Mic className="h-10 w-10 text-white" />
                </div>
              </div>

              {/* VU bars */}
              <div className="flex items-center justify-center gap-1 h-10">
                {Array.from({ length: 24 }).map((_, i) => {
                  const base = micLevel;
                  const h = Math.max(4, Math.min(36, base + Math.sin(Date.now() / 120 + i) * 10));
                  return (
                    <div key={i} className="w-1 rounded-full bg-gradient-to-t from-red-500 to-pink-400 transition-all duration-100" style={{ height: `${h}px` }} />
                  );
                })}
              </div>

              <button
                onClick={() => stopRecording()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-red-600 hover:bg-white/90 text-sm font-medium"
              >
                <Square className="h-4 w-4" /> Stop Recording
              </button>
              <p className="text-[11px] text-gray-500">Auto-stops at 3:00</p>
            </div>
          )}

          {/* Playback of recorded/uploaded sample */}
          {sampleUrl && !isRecording && (
            <div className="border border-gray-200 rounded-xl p-5 bg-gray-50 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                  <FileAudio className="h-6 w-6 text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    Sample ready · {sampleDuration > 0 ? fmtTime(sampleDuration) : 'unknown length'}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {(sampleBlob && Math.round(sampleBlob.size / 1024))} KB · {sampleBlob?.type || 'audio'}
                  </div>
                </div>
                <button
                  onClick={clearSample}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                  title="Discard"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white flex items-center justify-center"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </button>
                <audio
                  ref={audioElRef}
                  src={sampleUrl}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onLoadedMetadata={(e) => {
                    // Chromium MediaRecorder WebM bug: duration is Infinity, making
                    // seeking & playback unreliable. Force a re-scan by seeking to a
                    // huge offset then back to 0 — browser then reports real duration.
                    const el = e.target as HTMLAudioElement;
                    if (!isFinite(el.duration) || isNaN(el.duration)) {
                      const onTimeUpdate = () => {
                        el.removeEventListener('timeupdate', onTimeUpdate);
                        el.currentTime = 0;
                        setSampleDuration(isFinite(el.duration) ? el.duration : 0);
                      };
                      el.addEventListener('timeupdate', onTimeUpdate);
                      el.currentTime = 1e101;
                    } else {
                      setSampleDuration(el.duration || 0);
                    }
                  }}
                  controls
                  className="flex-1 [&::-webkit-media-controls-panel]:bg-white/5"
                />
              </div>

              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Volume2 className="h-3 w-3" /> Listen back — if quality is poor, re-record or upload a cleaner file.
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-gray-900 space-y-5">
          <h2 className="text-lg font-semibold">Voice Details</h2>

          <div>
            <label className="text-sm font-semibold text-gray-700">Voice Name <span className="text-red-400">*</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My Professional Voice"
              className="mt-2 block w-full rounded-lg bg-white border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/50"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700">Gender <span className="text-red-400">*</span></label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="mt-2 block w-full rounded-lg bg-white border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/50"
            >
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700">Language <span className="text-red-400">*</span></label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="mt-2 block w-full rounded-lg bg-white border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/50"
            >
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700">Description <span className="text-gray-500 text-xs font-normal">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this voice or its intended use..."
              rows={3}
              className="mt-2 block w-full rounded-lg bg-white border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/50"
            />
          </div>

          <button
            onClick={handleClone}
            disabled={submitting || !sampleBlob || !name.trim() || !gender || (quota?.exhausted && !quota?.has_unlimited)}
            className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {quota?.exhausted && !quota?.has_unlimited ? <Lock className="h-4 w-4" /> : submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {quota?.exhausted && !quota?.has_unlimited
              ? 'Demo limit reached — upgrade to clone'
              : submitting ? 'Cloning voice...' : 'Clone Voice'}
          </button>
        </div>
      </div>

      {/* List of cloned voices */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Cloned Voices</h2>
        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : voices.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Mic className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No cloned voices yet. Clone your first one above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {voices.map((v) => (
              <ClonedVoiceCard key={v.id} voice={v} onDelete={() => handleDelete(v)} onRetry={() => handleRetry(v)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClonedVoiceCard({
  voice, onDelete, onRetry,
}: {
  voice: ClonedVoice;
  onDelete: () => void;
  onRetry: () => Promise<void>;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  const loadSample = async () => {
    if (blobUrl) return;
    setLoading(true);
    try {
      const blob = await voiceCloneApi.fetchSample(voice.id);
      setBlobUrl(URL.createObjectURL(blob));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 hover:border-teal-300 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 truncate">{voice.name}</div>
          <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
            {voice.gender && <span className="capitalize">{voice.gender}</span>}
            {voice.language && <><span>·</span><span>{voice.language.toUpperCase()}</span></>}
            {voice.provider && <><span>·</span><span className="text-teal-600 capitalize">{voice.provider}</span></>}
          </div>
        </div>
        <button onClick={onDelete} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {voice.description && <p className="text-xs text-gray-600 mb-2 line-clamp-2">{voice.description}</p>}

      {voice.status === 'error' ? (
        <div className="space-y-2">
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">
            {voice.error_message || 'Cloning failed'}
          </div>
          {voice.error_message?.includes('missing_permissions') && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 leading-relaxed">
              Your ElevenLabs API key isn't allowed to clone voices. Fix:
              <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                <li>
                  Open <a className="underline font-medium" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">ElevenLabs → API Keys</a>
                </li>
                <li>Create a new key with <strong>Voices → Create Instant Voice Clone</strong> checked</li>
                <li>Paste it into <code className="px-1 py-0.5 bg-white rounded text-[10px]">.env</code> as <code className="px-1 py-0.5 bg-white rounded text-[10px]">ELEVENLABS_API_KEY</code> and restart agent-service</li>
              </ol>
            </div>
          )}
          {(voice.error_message?.includes('paid_plan_required')
            || voice.error_message?.includes('can_not_use_instant_voice_cloning')
            || voice.error_message?.includes('payment_required')) && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 leading-relaxed">
              Your ElevenLabs plan doesn't include Instant Voice Cloning. Cloning is locked behind paid tiers.
              <div className="mt-1.5">
                <a
                  className="inline-flex items-center gap-1 underline font-medium"
                  href="https://elevenlabs.io/app/subscription"
                  target="_blank"
                  rel="noreferrer"
                >
                  Upgrade on ElevenLabs →
                </a>
                <span className="text-amber-700/80 ml-2">Starter plan (~$5/mo) unlocks it.</span>
              </div>
            </div>
          )}
          <button
            onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }}
            disabled={retrying}
            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-medium disabled:opacity-50"
          >
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {retrying ? 'Retrying...' : 'Retry clone'}
          </button>
        </div>
      ) : !blobUrl ? (
        <button
          onClick={loadSample}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-medium"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {loading ? 'Loading...' : 'Play sample'}
        </button>
      ) : (
        <audio
          ref={audioRef}
          src={blobUrl}
          controls
          className="w-full h-8"
          onLoadedMetadata={(e) => {
            const el = e.target as HTMLAudioElement;
            if (!isFinite(el.duration) || isNaN(el.duration)) {
              const onTimeUpdate = () => {
                el.removeEventListener('timeupdate', onTimeUpdate);
                el.currentTime = 0;
              };
              el.addEventListener('timeupdate', onTimeUpdate);
              el.currentTime = 1e101;
            }
          }}
        />
      )}

      {voice.status === 'ready' && (
        <>
          <TestVoicePanel voiceId={voice.id} />
          <AssignToAgentPanel voiceId={voice.id} language={voice.language} />
        </>
      )}

      {voice.provider_voice_id && (
        <div className="text-[10px] font-mono text-gray-400 mt-2 truncate" title={voice.provider_voice_id}>
          ID: {voice.provider_voice_id}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TestVoicePanel — type text + tone/speed sliders + language → generate &
// play audio. Uses the new POST /voice-clones/:id/test endpoint.
// ---------------------------------------------------------------------------

function TestVoicePanel({ voiceId }: { voiceId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('Hello! This is my cloned voice. I can speak naturally in English and Telugu.');
  const [speed, setSpeed] = useState(1.0);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  const generate = async () => {
    if (!text.trim()) return;
    setGenerating(true); setErr(null);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
    try {
      const blob = await voiceCloneApi.test(voiceId, {
        text: text.trim(),
        speed,
        stability,
        similarity,
      });
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Synthesis failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full inline-flex items-center justify-between py-1 text-[11px] font-medium text-gray-600 hover:text-gray-900"
      >
        <span className="inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-indigo-500" /> Test this voice
        </span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Type any text — works in Telugu, English, Hindi…"
            className="w-full rounded-md border border-gray-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
          />
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <label className="block">
              <span className="text-gray-500">Speed ({speed.toFixed(2)}x)</span>
              <input
                type="range"
                min="0.5" max="2" step="0.05"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="text-gray-500">Stability ({stability.toFixed(2)})</span>
              <input
                type="range"
                min="0" max="1" step="0.05"
                value={stability}
                onChange={(e) => setStability(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="text-gray-500">Similarity ({similarity.toFixed(2)})</span>
              <input
                type="range"
                min="0" max="1" step="0.05"
                value={similarity}
                onChange={(e) => setSimilarity(Number(e.target.value))}
                className="w-full"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !text.trim()}
            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />}
            {generating ? 'Generating…' : 'Generate & play'}
          </button>
          {err && (
            <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1">{err}</div>
          )}
          {audioUrl && (
            <audio src={audioUrl} controls autoPlay className="w-full h-7" />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssignToAgentPanel — fetches agents on first open, lets the user pick one
// and POSTs to /voice-clones/:id/assign-to-agent. Shows a success pill.
// ---------------------------------------------------------------------------

function AssignToAgentPanel({ voiceId, language }: { voiceId: string; language: string | null }) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentId, setAgentId] = useState('');
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const toggleOpen = async () => {
    setOpen(!open);
    setResult(null);
    if (!open && agents === null) {
      setLoadingAgents(true);
      try {
        const list = await agentApi.list();
        setAgents(Array.isArray(list) ? list : []);
      } catch {
        setAgents([]);
      } finally {
        setLoadingAgents(false);
      }
    }
  };

  const assign = async () => {
    if (!agentId) return;
    setAssigning(true); setResult(null);
    try {
      await voiceCloneApi.assignToAgent(voiceId, {
        agent_id: agentId,
        language: language || 'en',
      });
      const agent = agents?.find((a) => a.id === agentId);
      setResult({ ok: true, msg: `Attached to "${agent?.name || 'agent'}". Calls will now use this voice.` });
    } catch (e: any) {
      setResult({ ok: false, msg: e?.response?.data?.message || e?.message || 'Assignment failed' });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full inline-flex items-center justify-between py-1 text-[11px] font-medium text-gray-600 hover:text-gray-900"
      >
        <span className="inline-flex items-center gap-1">
          <Mic className="h-3 w-3 text-teal-600" /> Use with an agent
        </span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {loadingAgents ? (
            <div className="text-[11px] text-gray-500 inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading your agents…
            </div>
          ) : agents && agents.length === 0 ? (
            <div className="text-[11px] text-gray-500">No agents yet. Create one to attach this voice.</div>
          ) : agents ? (
            <div className="flex gap-1.5">
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-100"
              >
                <option value="">— pick an agent —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={assign}
                disabled={!agentId || assigning}
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-semibold disabled:opacity-50"
              >
                {assigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Attach
              </button>
            </div>
          ) : null}
          {result && (
            <div
              className={`text-[11px] rounded-md px-2 py-1 ${
                result.ok
                  ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
                  : 'text-red-700 bg-red-50 border border-red-100'
              }`}
            >
              {result.msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
