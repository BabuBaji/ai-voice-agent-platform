import { useState } from 'react';
import { Lightbulb } from 'lucide-react';

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const promptTips = [
  'Start with a clear role definition: "You are a..."',
  'Define the tone: professional, friendly, empathetic',
  'List specific tasks the agent should handle',
  'Include fallback behavior for unknown topics',
  'Specify when to transfer to a human agent',
  'Add knowledge about your products/services',
];

export function PromptEditor({ value, onChange }: PromptEditorProps) {
  const [showTips, setShowTips] = useState(false);
  const charCount = value.length;
  const maxChars = 10000;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">System Prompt</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowTips(!showTips)}
            className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {showTips ? 'Hide Tips' : 'Show Tips'}
          </button>
          <span className={`text-xs ${charCount > maxChars ? 'text-danger-600' : 'text-gray-400'}`}>
            {charCount.toLocaleString()} / {maxChars.toLocaleString()}
          </span>
        </div>
      </div>

      {showTips && (
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-4">
          <h4 className="text-sm font-medium text-primary-800 mb-2">Prompt Writing Tips</h4>
          <ul className="space-y-1">
            {promptTips.map((tip, i) => (
              <li key={i} className="text-xs text-primary-700 flex items-start gap-2">
                <span className="text-primary-400 mt-0.5">--</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={16}
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-mono leading-relaxed focus:border-primary-500 focus:ring-2 focus:ring-primary-200 focus:outline-none resize-y"
        placeholder="You are a helpful AI voice assistant for [Company Name]. Your role is to..."
      />
    </div>
  );
}
