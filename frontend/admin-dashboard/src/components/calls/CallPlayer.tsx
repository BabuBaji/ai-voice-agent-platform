import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { formatDuration } from '@/utils/formatters';

interface CallPlayerProps {
  recordingUrl?: string | null;
  duration: number;
}

export function CallPlayer({ recordingUrl, duration }: CallPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(duration);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(Math.floor(el.currentTime));
    const onDur = () => {
      if (!isNaN(el.duration) && isFinite(el.duration) && el.duration > 0) {
        setActualDuration(Math.floor(el.duration));
      }
    };
    const onEnd = () => setIsPlaying(false);
    const onErr = () => setError('Could not load recording');
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onDur);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onDur);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
    };
  }, [recordingUrl]);

  const progress = actualDuration > 0 ? (currentTime / actualDuration) * 100 : 0;

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      try {
        await el.play();
        setIsPlaying(true);
      } catch (e) {
        setError('Could not play recording');
      }
    }
  };

  const seekBy = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(actualDuration, el.currentTime + delta));
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    el.currentTime = Math.max(0, Math.min(actualDuration, pct * actualDuration));
    setCurrentTime(Math.floor(el.currentTime));
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
      <audio ref={audioRef} src={recordingUrl} preload="metadata" />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => seekBy(-10)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors"
            title="Back 10s"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={togglePlay}
            className="p-3 bg-gradient-to-br from-primary-600 to-accent-600 text-white rounded-full hover:shadow-lg shadow-primary-600/20 transition-all"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>
          <button
            onClick={() => seekBy(10)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors"
            title="Forward 10s"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1">
          <div
            className="relative h-2 bg-gray-200 rounded-full cursor-pointer overflow-hidden"
            onClick={seekTo}
          >
            <div
              className="absolute h-full bg-gradient-to-br from-primary-600 to-accent-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-gray-400 font-mono">{formatDuration(currentTime)}</span>
            <span className="text-xs text-gray-400 font-mono">{formatDuration(actualDuration)}</span>
          </div>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>

        <Volume2 className="h-4 w-4 text-gray-400" />
      </div>
    </div>
  );
}
