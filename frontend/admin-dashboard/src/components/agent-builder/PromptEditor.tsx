import { useState } from 'react';
import { Lightbulb, Copy, Check } from 'lucide-react';

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
  'Set boundaries on what topics to avoid',
  'Include example phrases for key scenarios',
];

export function PromptEditor({ value, onChange }: PromptEditorProps) {
  const [showTips, setShowTips] = useState(false);
  const [copied, setCopied] = useState(false);
  const charCount = value.length;
  const maxChars = 10000;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">System Prompt</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setShowTips(!showTips)}
            className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {showTips ? 'Hide Tips' : 'Show Tips'}
          </button>
          <span className={`text-xs font-mono ${charCount > maxChars ? 'text-danger-600' : 'text-gray-400'}`}>
            {charCount.toLocaleString()} / {maxChars.toLocaleString()}
          </span>
        </div>
      </div>

      {showTips && (
        <div className="bg-gradient-to-br from-primary-50 to-accent-50 border border-primary-100 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-primary-800 mb-3">Prompt Writing Tips</h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {promptTips.map((tip, i) => (
              <li key={i} className="text-xs text-primary-700 flex items-start gap-2">
                <span className="text-primary-400 mt-0.5 flex-shrink-0">--</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="relative rounded-xl overflow-hidden border border-gray-200 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
        <div className="bg-gray-900 px-4 py-2 flex items-center justify-between border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">system_prompt.txt</span>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-danger-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-warning-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-success-400/60" />
          </div>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={18}
          className="w-full bg-gray-950 text-gray-100 px-4 py-4 text-sm font-mono leading-relaxed focus:outline-none resize-y placeholder:text-gray-600 scrollbar-thin scrollbar-dark"
          placeholder="You are a helpful AI voice assistant for [Company Name]. Your role is to..."
        />
      </div>
    </div>
  );
}
