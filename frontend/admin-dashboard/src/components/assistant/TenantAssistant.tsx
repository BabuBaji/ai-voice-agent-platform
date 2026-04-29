import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles, Loader2, MessageCircle } from 'lucide-react';
import { assistantApi, type AssistantMessage } from '@/services/assistant.api';

const STORAGE_KEY = 'tenant-assistant-history';
const MAX_HISTORY = 30; // also enforced on the backend (40)

const SUGGESTED = [
  'How do I create my first agent?',
  'Why did my last call fail?',
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

  // Load persisted history once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Persist + auto-scroll on every change
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
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 group"
          aria-label="Open assistant"
        >
          <span className="absolute inset-0 rounded-full bg-amber-400 blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
          <span className="relative flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-2xl hover:shadow-amber-500/30 hover:scale-105 transition-all">
            <span className="relative">
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse" />
              <Bot className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold">Ask AI</span>
          </span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-3rem))] h-[min(640px,calc(100vh-6rem))] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="relative bg-gradient-to-br from-amber-500 to-orange-500 text-white p-4 flex items-center justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
            <div className="relative flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Platform assistant</p>
                <p className="text-[11px] text-white/80">Ask anything about your account · agents · calls · billing</p>
              </div>
            </div>
            <div className="relative flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={reset} className="text-[11px] px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 transition" title="Clear chat">Clear</button>
              )}
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center transition" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-amber-50/40 to-white">
            {messages.length === 0 && (
              <div className="text-center pt-6">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg mb-3">
                  <MessageCircle className="h-7 w-7 text-white" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Hi! How can I help?</p>
                <p className="text-xs text-slate-500 mt-1 mb-4">Try one of these to get started</p>
                <div className="flex flex-col gap-1.5 max-w-[300px] mx-auto">
                  {SUGGESTED.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-left px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-amber-400 hover:bg-amber-50/50 text-xs text-slate-700 transition"
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
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow flex-shrink-0">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</div>
            )}
          </div>

          {/* Composer */}
          <div className="p-3 border-t border-slate-200 bg-white">
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
                className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 max-h-32"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shadow disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg transition"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </form>
            <p className="text-[10px] text-slate-400 mt-1.5 text-center">AI may be inaccurate · double-check important answers</p>
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
        <div className="max-w-[80%] bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm shadow-sm whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow flex-shrink-0">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[85%] bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm shadow-sm whitespace-pre-wrap break-words leading-relaxed">
        <RenderMarkdownLite text={content} />
      </div>
    </div>
  );
}

// Tiny markdown renderer for **bold**, `code`, and [text](path) links —
// keeps the assistant output readable without pulling in a full markdown lib.
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
      parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-slate-100 text-slate-800 text-[12px] font-mono">{tok.slice(1, -1)}</code>);
    } else {
      const linkM = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkM) {
        const [, label, href] = linkM;
        parts.push(<a key={key++} href={href} className="text-amber-700 underline hover:text-amber-800">{label}</a>);
      }
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) parts.push(<span key={key++}>{text.slice(lastIdx)}</span>);
  return <>{parts}</>;
}
