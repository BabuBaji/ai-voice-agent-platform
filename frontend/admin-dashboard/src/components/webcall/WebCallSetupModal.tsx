import { useMemo, useState } from 'react';
import { Globe, Mic, Volume2, Save, PlayCircle, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { webCallApi, type WebCallStartRequest } from '@/services/webCall.api';

type Props = {
  open: boolean;
  onClose: () => void;
  agentId: string;
  onStarted: (callId: string, config: WebCallStartRequest) => void;
};

// Supported STT/TTS languages for the web call. Telugu + Indian English are
// the primary targets per product spec; additional Indic locales are included
// because Azure Speech + Sarvam already support them.
const LANGUAGES = [
  { code: 'en-IN', label: 'English (Indian)' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'pa-IN', label: 'Punjabi' },
] as const;

const VOICE_CATALOG: Record<string, Array<{ name: string; label: string; gender: 'female' | 'male'; provider: 'azure' | 'openai' | 'sarvam' }>> = {
  'en-IN': [
    { name: 'en-IN-NeerjaNeural', label: 'Neerja (Azure, warm)', gender: 'female', provider: 'azure' },
    { name: 'en-IN-PrabhatNeural', label: 'Prabhat (Azure)', gender: 'male', provider: 'azure' },
    { name: 'nova', label: 'Nova (OpenAI, natural)', gender: 'female', provider: 'openai' },
    { name: 'onyx', label: 'Onyx (OpenAI, deep)', gender: 'male', provider: 'openai' },
  ],
  'te-IN': [
    { name: 'te-IN-ShrutiNeural', label: 'Shruti (Azure, native Telugu)', gender: 'female', provider: 'azure' },
    { name: 'te-IN-MohanNeural', label: 'Mohan (Azure)', gender: 'male', provider: 'azure' },
    { name: 'anushka', label: 'Anushka (Sarvam bulbul)', gender: 'female', provider: 'sarvam' },
  ],
  'hi-IN': [
    { name: 'hi-IN-SwaraNeural', label: 'Swara (Azure)', gender: 'female', provider: 'azure' },
    { name: 'hi-IN-MadhurNeural', label: 'Madhur (Azure)', gender: 'male', provider: 'azure' },
    { name: 'anushka', label: 'Anushka (Sarvam)', gender: 'female', provider: 'sarvam' },
  ],
  'ta-IN': [{ name: 'ta-IN-PallaviNeural', label: 'Pallavi (Azure)', gender: 'female', provider: 'azure' }],
  'kn-IN': [{ name: 'kn-IN-SapnaNeural', label: 'Sapna (Azure)', gender: 'female', provider: 'azure' }],
  'ml-IN': [{ name: 'ml-IN-SobhanaNeural', label: 'Sobhana (Azure)', gender: 'female', provider: 'azure' }],
  'mr-IN': [{ name: 'mr-IN-AarohiNeural', label: 'Aarohi (Azure)', gender: 'female', provider: 'azure' }],
  'bn-IN': [{ name: 'bn-IN-TanishaaNeural', label: 'Tanishaa (Azure)', gender: 'female', provider: 'azure' }],
  'gu-IN': [{ name: 'gu-IN-DhwaniNeural', label: 'Dhwani (Azure)', gender: 'female', provider: 'azure' }],
  'pa-IN': [{ name: 'pa-IN-Vaani', label: 'Vaani (Azure)', gender: 'female', provider: 'azure' }],
};

export function WebCallSetupModal({ open, onClose, agentId, onStarted }: Props) {
  const [primaryLanguage, setPrimaryLanguage] = useState<string>('en-IN');
  const [autoDetect, setAutoDetect] = useState<boolean>(false);
  const [mixedAllowed, setMixedAllowed] = useState<boolean>(false);
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [voiceName, setVoiceName] = useState<string>('en-IN-NeerjaNeural');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [tone, setTone] = useState<string>('natural');
  const [recording, setRecording] = useState<boolean>(true);
  const [transcript, setTranscript] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voices = useMemo(() => {
    const bucket = VOICE_CATALOG[primaryLanguage] || VOICE_CATALOG['en-IN'];
    return gender === 'male' ? bucket.filter((v) => v.gender === 'male') : bucket.filter((v) => v.gender === 'female');
  }, [primaryLanguage, gender]);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.name === voiceName) || voices[0] || null,
    [voices, voiceName]
  );

  // Keep voice in sync when language/gender changes
  const effectiveVoiceName = selectedVoice?.name || '';
  if (voiceName !== effectiveVoiceName && voices.length > 0) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    setTimeout(() => setVoiceName(voices[0].name), 0);
  }

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: WebCallStartRequest = {
        agent_id: agentId,
        primary_language: primaryLanguage,
        auto_detect_language: autoDetect,
        mixed_language_allowed: mixedAllowed,
        voice_provider: selectedVoice?.provider,
        voice_name: voiceName,
        voice_gender: gender,
        voice_speed: voiceSpeed,
        voice_tone: tone,
        recording_enabled: recording,
        transcript_enabled: transcript,
      };
      const session = await webCallApi.start(payload);
      onStarted(session.id, payload);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to start call');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Start a Web Call" size="lg">
      <div className="space-y-5">
        {/* Language */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
            <Globe className="h-4 w-4 text-indigo-500" />
            Language
          </div>
          <select
            value={primaryLanguage}
            onChange={(e) => setPrimaryLanguage(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={autoDetect} onChange={(e) => setAutoDetect(e.target.checked)} className="rounded border-gray-300" />
              Auto-detect language
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={mixedAllowed} onChange={(e) => setMixedAllowed(e.target.checked)} className="rounded border-gray-300" />
              Allow mixed language
            </label>
          </div>
        </div>

        {/* Voice */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
            <Volume2 className="h-4 w-4 text-indigo-500" />
            Voice
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as 'female' | 'male')}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
            <select
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Speed: {voiceSpeed.toFixed(2)}x</label>
              <input
                type="range"
                min="0.75" max="1.5" step="0.05"
                value={voiceSpeed}
                onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="natural">Natural</option>
              <option value="warm">Warm</option>
              <option value="professional">Professional</option>
              <option value="energetic">Energetic</option>
            </select>
          </div>
        </div>

        {/* Recording + Transcript */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
            <Mic className="h-4 w-4 text-indigo-500" />
            Recording
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} className="rounded border-gray-300" />
              Record this call
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={transcript} onChange={(e) => setTranscript(e.target.checked)} className="rounded border-gray-300" />
              Save transcript
            </label>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            <Save className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button onClick={handleStart} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
            {busy ? 'Starting...' : 'Start Web Call'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
