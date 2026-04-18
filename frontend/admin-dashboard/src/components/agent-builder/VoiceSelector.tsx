import { Volume2, Play } from 'lucide-react';
import { Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { VOICE_PROVIDERS, VOICES, LANGUAGES } from '@/utils/constants';

interface VoiceSelectorProps {
  provider: string;
  voiceId: string;
  speed: number;
  language: string;
  onProviderChange: (v: string) => void;
  onVoiceChange: (v: string) => void;
  onSpeedChange: (v: number) => void;
  onLanguageChange: (v: string) => void;
}

export function VoiceSelector({
  provider, voiceId, speed, language,
  onProviderChange, onVoiceChange, onSpeedChange, onLanguageChange,
}: VoiceSelectorProps) {
  const voices = VOICES[provider] || [];

  return (
    <div className="space-y-6">
      <Select
        label="TTS Provider"
        value={provider}
        onChange={(e) => onProviderChange(e.target.value)}
        options={VOICE_PROVIDERS}
      />

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">Voice</label>
        <div className="flex items-center gap-3">
          <select
            value={voiceId}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="flex-1 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-all"
          >
            <option value="">Select a voice</option>
            {voices.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" className="rounded-xl gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Preview
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          Speed: <span className="text-primary-600 font-semibold">{speed.toFixed(1)}x</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>0.5x Slow</span>
          <span>1.0x Normal</span>
          <span>1.5x</span>
          <span>2.0x Fast</span>
        </div>
      </div>

      <Select
        label="Language"
        value={language}
        onChange={(e) => onLanguageChange(e.target.value)}
        options={LANGUAGES}
      />
    </div>
  );
}
