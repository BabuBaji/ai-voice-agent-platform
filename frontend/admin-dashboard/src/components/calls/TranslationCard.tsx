import { useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, User, Bot, Languages } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { conversationApi, type TranslatedTranscript } from '@/services/conversation.api';

const LANGUAGES: { code: string; name: string; native?: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
];

interface Props {
  conversationId: string;
  hasTranscript: boolean;
}

export function TranslationCard({ conversationId, hasTranscript }: Props) {
  const [target, setTarget] = useState<string>('en');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslatedTranscript | null>(null);

  const run = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const t = await conversationApi.translate(conversationId, target, force);
      setResult(t);
    } catch (e: any) {
      setError(
        e?.response?.data?.detail ||
          e?.response?.data?.message ||
          e?.response?.data?.error ||
          e?.message ||
          'Translation failed',
      );
    } finally {
      setLoading(false);
    }
  };

  const subtitle = result
    ? `${result.target_name} · ${result.messages.length} messages · ${result.provider}${result.cached ? ' (cached)' : ''}`
    : 'Auto-correct + translate the live transcript into the language you choose';

  return (
    <Card>
      <CardHeader title="Translate transcript" subtitle={subtitle} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Target language</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 transition-colors bg-white"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
                {l.native ? ` — ${l.native}` : ''}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => run(false)}
          disabled={loading || !hasTranscript}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Translating…
            </>
          ) : (
            <>
              <Languages className="h-4 w-4" /> Translate
            </>
          )}
        </Button>
        {result && (
          <Button size="sm" variant="outline" onClick={() => run(true)} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Re-translate
          </Button>
        )}
      </div>

      {!hasTranscript && (
        <p className="text-sm text-gray-400 mt-4">
          No transcript on this call yet — nothing to translate.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-sm text-danger-700 mt-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Translation failed</p>
            <p className="text-xs mt-0.5 break-words">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 max-h-[460px] overflow-y-auto scrollbar-thin space-y-2 bg-gray-50 rounded-lg p-3">
          {result.messages.map((m, i) => (
            <div key={i} className="flex gap-2.5 text-sm">
              <div className="flex-shrink-0 mt-0.5">
                {m.role === 'user' ? (
                  <User className="h-4 w-4 text-primary-500" />
                ) : (
                  <Bot className="h-4 w-4 text-accent-500" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">
                  {m.role === 'user' ? 'Caller' : 'Agent'}
                </p>
                <p className="text-gray-800 leading-relaxed">{m.content}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-400 pt-2">
            Translated {new Date(result.translated_at).toLocaleString()}
          </p>
        </div>
      )}
    </Card>
  );
}
