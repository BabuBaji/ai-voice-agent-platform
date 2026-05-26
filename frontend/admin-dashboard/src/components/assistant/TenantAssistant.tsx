import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles, Loader2, MessageCircle, HelpCircle, Minimize2 } from 'lucide-react';
import { assistantApi, type AssistantMessage } from '@/services/assistant.api';

const STORAGE_KEY = 'tenant-assistant-history';
const MAX_HISTORY = 30;

const SUGGESTED = [
  'How do I create my first agent?',
  'What can I do on this platform?',
  'How do inbound calls work?',
  'How do I run a bulk campaign?',
  "What's my wallet balance?",
  'How do I clone my voice?',
];

export function TenantAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
    const handler = () => setOpen(true);
    window.addEventListener('open-tenant-assistant', handler);
    return () => window.removeEventListener('open-tenant-assistant', handler);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY))); } catch { /* ignore */ }
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const next = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await assistantApi.chat(next.slice(-MAX_HISTORY));
      setMessages([...next, { role: 'assistant' as const, content: r.reply || '(no reply)' }]);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Assistant failed to respond');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMessages([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  return (
    <>
      {/* Launcher is rendered inside <Header /> — see openTenantAssistant() */}

      {/* Right-side slide panel */}
      {open && (
        <div className="fixed top-0 right-0 z-50 h-full w-[min(400px,100vw)] bg-white border-l border-gray-200 shadow-2xl flex flex-col animate-slide-in-right">
          {/* Header */}
          <div className="relative bg-gradient-to-r from-primary-600 to-accent-600 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_60%)]" />
            <div className="relative flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-display font-bold">AI Assistant</p>
                <p className="text-[10px] text-white/70">Ask anything about the platform</p>
              </div>
            </div>
            <div className="relative flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={reset} className="text-[10px] px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 transition font-medium" title="Clear chat">Clear</button>
              )}
              <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg hover:bg-white/15 flex items-center justify-center transition" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
            {messages.length === 0 && (
              <div className="text-center pt-4">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg mb-3">
                  <MessageCircle className="h-6 w-6 text-white" />
                </div>
                <p className="text-sm font-display font-bold text-gray-900">How can I help?</p>
                <p className="text-[11px] text-gray-500 mt-1 mb-4">I know everything about this platform</p>
                <div className="grid grid-cols-2 gap-1.5 max-w-[340px] mx-auto">
                  {SUGGESTED.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-left px-2.5 py-2 rounded-xl bg-white border border-gray-200 hover:border-primary-300 hover:bg-primary-50/50 text-[11px] text-gray-700 transition leading-snug"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} />
            ))}

            {busy && (
              <div className="flex items-end gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow flex-shrink-0">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</div>
            )}
          </div>

          {/* Composer */}
          <div className="p-3 border-t border-gray-200 bg-white flex-shrink-0">
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="flex items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask anything…"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 max-h-28"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white flex items-center justify-center shadow disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg transition"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Message({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-gradient-to-br from-primary-600 to-accent-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm shadow-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow flex-shrink-0">
        <Bot className="h-3 w-3" />
      </div>
      <div className="max-w-[85%] bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm shadow-sm whitespace-pre-wrap break-words leading-relaxed">
        <RenderMarkdownLite text={content} />
      </div>
    </div>
  );
}

function RenderMarkdownLite({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(<span key={key++}>{text.slice(lastIdx, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-gray-100 text-gray-800 text-[12px] font-mono">{tok.slice(1, -1)}</code>);
    } else {
      const linkM = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkM) {
        const [, label, href] = linkM;
        parts.push(<a key={key++} href={href} className="text-primary-700 underline hover:text-primary-800">{label}</a>);
      }
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) parts.push(<span key={key++}>{text.slice(lastIdx)}</span>);
  return <>{parts}</>;
}
