import { useRef, useState } from 'react';
import { Play, Square, Loader2, AudioLines, Volume2 } from 'lucide-react';
import api from '@/services/api';

type Voice = { id: string; label: string; gender: 'Female' | 'Male' };

const SARVAM_VOICES: Voice[] = [
  { id: 'anushka', label: 'Anushka', gender: 'Female' },
  { id: 'manisha', label: 'Manisha', gender: 'Female' },
  { id: 'vidya', label: 'Vidya', gender: 'Female' },
  { id: 'arya', label: 'Arya', gender: 'Female' },
  { id: 'abhilash', label: 'Abhilash', gender: 'Male' },
  { id: 'karun', label: 'Karun', gender: 'Male' },
  { id: 'hitesh', label: 'Hitesh', gender: 'Male' },
];

const DEEPGRAM_VOICES: Voice[] = [
  { id: 'asteria', label: 'Asteria', gender: 'Female' },
  { id: 'luna', label: 'Luna', gender: 'Female' },
  { id: 'stella', label: 'Stella', gender: 'Female' },
  { id: 'hera', label: 'Hera', gender: 'Female' },
  { id: 'athena', label: 'Athena', gender: 'Female' },
  { id: 'orion', label: 'Orion', gender: 'Male' },
  { id: 'arcas', label: 'Arcas', gender: 'Male' },
  { id: 'zeus', label: 'Zeus', gender: 'Male' },
  { id: 'perseus', label: 'Perseus', gender: 'Male' },
  { id: 'angus', label: 'Angus', gender: 'Male' },
  { id: 'orpheus', label: 'Orpheus', gender: 'Male' },
  { id: 'helios', label: 'Helios', gender: 'Male' },
];

const SARVAM_LANGS = [
  { code: 'te-IN', label: 'Telugu' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'en-IN', label: 'English' },
];

export function VoicesPage() {
  const [lang, setLang] = useState('te-IN');
  // key = `${provider}:${voiceId}` of whatever is loading / playing
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlayingKey(null);
  };

  const play = async (provider: 'sarvam' | 'deepgram', voice: Voice) => {
    const key = `${provider}:${voice.id}`;
    // Toggle off if this one is already playing.
    if (playingKey === key) { stop(); return; }
    stop();
    setErrors((e) => ({ ...e, [key]: '' }));
    setLoadingKey(key);
    try {
      const params: Record<string, string> = { provider, voice: voice.id };
      if (provider === 'sarvam') params.lang = lang;
      const resp = await api.get('/voice-preview', { params, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data as Blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stop();
      audio.onerror = () => { setErrors((e) => ({ ...e, [key]: 'Playback failed' })); stop(); };
      await audio.play();
      setPlayingKey(key);
    } catch (err: any) {
      let msg = 'Preview failed';
      // Blob error responses need to be read as text.
      const blob = err?.response?.data;
      if (blob instanceof Blob) {
        try { const j = JSON.parse(await blob.text()); msg = j.error || j.detail || msg; } catch { /* keep default */ }
      } else if (err?.message) {
        msg = err.message;
      }
      setErrors((e) => ({ ...e, [key]: msg }));
    } finally {
      setLoadingKey(null);
    }
  };

  const VoiceCard = ({ provider, voice }: { provider: 'sarvam' | 'deepgram'; voice: Voice }) => {
    const key = `${provider}:${voice.id}`;
    const isLoading = loadingKey === key;
    const isPlaying = playingKey === key;
    const err = errors[key];
    return (
      <div className={`flex items-center justify-between rounded-xl border bg-white px-4 py-3 transition-shadow ${isPlaying ? 'border-indigo-400 shadow-md shadow-indigo-100' : 'border-slate-200 hover:shadow-sm'}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{voice.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${voice.gender === 'Female' ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'}`}>{voice.gender}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
            {provider === 'sarvam' ? `bulbul:v2 · ${voice.id}` : `aura-${voice.id}-en`}
          </div>
          {err && <div className="text-[11px] text-red-500 mt-1">{err}</div>}
        </div>
        <button
          onClick={() => play(provider, voice)}
          disabled={isLoading}
          className={`shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
            isPlaying ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600'
          } disabled:opacity-60`}
          title={isPlaying ? 'Stop' : 'Play sample'}
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-5 w-5 ml-0.5" />}
        </button>
      </div>
    );
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
          <AudioLines className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Voice Library</h1>
          <p className="text-xs text-slate-500">Audition every TTS voice available to the platform. Click play to hear a real sample.</p>
        </div>
      </div>

      {/* Sarvam */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-indigo-500" />
            <h2 className="font-semibold text-slate-700">Sarvam · Bulbul v2 <span className="text-slate-400 font-normal">({SARVAM_VOICES.length} voices · Indic + English)</span></h2>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {SARVAM_LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${lang === l.code ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SARVAM_VOICES.map((v) => <VoiceCard key={v.id} provider="sarvam" voice={v} />)}
        </div>
      </section>

      {/* Deepgram */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Volume2 className="h-4 w-4 text-emerald-500" />
          <h2 className="font-semibold text-slate-700">Deepgram · Aura <span className="text-slate-400 font-normal">({DEEPGRAM_VOICES.length} voices · English)</span></h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DEEPGRAM_VOICES.map((v) => <VoiceCard key={v.id} provider="deepgram" voice={v} />)}
        </div>
      </section>

      <p className="text-[11px] text-slate-400 mt-8">
        Samples are synthesized live via each provider's API using the platform keys. Sarvam previews use the selected language; Deepgram Aura is English-only.
        The agent currently assigned voice is <span className="font-mono text-slate-500">vidya</span> (Sarvam, Telugu).
      </p>
    </div>
  );
}
