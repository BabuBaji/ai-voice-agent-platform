import { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { formatDuration } from '@/utils/formatters';

interface CallPlayerProps {
  recordingUrl?: string;
  duration: number;
}

export function CallPlayer({ recordingUrl, duration }: CallPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  if (!recordingUrl) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-400 bg-gray-50 rounded-xl border border-gray-200">
        No recording available
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-gray-50 to-gray-100/50 rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors">
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={togglePlay}
            className="p-3 bg-gradient-brand text-white rounded-full hover:shadow-glow transition-all"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>
          <button className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1">
          <div className="relative h-2 bg-gray-200 rounded-full cursor-pointer overflow-hidden"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              setCurrentTime(Math.floor(pct * duration));
            }}>
            <div className="absolute h-full bg-gradient-brand rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-gray-400 font-mono">{formatDuration(currentTime)}</span>
            <span className="text-xs text-gray-400 font-mono">{formatDuration(duration)}</span>
          </div>
        </div>

        <Volume2 className="h-4 w-4 text-gray-400" />
      </div>
    </div>
  );
}
