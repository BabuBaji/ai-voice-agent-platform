import { Volume2 } from 'lucide-react';
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
  provider,
  voiceId,
  speed,
  language,
  onProviderChange,
  onVoiceChange,
  onSpeedChange,
  onLanguageChange,
}: VoiceSelectorProps) {
  const voices = VOICES[provider] || [];

  return (
    <div className="space-y-6">
      <Select
        label="Voice Provider"
        value={provider}
        onChange={(e) => onProviderChange(e.target.value)}
        options={VOICE_PROVIDERS}
      />

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Voice</label>
        <div className="flex items-center gap-3">
          <select
            value={voiceId}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
          >
            <option value="">Select a voice</option>
            {voices.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm">
            <Volume2 className="h-4 w-4" />
            Preview
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Speed: {speed.toFixed(1)}x
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
          <span>0.5x</span>
          <span>1.0x</span>
          <span>1.5x</span>
          <span>2.0x</span>
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
