import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Save, Loader2, Bot, MessageSquare, Code2, Send, Copy, Check,
  Sparkles, Rocket, Trash2,
} from 'lucide-react';
import { agentApi } from '@/services/agent.api';
import type { Agent } from '@/types';
import { CHATBOT_TEMPLATES, type ChatbotCategoryKey, getTemplate } from './templates';

interface ChatbotConfig {
  category: ChatbotCategoryKey;
  business_name: string;
  tone: string;
  lead_fields: string[];
  theme: { color: string; position: 'left' | 'right' };
  languages: string[];
}

const DEFAULT_CFG: ChatbotConfig = {
  category: 'custom',
  business_name: 'Your business',
  tone: 'helpful, neutral',
  lead_fields: ['name', 'email'],
  theme: { color: '#f59e0b', position: 'right' },
  languages: ['en'],
};

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' },
  { value: 'te', label: 'Telugu' },  { value: 'ta', label: 'Tamil' },
  { value: 'kn', label: 'Kannada' }, { value: 'ml', label: 'Malayalam' },
  { value: 'mr', label: 'Marathi' }, { value: 'bn', label: 'Bengali' },
];

export function ChatbotBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Editable fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [welcome, setWelcome] = useState('');
  const [llmProvider, setLlmProvider] = useState('google');
  const [llmModel, setLlmModel] = useState('gemini-2.5-flash');
  const [cfg, setCfg] = useState<ChatbotConfig>(DEFAULT_CFG);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    agentApi.get(id).then((a) => {
      const x = a as any;
      setAgent(a);
      setName(a.name || '');
      setDescription(a.description || '');
      setSystemPrompt(x.system_prompt || a.systemPrompt || '');
      setWelcome(x.greeting_message || x.greeting || '');
      setLlmProvider(x.llm_provider || 'google');
      setLlmModel(x.llm_model || 'gemini-2.5-flash');
      const merged = { ...DEFAULT_CFG, ...(x.metadata?.chatbot_config || {}) };
      setCfg(merged);
    }).catch((e) => {
      setError(e?.response?.data?.error || e?.message || 'Failed to load chatbot');
    }).finally(() => setLoading(false));
  }, [id]);

  const tpl = useMemo(() => getTemplate(cfg.category), [cfg.category]);

  const setCfgField = <K extends keyof ChatbotConfig>(k: K, v: ChatbotConfig[K]) =>
    setCfg((prev) => ({ ...prev, [k]: v }));

  const setTheme = (patch: Partial<ChatbotConfig['theme']>) =>
    setCfg((prev) => ({ ...prev, theme: { ...prev.theme, ...patch } }));

  const applyTemplate = (key: ChatbotCategoryKey) => {
    const t = getTemplate(key);
    setSystemPrompt(t.prompt.replace(/\{\{business_name\}\}/g, cfg.business_name || 'Your business'));
    setWelcome(t.welcome.replace(/\{\{business_name\}\}/g, cfg.business_name || 'Your business'));
    setCfg((prev) => ({
      ...prev,
      category: key,
      tone: t.tone,
      lead_fields: t.leadFields,
      theme: { ...prev.theme, color: t.accent },
    }));
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      await agentApi.update(id, {
        name,
        description,
        system_prompt: systemPrompt,
        greeting_message: welcome,
        llm_provider: llmProvider,
        llm_model: llmModel,
        metadata: {
          ...((agent as any)?.metadata || {}),
          chatbot: true,
          chatbot_config: cfg,
        },
      } as any);
      setSavedAt(new Date());
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!id) return;
    setPublishing(true);
    setError(null);
    try {
      await save();
      const updated = await agentApi.publish(id);
      setAgent(updated);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const remove = async () => {
    if (!id || !agent) return;
    if (!confirm(`Delete chatbot "${agent.name}"? This cannot be undone.`)) return;
    try {
      await agentApi.delete(id);
      navigate('/chatbots');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Delete failed');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  if (!agent) return <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error || 'Chatbot not found'}</div>;

  const statusStr = String(agent.status || '').toUpperCase();
  const isPublished = statusStr === 'PUBLISHED' || statusStr === 'ACTIVE';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link to="/chatbots" className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-3 w-3" /> All chatbots
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{tpl.emoji}</span>
            <h1 className="text-2xl font-bold text-slate-900">{name || 'Untitled chatbot'}</h1>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              {agent.status || 'DRAFT'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-[11px] text-slate-500 mr-1">saved {savedAt.toLocaleTimeString()}</span>}
          <button onClick={remove} className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 text-slate-600 text-xs inline-flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
          <button onClick={publish} disabled={publishing || saving} className="px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 hover:shadow-md transition">
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {isPublished ? 'Re-publish' : 'Publish'}
          </button>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* LEFT — form (8 cols) */}
        <div className="xl:col-span-8 space-y-5">
          {/* Identity */}
          <Section icon={<Sparkles className="h-4 w-4 text-amber-500" />} title="Identity">
            <Field label="Chatbot name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Acme Lead Bot" />
            </Field>
            <Field label="Business name">
              <input value={cfg.business_name} onChange={(e) => setCfgField('business_name', e.target.value)} className={inputCls} placeholder="Acme Inc." />
            </Field>
            <Field label="Description (optional)">
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="One line about what this chatbot does" />
            </Field>
            <Field label="Category">
              <div className="grid grid-cols-3 gap-1.5">
                {CHATBOT_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => applyTemplate(t.key)}
                    className={`text-left px-2.5 py-2 rounded-lg border text-[11px] transition ${cfg.category === t.key ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <span className="mr-1.5">{t.emoji}</span>
                    <span className="font-medium text-slate-700">{t.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">Switching category overwrites the prompt + welcome message.</p>
            </Field>
          </Section>

          {/* Brain */}
          <Section icon={<Bot className="h-4 w-4 text-violet-500" />} title="Brain (system prompt)">
            <Field label="Welcome message">
              <input value={welcome} onChange={(e) => setWelcome(e.target.value)} className={inputCls} placeholder="Hi! How can I help?" />
            </Field>
            <Field label="System prompt">
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={9} className={inputCls + ' font-mono text-[12px] leading-relaxed'} placeholder="You are a helpful assistant…" />
              <p className="text-[10px] text-slate-400 mt-1">{systemPrompt.length} chars · use {'{{business_name}}'} or just type values directly.</p>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="LLM provider">
                <select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)} className={inputCls}>
                  <option value="google">Google · Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic · Claude</option>
                </select>
              </Field>
              <Field label="Model">
                <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className={inputCls} placeholder="gemini-2.5-flash" />
              </Field>
            </div>
          </Section>

          {/* Lead capture */}
          <Section icon={<MessageSquare className="h-4 w-4 text-emerald-500" />} title="Lead capture">
            <p className="text-xs text-slate-500 mb-2">Fields the chatbot tries to collect during the conversation. Edit as comma-separated values.</p>
            <input
              value={cfg.lead_fields.join(', ')}
              onChange={(e) => setCfgField('lead_fields', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              className={inputCls}
              placeholder="name, email, phone, interest"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {cfg.lead_fields.map((f) => (
                <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{f}</span>
              ))}
            </div>
          </Section>

          {/* Languages */}
          <Section icon={<Sparkles className="h-4 w-4 text-sky-500" />} title="Languages">
            <p className="text-xs text-slate-500 mb-2">Select all languages this chatbot should understand and reply in.</p>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map((l) => {
                const on = cfg.languages.includes(l.value);
                return (
                  <button
                    key={l.value}
                    onClick={() => {
                      const next = on ? cfg.languages.filter((x) => x !== l.value) : [...cfg.languages, l.value];
                      setCfgField('languages', next.length ? next : ['en']);
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${on ? 'bg-sky-500 border-sky-500 text-white' : 'border-slate-200 hover:border-sky-300 text-slate-700'}`}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Appearance */}
          <Section icon={<Sparkles className="h-4 w-4 text-rose-500" />} title="Widget appearance">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary color">
                <div className="flex items-center gap-2">
                  <input type="color" value={cfg.theme.color} onChange={(e) => setTheme({ color: e.target.value })} className="h-9 w-12 rounded border border-slate-200 cursor-pointer" />
                  <input value={cfg.theme.color} onChange={(e) => setTheme({ color: e.target.value })} className={inputCls + ' font-mono'} />
                </div>
              </Field>
              <Field label="Position">
                <select value={cfg.theme.position} onChange={(e) => setTheme({ position: e.target.value as 'left' | 'right' })} className={inputCls}>
                  <option value="right">Bottom right</option>
                  <option value="left">Bottom left</option>
                </select>
              </Field>
            </div>
          </Section>

          {/* Embed code */}
          <Section icon={<Code2 className="h-4 w-4 text-slate-500" />} title="Embed on your website">
            <EmbedSnippet chatbotId={id!} color={cfg.theme.color} position={cfg.theme.position} published={isPublished} />
          </Section>
        </div>

        {/* RIGHT — live preview / playground (4 cols) */}
        <div className="xl:col-span-4">
          <div className="sticky top-4">
            <PreviewWidget agentId={id!} name={name} welcome={welcome} color={cfg.theme.color} />
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400';

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 mb-3.5">{icon}{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function EmbedSnippet({ chatbotId, color, position, published }: { chatbotId: string; color: string; position: string; published: boolean }) {
  const [copied, setCopied] = useState(false);
  const origin = (typeof window !== 'undefined' ? window.location.origin : '');
  const snippet = `<script src="${origin}/widget.js"\n  data-chatbot-id="${chatbotId}"\n  data-color="${color}"\n  data-position="${position}"></script>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div>
      {!published && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          ⚠️ This chatbot is in DRAFT — publish it before pasting the snippet on your site.
        </div>
      )}
      <p className="text-xs text-slate-500 mb-2">Paste this once into your site's HTML, just before <code className="px-1 py-0.5 rounded bg-slate-100 text-[11px]">{'</body>'}</code>.</p>
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed">{snippet}</pre>
      <button onClick={copy} className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 transition">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy snippet'}
      </button>
    </div>
  );
}

// Live test playground — talks to the same /widget/chat the embedded JS uses,
// so what you see here is exactly what visitors get.
function PreviewWidget({ agentId, name, welcome, color }: { agentId: string; name: string; welcome: string; color: string }) {
  type Msg = { role: 'user' | 'assistant'; content: string };
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (welcome) setMessages([{ role: 'assistant', content: welcome }]);
  }, [welcome]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    try {
      const r = await fetch(`${window.location.origin}/widget/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          message: text,
          conversation_id: conversationId,
          channel: 'chat',
        }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (data.conversation_id) setConversationId(data.conversation_id);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '(no reply)' }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Error reaching the assistant. Make sure the chatbot is published.' }]);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMessages(welcome ? [{ role: 'assistant', content: welcome }] : []);
    setConversationId(null);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[640px]">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between" style={{ background: `linear-gradient(135deg, ${color}, ${shade(color, -15)})` }}>
        <div className="flex items-center gap-2 text-white">
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{name || 'Chatbot'}</p>
            <p className="text-[10px] opacity-80">Test playground · live</p>
          </div>
        </div>
        <button onClick={reset} className="text-[10px] px-2 py-0.5 rounded-md bg-white/20 hover:bg-white/30 text-white">Reset</button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/40">
        {messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center mt-8">Type a message below to test your chatbot.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${m.role === 'user' ? 'text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}
              style={m.role === 'user' ? { background: color } : {}}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-white border border-slate-200">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '240ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>
      <form
        className="p-2.5 border-t border-slate-200 bg-white flex gap-2 items-end"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Type a test message…"
          className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 max-h-24"
        />
        <button type="submit" disabled={busy || !input.trim()} className="w-9 h-9 rounded-xl text-white flex items-center justify-center disabled:opacity-40 hover:shadow transition" style={{ background: color }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </form>
    </div>
  );
}

function shade(hex: string, percent: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + percent));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + percent));
  const b = Math.max(0, Math.min(255, (num & 255) + percent));
  return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
