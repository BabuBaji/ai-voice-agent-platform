import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Plus, Loader2, MessageSquare, Code2, Trash2, X } from 'lucide-react';
import { agentApi } from '@/services/agent.api';
import type { Agent } from '@/types';
import { CHATBOT_TEMPLATES, type ChatbotCategoryKey } from './templates';

// A "chatbot" is just an agent flagged with metadata.chatbot=true. We
// reuse the existing agents table — no separate schema. The list page
// filters agents by that flag and surfaces chatbot-specific actions.

function isChatbot(a: Agent): boolean {
  return Boolean((a as any).metadata?.chatbot);
}

export function ChatbotsListPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingKey, setCreatingKey] = useState<ChatbotCategoryKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await agentApi.list();
      setAgents(list);
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const chatbots = useMemo(() => (agents || []).filter(isChatbot), [agents]);

  const createFromTemplate = async (key: ChatbotCategoryKey) => {
    const tpl = CHATBOT_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    setCreatingKey(key);
    setError(null);
    try {
      const businessName = 'Your business';
      const created = await agentApi.create({
        name: `${tpl.label} Chatbot`,
        description: tpl.description,
        system_prompt: tpl.prompt.replace(/\{\{business_name\}\}/g, businessName),
        greeting_message: tpl.welcome.replace(/\{\{business_name\}\}/g, businessName),
        llm_provider: 'google',
        llm_model: 'gemini-2.5-flash',
        temperature: 0.5,
        direction: 'INBOUND',
        status: 'DRAFT',
        metadata: {
          chatbot: true,
          chatbot_config: {
            category: tpl.key,
            business_name: businessName,
            tone: tpl.tone,
            lead_fields: tpl.leadFields,
            theme: { color: tpl.accent, position: 'right' },
            languages: ['en'],
          },
        },
      } as any);
      setPickerOpen(false);
      navigate(`/chatbots/${created.id}`);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to create chatbot');
    } finally {
      setCreatingKey(null);
    }
  };

  const remove = async (a: Agent) => {
    if (!confirm(`Delete chatbot "${a.name}"? This cannot be undone.`)) return;
    try {
      await agentApi.delete(a.id);
      reload();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Delete failed');
    }
  };

  if (loading && !agents) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-amber-500" /> Chatbots
          </h1>
          <p className="text-sm text-slate-500 mt-1">Build text chatbots for your website, capture leads, answer FAQs, book appointments.</p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow hover:shadow-md hover:-translate-y-0.5 transition"
        >
          <Plus className="h-4 w-4" /> New chatbot
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">{error}</div>}

      {chatbots.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto shadow-md">
            <Bot className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-base font-semibold text-slate-900 mt-4">Build your first chatbot</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Pick a category below — we'll pre-fill the prompt and lead fields. You can always tweak it after.
          </p>
          <button
            onClick={() => setPickerOpen(true)}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow"
          >
            <Plus className="h-4 w-4" /> Start with a template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {chatbots.map((a) => {
            const cfg = ((a as any).metadata?.chatbot_config || {});
            const tpl = CHATBOT_TEMPLATES.find((t) => t.key === cfg.category) || CHATBOT_TEMPLATES[CHATBOT_TEMPLATES.length - 1];
            return (
              <Link
                key={a.id}
                to={`/chatbots/${a.id}`}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-sm" style={{ background: `${tpl.accent}1a`, color: tpl.accent }}>
                      <span>{tpl.emoji}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-amber-700 truncate">{a.name}</p>
                      <p className="text-[11px] text-slate-500">{tpl.label}</p>
                    </div>
                  </div>
                  {(() => {
                    const s = String(a.status || '').toUpperCase();
                    const live = s === 'PUBLISHED' || s === 'ACTIVE';
                    return (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {s || 'DRAFT'}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-slate-500 mt-3 line-clamp-2">{a.description || tpl.description}</p>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                  <span className="font-mono">{a.id.slice(0, 8)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Code2 className="h-3 w-3" /> embed ready
                  </span>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(a); }}
                    className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Choose a category</h2>
                <p className="text-xs text-slate-500 mt-0.5">We'll pre-fill the prompt, welcome message, and lead-capture fields.</p>
              </div>
              <button onClick={() => setPickerOpen(false)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {CHATBOT_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => createFromTemplate(t.key)}
                  disabled={!!creatingKey}
                  className="text-left p-4 rounded-xl border border-slate-200 hover:border-amber-400 hover:shadow-md hover:-translate-y-0.5 transition bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: `${t.accent}1a` }}>
                      <span>{t.emoji}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{t.label}</p>
                    {creatingKey === t.key && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 ml-auto" />}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{t.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
