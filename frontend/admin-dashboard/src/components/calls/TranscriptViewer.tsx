import { Bot, User } from 'lucide-react';
import { formatDuration } from '@/utils/formatters';
import type { TranscriptMessage } from '@/types';

interface TranscriptViewerProps {
  messages: TranscriptMessage[];
}

export function TranscriptViewer({ messages }: TranscriptViewerProps) {
  return (
    <div className="space-y-4">
      {messages.map((msg, idx) => {
        const isAssistant = msg.role === 'assistant';
        return (
          <div key={idx} className={`flex gap-3 ${isAssistant ? '' : 'flex-row-reverse'}`}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                isAssistant
                  ? 'bg-gradient-to-br from-primary-100 to-accent-100 text-primary-600'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
            </div>
            <div className={`max-w-[75%] ${isAssistant ? '' : 'text-right'}`}>
              <div
                className={`inline-block px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  isAssistant
                    ? 'bg-white border border-gray-100 text-gray-800 rounded-tl-none shadow-card'
                    : 'bg-gradient-brand text-white rounded-tr-none shadow-sm'
                }`}
              >
                {msg.content}
              </div>
              <p className="text-xs text-gray-400 mt-1 px-1 font-mono">{formatDuration(msg.timestamp)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
