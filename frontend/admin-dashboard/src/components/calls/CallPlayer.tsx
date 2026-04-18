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
    // In a real app, this would control an audio element
  };

  if (!recordingUrl) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-gray-400 bg-gray-50 rounded-lg border border-gray-200">
        No recording available
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button className="p-1 text-gray-400 hover:text-gray-600">
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={togglePlay}
            className="p-2.5 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>
          <button className="p-1 text-gray-400 hover:text-gray-600">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1">
          <div className="relative h-1.5 bg-gray-200 rounded-full cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              setCurrentTime(Math.floor(pct * duration));
            }}
          >
            <div
              className="absolute h-full bg-primary-600 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">{formatDuration(currentTime)}</span>
            <span className="text-xs text-gray-400">{formatDuration(duration)}</span>
          </div>
        </div>

        <Volume2 className="h-4 w-4 text-gray-400" />
      </div>
    </div>
  );
}
