import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Save, ArrowLeft, Sparkles, MessageSquare, Globe, Mic, Brain, Activity,
  Rocket, Search, BookOpen, Plug, CheckCircle2, AlertCircle, PhoneIncoming,
  PhoneOutgoing, PhoneCall, Monitor, Bot, Phone, Clock, Check, Loader2,
  Upload, FileUp, Plus, X,
} from 'lucide-react';
import type { KBDocumentApi } from '@/services/knowledge.api';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { PromptEditor } from '@/components/agent-builder/PromptEditor';
import { ConversationFlowEditor } from '@/components/agent-builder/ConversationFlowEditor';
import { ToolConfigurator } from '@/components/agent-builder/ToolConfigurator';
import { agentApi } from '@/services/agent.api';
import { callApi } from '@/services/call.api';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';
import { knowledgeApi } from '@/services/knowledge.api';
import {
  VOICE_PROVIDERS, VOICES, LANGUAGES,
  STT_PROVIDERS, STT_MODELS, COUNTRY_CODES,
} from '@/utils/constants';

type Msg = { type: 'success' | 'error'; text: string };

const TABS = [
  { id: 'assistant', label: 'Assistant Details', icon: Bot },
  { id: 'call', label: 'Call Configuration', icon: Phone },
  { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'postcall', label: 'Post-Call', icon: Sparkles },
  { id: 'recent', label: 'Recent', icon: Clock },
] as const;

const LLM_PROVIDERS = [
  { value: 'mock', label: 'Demo Mode (No API Key)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
];

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  mock: [{ value: 'mock-v1', label: 'Mock AI (Demo)' }],
  openai: [
    { value: 'gpt-4.1-mini', label: 'Gpt-4.1-Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  google: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  mistral: [{ value: 'mistral-large', label: 'Mistral Large' }],
  groq: [{ value: 'llama-3-70b', label: 'Llama 3 70B' }],
};

function SettingCard({
  icon, title, subtitle, onClick,
}: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-left hover:border-teal-400 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center text-teal-600 group-hover:from-teal-100 group-hover:to-cyan-100 transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</div>
          <div className="text-sm font-medium text-gray-900 mt-0.5 truncate">{subtitle || '—'}</div>
        </div>
      </div>
    </button>
  );
}

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${checked ? 'bg-teal-500' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  );
}

export function AgentBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [activeTab, setActiveTab] = useState<typeof TABS[number]['id']>('assistant');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [message, setMessage] = useState<Msg | null>(null);

  // Modals
  const [showPhoneCallModal, setShowPhoneCallModal] = useState(false);
  const [showLlmModal, setShowLlmModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showSttModal, setShowSttModal] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);

  // Core
  const [name, setName] = useState('Untitled Agent');
  const [description, setDescription] = useState('');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('INBOUND');
  const [status, setStatus] = useState<string>('DRAFT');
  const [costPerMin, setCostPerMin] = useState(0.115);

  // Assistant settings
  const [language, setLanguage] = useState('en-US');
  const [voiceProvider, setVoiceProvider] = useState('elevenlabs');
  const [voiceId, setVoiceId] = useState('rachel');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  // Real-time voice-pipeline provider. Drives the STT/TTS picker in
  // telephony-adapter (services/.../plivoAudioStream.ts).
  //   "deepgram"        → Deepgram everywhere, fastest path (new default)
  //   "sarvam"          → Sarvam everywhere (native Indic voice quality)
  //   "auto"            → Legacy: Indic → Sarvam, else Deepgram
  //   "deepgram_with_fallback" → Deepgram first; auto-switch to Sarvam after
  //                              8s of silent failure
  const [defaultProvider, setDefaultProvider] = useState<'deepgram' | 'sarvam' | 'auto' | 'deepgram_with_sarvam' | 'deepgram_with_whisper'>('deepgram');
  const [sttProvider, setSttProvider] = useState('deepgram');
  const [sttModel, setSttModel] = useState('nova-2');
  const [llmProvider, setLlmProvider] = useState('mock');
  const [llmModel, setLlmModel] = useState('mock-v1');
  const [temperature, setTemperature] = useState(0.7);

  // Welcome
  const [greeting, setGreeting] = useState('Hello, I am your AI assistant. How can I help you today?');
  const [welcomeDynamic, setWelcomeDynamic] = useState(true);
  const [welcomeInterruptible, setWelcomeInterruptible] = useState(false);

  // Prompt & tools & KB
  const [systemPrompt, setSystemPrompt] = useState('');
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [attachedKBs, setAttachedKBs] = useState<string[]>([]);

  // Counter that ingestion cards bump after each upload — DocumentsListCard
  // watches it and refetches. Saves a stale list when a Q&A or PDF lands.
  const [kbDocsRefresh, setKbDocsRefresh] = useState(0);
  const [ensuringKb, setEnsuringKb] = useState(false);

  // Post-call actions (fire when the call ends: webhook/slack/email)
  type PostCallActionDraft = {
    id: string;
    type: 'webhook' | 'slack' | 'email';
    enabled: boolean;
    label: string;
    url?: string;
    method?: 'POST' | 'PUT' | 'PATCH';
    webhook_url?: string;
    message_template?: string;
    to?: string;
    subject_template?: string;
    body_template?: string;
  };
  const [postCallActions, setPostCallActions] = useState<PostCallActionDraft[]>([]);
  const newActionId = () => Math.random().toString(36).slice(2, 10);

  // Call config — voicemail detection / transfer / fillers (persisted in agents.call_config)
  const [vmEnabled, setVmEnabled] = useState(false);
  const [vmAction, setVmAction] = useState<'hangup' | 'leave_message'>('hangup');
  const [vmMessage, setVmMessage] = useState("Hi, this is your assistant calling. Please call us back at your convenience. Thank you.");
  const [transferEnabled, setTransferEnabled] = useState(false);
  const [transferNumbers, setTransferNumbers] = useState<string[]>([]);
  const [transferTriggers, setTransferTriggers] = useState<string[]>([]);
  const [fillerPhrases, setFillerPhrases] = useState<string[]>([]);

  // Cal.com integration (per-agent credentials in agents.integrations_config.calcom)
  const [calcomEnabled, setCalcomEnabled] = useState(false);
  const [calcomApiKey, setCalcomApiKey] = useState('');
  const [calcomEventTypeId, setCalcomEventTypeId] = useState('');
  const [calcomTimezone, setCalcomTimezone] = useState('UTC');
  const [calcomDuration, setCalcomDuration] = useState(30);

  // Derived labels
  const voiceList = VOICES[voiceProvider] || [];
  const sttModelList = STT_MODELS[sttProvider] || [];
  const llmModelList = LLM_MODELS[llmProvider] || [];
  const currentLangLabel = LANGUAGES.find((l) => l.value === language)?.label || language;
  const currentVoiceLabel = voiceList.find((v) => v.value === voiceId)?.label || voiceId || '—';
  const currentLlmLabel = llmModelList.find((m) => m.value === llmModel)?.label || llmModel;
  const currentSttLabel = STT_PROVIDERS.find((p) => p.value === sttProvider)?.label || sttProvider;
  const voiceProviderLabel = VOICE_PROVIDERS.find((p) => p.value === voiceProvider)?.label || voiceProvider;

  // Load existing agent
  useEffect(() => {
    if (!isNew && id) {
      setLoading(true);
      agentApi.get(id)
        .then((data) => {
          const a = data as any;
          setName(a.name || '');
          setDescription(a.description || '');
          setDirection((a.direction || 'INBOUND') as 'INBOUND' | 'OUTBOUND');
          setStatus(a.status || 'DRAFT');
          setCostPerMin(a.cost_per_min != null ? parseFloat(a.cost_per_min) : 0.115);
          setGreeting(a.greeting_message || '');
          setWelcomeDynamic(a.welcome_dynamic !== false);
          setWelcomeInterruptible(!!a.welcome_interruptible);
          setLlmProvider(a.llm_provider || 'openai');
          setLlmModel(a.llm_model || 'gpt-4o');
          setTemperature(a.temperature != null ? parseFloat(a.temperature) : 0.7);
          setSystemPrompt(a.system_prompt || '');
          const vc = a.voice_config || {};
          setVoiceProvider(vc.provider || 'elevenlabs');
          setVoiceId(vc.voice_id || 'rachel');
          setVoiceSpeed(vc.speed ?? 1.0);
          setLanguage(vc.language || 'en-US');
          // Compute effective provider mode from the stored flags so the
          // dropdown round-trips through saves correctly.
          const dp = String(vc.default_provider || 'deepgram').toLowerCase();
          const fp = String(vc.fallback_provider || 'sarvam').toLowerCase();
          if (dp === 'sarvam') setDefaultProvider('sarvam');
          else if (dp === 'auto') setDefaultProvider('auto');
          else if (vc.enable_auto_fallback) setDefaultProvider(fp === 'whisper' ? 'deepgram_with_whisper' : 'deepgram_with_sarvam');
          else setDefaultProvider('deepgram');
          const sc = a.stt_config || {};
          setSttProvider(sc.provider || 'deepgram');
          setSttModel(sc.model || 'nova-2');
          const tools = a.tools_config || [];
          setEnabledTools(
            Array.isArray(tools) ? tools.map((t: any) => (typeof t === 'string' ? t : t.name)).filter(Boolean) : [],
          );
          setAttachedKBs(a.knowledge_base_ids || []);
          const pcc = a.post_call_config || {};
          const acts = Array.isArray(pcc.actions) ? pcc.actions : [];
          setPostCallActions(
            acts.map((x: any) => ({
              id: newActionId(),
              type: (x.type as any) || 'webhook',
              enabled: x.enabled !== false,
              label: x.label || '',
              url: x.url || '',
              method: x.method || 'POST',
              webhook_url: x.webhook_url || '',
              message_template: x.message_template || '',
              to: x.to || '',
              subject_template: x.subject_template || '',
              body_template: x.body_template || '',
            })),
          );
          const cc = a.call_config || {};
          const vm = cc.voicemail_detection || {};
          setVmEnabled(!!vm.enabled);
          setVmAction((vm.action === 'leave_message' ? 'leave_message' : 'hangup') as any);
          if (typeof vm.message === 'string') setVmMessage(vm.message);
          const tr = cc.call_transfer || {};
          setTransferEnabled(!!tr.enabled);
          setTransferNumbers(Array.isArray(tr.numbers) ? tr.numbers : []);
          setTransferTriggers(Array.isArray(tr.trigger_phrases) ? tr.trigger_phrases : []);
          setFillerPhrases(Array.isArray(cc.filler_phrases) ? cc.filler_phrases : []);
          const ic = a.integrations_config || {};
          const cal = ic.calcom || {};
          setCalcomEnabled(!!cal.enabled);
          setCalcomApiKey(cal.api_key || '');
          setCalcomEventTypeId(String(cal.event_type_id || ''));
          setCalcomTimezone(cal.timezone || 'UTC');
          setCalcomDuration(parseInt(cal.default_duration_minutes || '30') || 30);
        })
        .catch((err) =>
          setMessage({ type: 'error', text: 'Failed to load: ' + (err?.response?.data?.error || err.message) }),
        )
        .finally(() => setLoading(false));
    }
  }, [id, isNew]);

  const buildPayload = () => ({
    name: name.trim() || 'Untitled Agent',
    description: description.trim() || undefined,
    direction,
    system_prompt: systemPrompt.trim() || 'You are a helpful assistant.',
    llm_provider: llmProvider,
    llm_model: llmModel,
    temperature,
    greeting_message: greeting.trim() || undefined,
    welcome_dynamic: welcomeDynamic,
    welcome_interruptible: welcomeInterruptible,
    voice_config: {
      provider: voiceProvider,
      voice_id: voiceId,
      speed: voiceSpeed,
      language,
      // Real-time pipeline provider selector. Telephony-adapter reads these.
      default_provider:
        defaultProvider === 'deepgram_with_sarvam' || defaultProvider === 'deepgram_with_whisper'
          ? 'deepgram'
          : defaultProvider,
      enable_auto_fallback:
        defaultProvider === 'deepgram_with_sarvam' || defaultProvider === 'deepgram_with_whisper',
      fallback_provider:
        defaultProvider === 'deepgram_with_whisper' ? 'whisper'
        : defaultProvider === 'deepgram_with_sarvam' ? 'sarvam'
        : undefined,
    },
    stt_config: { provider: sttProvider, model: sttModel, language },
    tools_config: enabledTools.map((t) => ({ name: t, enabled: true })),
    knowledge_base_ids: attachedKBs,
    cost_per_min: costPerMin,
    post_call_config: {
      actions: postCallActions.map((a) => {
        const base: any = { type: a.type, enabled: a.enabled, label: a.label || undefined };
        if (a.type === 'webhook') {
          base.url = a.url;
          base.method = a.method || 'POST';
          if (a.body_template) base.body_template = a.body_template;
        } else if (a.type === 'slack') {
          base.webhook_url = a.webhook_url;
          if (a.message_template) base.message_template = a.message_template;
        } else if (a.type === 'email') {
          base.to = a.to;
          base.subject_template = a.subject_template || undefined;
          base.body_template = a.body_template || undefined;
        }
        return base;
      }),
    },
    call_config: {
      voicemail_detection: {
        enabled: vmEnabled,
        action: vmAction,
        message: vmAction === 'leave_message' ? vmMessage.trim() : undefined,
      },
      call_transfer: {
        enabled: transferEnabled,
        numbers: transferNumbers.map((n) => n.trim()).filter(Boolean),
        trigger_phrases: transferTriggers.map((p) => p.trim()).filter(Boolean),
      },
      filler_phrases: fillerPhrases.map((p) => p.trim()).filter(Boolean),
    },
    integrations_config: {
      calcom: {
        enabled: calcomEnabled,
        api_key: calcomApiKey.trim(),
        event_type_id: calcomEventTypeId.trim(),
        timezone: calcomTimezone.trim() || 'UTC',
        default_duration_minutes: calcomDuration,
      },
    },
  });

  const handleSave = async () => {
    if (!name.trim()) {
      setMessage({ type: 'error', text: 'Agent name is required' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (isNew) {
        const created = await agentApi.create(buildPayload() as any);
        setMessage({ type: 'success', text: 'Agent created' });
        navigate(`/agents/${(created as any).id}`, { replace: true });
      } else {
        await agentApi.update(id!, buildPayload() as any);
        setMessage({ type: 'success', text: 'Saved' });
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text:
          err?.response?.data?.error ||
          err?.response?.data?.details?.[0]?.message ||
          err.message ||
          'Save failed',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (isNew) {
      setMessage({ type: 'error', text: 'Save the agent first, then Deploy.' });
      return;
    }
    setPublishing(true);
    try {
      await agentApi.publish(id!);
      setStatus('PUBLISHED');
      setMessage({ type: 'success', text: 'Agent deployed. Inbound calls to assigned numbers will route here.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Deploy failed: ' + (err?.response?.data?.error || err.message) });
    } finally {
      setPublishing(false);
    }
  };

  const handleToolToggle = (t: string) =>
    setEnabledTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  /**
   * Hand the upload cards / Q&A trainer a KB id, creating one on demand.
   * Each agent gets one personal KB (named after the agent) — the first
   * upload of any kind triggers creation, attaches it locally + on the agent
   * record so the runtime sees it, and returns the id. Returns null and
   * surfaces an inline error if the agent hasn't been saved yet.
   */
  const ensureKbId = async (): Promise<string | null> => {
    if (attachedKBs.length > 0) return attachedKBs[0];
    if (isNew || !id) {
      setMessage({ type: 'error', text: 'Save the agent first, then add knowledge.' });
      return null;
    }
    setEnsuringKb(true);
    try {
      const kb = await knowledgeApi.createKnowledgeBase({
        name: `${name || 'Agent'} — Knowledge`,
        description: `Personal knowledge base for ${name || 'this agent'}.`,
      });
      const next = [kb.id];
      setAttachedKBs(next);
      try {
        await agentApi.update(id, { knowledge_base_ids: next } as any);
      } catch (err: any) {
        // Persist failure isn't fatal for the current upload, but tell the
        // user — they need to Save again to lock it in.
        setMessage({ type: 'error', text: 'KB created, but the agent record did not save — click Save once to persist.' });
      }
      return kb.id;
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Failed to set up knowledge base: ' + (e?.response?.data?.detail || e?.message || 'error') });
      return null;
    } finally {
      setEnsuringKb(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* HEADER TOOLBAR */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/agents')}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          title="Back to agents"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-[220px] max-w-[320px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:border-teal-400 focus:bg-white"
          placeholder="Agent name"
        />

        <button
          type="button"
          onClick={() => setDirection(direction === 'INBOUND' ? 'OUTBOUND' : 'INBOUND')}
          className={`h-9 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-colors ${
            direction === 'INBOUND'
              ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
              : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
          }`}
          title="Toggle direction"
        >
          {direction === 'INBOUND' ? <PhoneIncoming className="h-3.5 w-3.5" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
          {direction === 'INBOUND' ? 'Incoming' : 'Outgoing'}
        </button>

        <div className="text-xs text-gray-500 whitespace-nowrap">
          Cost/min: <span className="font-semibold text-gray-900">${costPerMin.toFixed(3)}</span>
        </div>

        <div className="flex-1" />

        <Button
          variant="gradient"
          size="sm"
          onClick={() => navigate(`/agents/${id}/test`)}
          disabled={isNew}
          className="gap-1.5"
        >
          <Sparkles className="h-4 w-4" /> Ask AI
        </Button>

        <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1 border border-gray-200">
          <span className="text-xs text-gray-500 px-2">Test with</span>
          <button
            onClick={() => navigate(`/agents/${id}/test`)}
            disabled={isNew}
            className="h-7 px-2.5 rounded-md text-xs font-medium bg-teal-100 text-teal-800 hover:bg-teal-200 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Chat
          </button>
          <button
            onClick={() => navigate(`/agents/${id}/call`)}
            disabled={isNew}
            className="h-7 px-2.5 rounded-md text-xs font-medium bg-cyan-100 text-cyan-800 hover:bg-cyan-200 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Monitor className="h-3.5 w-3.5" /> Web Call
          </button>
          <button
            onClick={() => setShowPhoneCallModal(true)}
            disabled={isNew}
            className="h-7 px-2.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <PhoneCall className="h-3.5 w-3.5" /> Phone Call
          </button>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handlePublish}
          loading={publishing}
          disabled={isNew}
          className="gap-1.5 bg-teal-600 hover:bg-teal-700"
        >
          <Rocket className="h-4 w-4" /> {status === 'PUBLISHED' ? 'Deployed' : 'Deploy'}
          {status === 'PUBLISHED' && <Check className="h-3.5 w-3.5" />}
        </Button>

        <Button variant="gradient" size="sm" onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4" /> Save
        </Button>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* TABS ROW */}
      <div className="flex items-center justify-between gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search or jump to..."
            className="pl-9 pr-3 h-9 w-64 text-sm rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:border-teal-300"
          />
        </div>
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'assistant' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Assistant Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <SettingCard
                icon={<Globe className="h-5 w-5" />}
                title="Languages"
                subtitle={currentLangLabel}
                onClick={() => setShowLangModal(true)}
              />
              <SettingCard
                icon={<Mic className="h-5 w-5" />}
                title="Voice (TTS)"
                subtitle={`${voiceProviderLabel} - ${currentVoiceLabel}`}
                onClick={() => setShowVoiceModal(true)}
              />
              <SettingCard
                icon={<Brain className="h-5 w-5" />}
                title="AI Model (LLM)"
                subtitle={currentLlmLabel}
                onClick={() => setShowLlmModal(true)}
              />
              <SettingCard
                icon={<Activity className="h-5 w-5" />}
                title="Transcription (STT)"
                subtitle={currentSttLabel}
                onClick={() => setShowSttModal(true)}
              />
            </div>
          </div>

          {/* Real-time voice pipeline provider — drives the STT+TTS picker on
              live calls (telephony-adapter). Defaults to Deepgram for low
              latency + clean bulk-call scaling; Sarvam stays available as an
              opt-in for native Indic voice quality. */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-900">Voice Pipeline</h3>
              <span className="text-[11px] text-gray-400">Live-call STT + TTS engine</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Default is Deepgram for the fastest, most interruption-safe path. Override per agent if you need native Indic voice quality.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {([
                { value: 'deepgram',                label: 'Deepgram Only',                  hint: 'Lowest latency. Best for English / Hinglish / Hindi callers.' },
                { value: 'deepgram_with_whisper',   label: 'Deepgram + Whisper Fallback',    hint: 'Recommended. Deepgram first; Whisper takes over after 8s silent STT — covers every Indian language.' },
                { value: 'deepgram_with_sarvam',    label: 'Deepgram + Sarvam Fallback',     hint: 'Deepgram first; Sarvam takes over after 8s silent STT — native Indic TTS too.' },
                { value: 'sarvam',                  label: 'Sarvam Only',                    hint: 'Native Telugu/Hindi/Tamil voice quality end-to-end. Slower (3-4s/turn).' },
                { value: 'auto',                    label: 'Auto (Legacy)',                  hint: 'Indic → Sarvam, else Deepgram. Pre-2026 behavior.' },
              ] as const).map((opt) => {
                const active = defaultProvider === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDefaultProvider(opt.value as any)}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      active
                        ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-100'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <Card padding={false}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-gray-500" />
                <span className="font-semibold text-gray-900 text-sm">Welcome Message</span>
              </div>
              <div className="flex items-center gap-4">
                <Toggle label="Dynamic" checked={welcomeDynamic} onChange={setWelcomeDynamic} />
                <Toggle label="Interruptible" checked={welcomeInterruptible} onChange={setWelcomeInterruptible} />
              </div>
            </div>
            <div className="p-5">
              <GenerateWelcomeButton
                disabled={isNew || !systemPrompt.trim()}
                agentId={id}
                onGenerated={(text) => setGreeting(text.slice(0, 600))}
              />
              <textarea
                value={greeting}
                onChange={(e) => setGreeting(e.target.value.slice(0, 600))}
                placeholder="Hello, I am your AI assistant. How can I help you today?"
                rows={3}
                className="mt-2 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 focus:bg-white"
              />
              <div className="text-right text-xs text-gray-400 mt-1">{greeting.length}/600</div>
            </div>
          </Card>

          <Card>
            <ConversationFlowEditor value={systemPrompt} onChange={setSystemPrompt} />
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Description</h3>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this agent does..."
              rows={2}
            />
          </Card>
        </div>
      )}

      {activeTab === 'call' && (
        <CallConfigurationTab
          agentId={id}
          isNew={isNew}
          costPerMin={costPerMin}
          onCostChange={setCostPerMin}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          enabledTools={enabledTools}
          onToolToggle={handleToolToggle}
          vmEnabled={vmEnabled}
          onVmEnabled={setVmEnabled}
          vmAction={vmAction}
          onVmAction={setVmAction}
          vmMessage={vmMessage}
          onVmMessage={setVmMessage}
          transferEnabled={transferEnabled}
          onTransferEnabled={setTransferEnabled}
          transferNumbers={transferNumbers}
          onTransferNumbers={setTransferNumbers}
          transferTriggers={transferTriggers}
          onTransferTriggers={setTransferTriggers}
          fillerPhrases={fillerPhrases}
          onFillerPhrases={setFillerPhrases}
        />
      )}

      {activeTab === 'knowledge' && (
        <div className="space-y-4">
          {/* Two ingestion cards (PDF + URL). Both auto-create the agent's
              personal KB on first use, then upload into it. No "attach KB"
              step — the user just uploads. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <UploadPdfCard
              ensureKbId={ensureKbId}
              onUploaded={() => setKbDocsRefresh((n) => n + 1)}
            />
            <WebsiteKbCard
              ensureKbId={ensureKbId}
              onUploaded={() => setKbDocsRefresh((n) => n + 1)}
            />
          </div>

          {/* Uploaded files list — view content / status */}
          <DocumentsListCard
            kbId={attachedKBs[0] || null}
            refreshSignal={kbDocsRefresh}
            onChanged={() => setKbDocsRefresh((n) => n + 1)}
          />

          {/* Quick Q&A test against the agent's knowledge */}
          <TestKnowledgeCard agentId={id} isNew={isNew} kbId={attachedKBs[0] || null} />

          <KnowledgeTrainerCard
            agentId={id}
            isNew={isNew}
            systemPrompt={systemPrompt}
            agentName={name}
            ensureKbId={ensureKbId}
            onSaved={() => setKbDocsRefresh((n) => n + 1)}
          />
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="space-y-4">
          <EmbedWidgetCard agentId={id} status={status} />
          <CalcomCard
            enabled={calcomEnabled}
            onEnabledChange={setCalcomEnabled}
            apiKey={calcomApiKey}
            onApiKeyChange={setCalcomApiKey}
            eventTypeId={calcomEventTypeId}
            onEventTypeIdChange={setCalcomEventTypeId}
            timezoneName={calcomTimezone}
            onTimezoneNameChange={setCalcomTimezone}
            defaultDuration={calcomDuration}
            onDefaultDurationChange={setCalcomDuration}
          />
          <Card>
            <div className="text-center py-10">
              <Plug className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-900 mb-1">External Integrations</h3>
              <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
                Connect CRMs, calendars, webhooks, and SMS/email services. Manage global integrations in Settings.
              </p>
              <Button variant="outline" onClick={() => navigate('/settings/integrations')}>
                Manage Integrations
              </Button>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'postcall' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Post-Call Actions</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Fire webhooks, Slack messages, or email summaries the moment a call ends. Templates support{' '}
                <code className="text-[11px] bg-gray-100 px-1 rounded">{'{caller_number}'}</code>{' '}
                <code className="text-[11px] bg-gray-100 px-1 rounded">{'{summary}'}</code>{' '}
                <code className="text-[11px] bg-gray-100 px-1 rounded">{'{sentiment}'}</code>{' '}
                <code className="text-[11px] bg-gray-100 px-1 rounded">{'{duration_readable}'}</code>{' '}
                <code className="text-[11px] bg-gray-100 px-1 rounded">{'{transcript_text}'}</code>{' '}
                and more.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPostCallActions((p) => [
                    ...p,
                    { id: newActionId(), type: 'webhook', enabled: true, label: 'New Webhook', url: '', method: 'POST' },
                  ])
                }
              >
                + Webhook
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPostCallActions((p) => [
                    ...p,
                    { id: newActionId(), type: 'slack', enabled: true, label: 'Slack Post', webhook_url: '' },
                  ])
                }
              >
                + Slack
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPostCallActions((p) => [
                    ...p,
                    { id: newActionId(), type: 'email', enabled: true, label: 'Email Summary', to: '' },
                  ])
                }
              >
                + Email
              </Button>
            </div>
          </div>

          {postCallActions.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              No post-call actions yet. Add one above — they'll fire automatically after every ended call.
            </div>
          ) : (
            <div className="space-y-3">
              {postCallActions.map((a, idx) => (
                <div key={a.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={a.enabled}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, enabled: e.target.checked } : x)),
                          )
                        }
                        className="accent-teal-600"
                      />
                      <span
                        className={`px-2 py-0.5 text-[11px] rounded font-medium ${
                          a.type === 'webhook'
                            ? 'bg-blue-100 text-blue-700'
                            : a.type === 'slack'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {a.type.toUpperCase()}
                      </span>
                      <input
                        value={a.label}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                          )
                        }
                        placeholder="Label (e.g. 'Notify sales team')"
                        className="text-sm border-0 border-b border-transparent hover:border-gray-200 focus:border-teal-400 focus:outline-none px-1 py-0.5 flex-1 min-w-[200px]"
                      />
                    </div>
                    <button
                      onClick={() => setPostCallActions((p) => p.filter((_, i) => i !== idx))}
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>

                  {a.type === 'webhook' && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <select
                          value={a.method}
                          onChange={(e) =>
                            setPostCallActions((p) =>
                              p.map((x, i) => (i === idx ? { ...x, method: e.target.value as any } : x)),
                            )
                          }
                          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5"
                        >
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                        </select>
                        <input
                          value={a.url}
                          onChange={(e) =>
                            setPostCallActions((p) =>
                              p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)),
                            )
                          }
                          placeholder="https://your-endpoint.example.com/call-ended"
                          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 font-mono"
                        />
                      </div>
                      <textarea
                        value={a.body_template}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, body_template: e.target.value } : x)),
                          )
                        }
                        placeholder="Body template (optional JSON). Leave blank to send the default payload with call/analysis/transcript."
                        rows={3}
                        className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 resize-none"
                      />
                    </div>
                  )}

                  {a.type === 'slack' && (
                    <div className="space-y-2">
                      <input
                        value={a.webhook_url}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, webhook_url: e.target.value } : x)),
                          )
                        }
                        placeholder="https://hooks.slack.com/services/T.../B.../..."
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 font-mono"
                      />
                      <textarea
                        value={a.message_template}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, message_template: e.target.value } : x)),
                          )
                        }
                        placeholder="Message template. Default: '*Call ended* — {agent_name}\n• Caller: {caller_number}\n• Duration: {duration_readable}\n• Sentiment: {sentiment}\n\n*Summary:* {summary}'"
                        rows={3}
                        className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 resize-none"
                      />
                    </div>
                  )}

                  {a.type === 'email' && (
                    <div className="space-y-2">
                      <input
                        value={a.to}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, to: e.target.value } : x)),
                          )
                        }
                        placeholder="team@yourcompany.com"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                      />
                      <input
                        value={a.subject_template}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, subject_template: e.target.value } : x)),
                          )
                        }
                        placeholder="Subject (e.g. 'Call summary from {caller_number}')"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                      />
                      <textarea
                        value={a.body_template}
                        onChange={(e) =>
                          setPostCallActions((p) =>
                            p.map((x, i) => (i === idx ? { ...x, body_template: e.target.value } : x)),
                          )
                        }
                        placeholder="Body template (leave blank for default: agent/caller/duration/sentiment/summary + full transcript)"
                        rows={4}
                        className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 resize-none"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'recent' && <RecentCallsTab agentId={id} isNew={isNew} />}

      {/* MODALS */}
      <LanguageModal
        open={showLangModal}
        value={language}
        onChange={setLanguage}
        onClose={() => setShowLangModal(false)}
      />

      <VoiceModal
        open={showVoiceModal}
        provider={voiceProvider}
        voiceId={voiceId}
        speed={voiceSpeed}
        onProviderChange={(p) => {
          setVoiceProvider(p);
          const first = (VOICES[p] || [])[0];
          if (first) setVoiceId(first.value);
        }}
        onVoiceChange={setVoiceId}
        onSpeedChange={setVoiceSpeed}
        onClose={() => setShowVoiceModal(false)}
      />

      <LlmModal
        open={showLlmModal}
        provider={llmProvider}
        model={llmModel}
        temperature={temperature}
        onProviderChange={(p) => {
          setLlmProvider(p);
          const first = (LLM_MODELS[p] || [])[0];
          if (first) setLlmModel(first.value);
        }}
        onModelChange={setLlmModel}
        onTemperatureChange={setTemperature}
        onClose={() => setShowLlmModal(false)}
      />

      <SttModal
        open={showSttModal}
        provider={sttProvider}
        model={sttModel}
        onProviderChange={(p) => {
          setSttProvider(p);
          const first = (STT_MODELS[p] || [])[0];
          if (first) setSttModel(first.value);
        }}
        onModelChange={setSttModel}
        onClose={() => setShowSttModal(false)}
      />

      <PhoneCallModal
        open={showPhoneCallModal}
        agentId={id}
        onClose={() => setShowPhoneCallModal(false)}
        onCalled={(note) => setMessage({ type: 'success', text: note })}
        onError={(note) => setMessage({ type: 'error', text: note })}
      />
    </div>
  );
}

/* ---------- Sub-components ---------- */

function LanguageModal({
  open, value, onChange, onClose,
}: {
  open: boolean; value: string; onChange: (v: string) => void; onClose: () => void;
}) {
  return (
    <Modal isOpen={open} onClose={onClose} title="Select Language" size="md">
      <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
        {LANGUAGES.map((l) => (
          <button
            key={l.value}
            onClick={() => { onChange(l.value); onClose(); }}
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm border text-left ${
              value === l.value
                ? 'bg-teal-50 border-teal-400 text-teal-900'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <span>{l.label}</span>
            {value === l.value && <Check className="h-4 w-4 text-teal-600" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function VoiceModal({
  open, provider, voiceId, speed, onProviderChange, onVoiceChange, onSpeedChange, onClose,
}: {
  open: boolean;
  provider: string; voiceId: string; speed: number;
  onProviderChange: (v: string) => void;
  onVoiceChange: (v: string) => void;
  onSpeedChange: (v: number) => void;
  onClose: () => void;
}) {
  const voices = VOICES[provider] || [];
  return (
    <Modal isOpen={open} onClose={onClose} title="Voice (TTS)" size="md">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Provider</label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {VOICE_PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => onProviderChange(p.value)}
                className={`px-2 py-2 rounded-lg text-xs font-medium border ${
                  provider === p.value
                    ? 'bg-teal-50 border-teal-400 text-teal-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Voice</label>
          <div className="grid grid-cols-2 gap-2 mt-2 max-h-60 overflow-y-auto">
            {voices.length === 0 && <div className="col-span-2 text-sm text-gray-400">No voices configured for this provider.</div>}
            {voices.map((v) => (
              <button
                key={v.value}
                onClick={() => onVoiceChange(v.value)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm border text-left ${
                  voiceId === v.value
                    ? 'bg-teal-50 border-teal-400 text-teal-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <span>{v.label}</span>
                {voiceId === v.value && <Check className="h-4 w-4 text-teal-600" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Speed: {speed.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="w-full mt-2 accent-teal-600"
          />
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function LlmModal({
  open, provider, model, temperature, onProviderChange, onModelChange, onTemperatureChange, onClose,
}: {
  open: boolean;
  provider: string; model: string; temperature: number;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onTemperatureChange: (v: number) => void;
  onClose: () => void;
}) {
  const models = LLM_MODELS[provider] || [];
  return (
    <Modal isOpen={open} onClose={onClose} title="AI Model (LLM)" size="md">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Provider</label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {LLM_PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => onProviderChange(p.value)}
                className={`px-2 py-2 rounded-lg text-xs font-medium border ${
                  provider === p.value
                    ? 'bg-teal-50 border-teal-400 text-teal-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Model</label>
          <div className="grid grid-cols-1 gap-2 mt-2 max-h-60 overflow-y-auto">
            {models.map((m) => (
              <button
                key={m.value}
                onClick={() => onModelChange(m.value)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm border text-left ${
                  model === m.value
                    ? 'bg-teal-50 border-teal-400 text-teal-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <span>{m.label}</span>
                {model === m.value && <Check className="h-4 w-4 text-teal-600" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Temperature: {temperature.toFixed(1)}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            className="w-full mt-2 accent-teal-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Precise</span><span>Balanced</span><span>Creative</span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function SttModal({
  open, provider, model, onProviderChange, onModelChange, onClose,
}: {
  open: boolean;
  provider: string; model: string;
  onProviderChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onClose: () => void;
}) {
  const models = STT_MODELS[provider] || [];
  return (
    <Modal isOpen={open} onClose={onClose} title="Transcription (STT)" size="md">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Provider</label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {STT_PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => onProviderChange(p.value)}
                className={`px-2 py-2 rounded-lg text-xs font-medium border ${
                  provider === p.value
                    ? 'bg-teal-50 border-teal-400 text-teal-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase">Model</label>
          <div className="grid grid-cols-1 gap-2 mt-2">
            {models.map((m) => (
              <button
                key={m.value}
                onClick={() => onModelChange(m.value)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm border text-left ${
                  model === m.value
                    ? 'bg-teal-50 border-teal-400 text-teal-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <span>{m.label}</span>
                {model === m.value && <Check className="h-4 w-4 text-teal-600" />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function PhoneCallModal({
  open, agentId, onClose, onCalled, onError,
}: {
  open: boolean;
  agentId?: string;
  onClose: () => void;
  onCalled: (note: string) => void;
  onError: (note: string) => void;
}) {
  const [country, setCountry] = useState('+91');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState<'twilio' | 'plivo' | 'exotel'>('twilio');
  const [dialing, setDialing] = useState(false);
  const [activeCall, setActiveCall] = useState<any>(null);

  const submit = async () => {
    if (!agentId) return;
    const trimmed = phone.replace(/\s|-/g, '');
    if (!/^[0-9]{6,14}$/.test(trimmed)) {
      onError('Enter a valid phone number (digits only).');
      return;
    }
    setDialing(true);
    try {
      const result = await callApi.initiate({
        agentId,
        phoneNumber: country + trimmed,
        provider,
      });
      setActiveCall(result);
      onCalled(`Call initiated via ${provider} to ${country}${trimmed}. The phone will ring shortly.`);
    } catch (err: any) {
      onError(err?.response?.data?.message || err?.response?.data?.error || err.message || 'Failed to place call');
    } finally {
      setDialing(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Phone Call" size="md">
      {activeCall ? (
        <div className="text-center py-4 space-y-3">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mx-auto">
            <PhoneCall className="h-8 w-8 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Call placed</h3>
            <p className="text-sm text-gray-500 mt-1">Status: {activeCall.status || 'RINGING'}</p>
            <p className="text-xs text-gray-400 mt-1">Call ID: {activeCall.id}</p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={() => { setActiveCall(null); setPhone(''); }}>
              Place another call
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Enter a phone number and the agent will call it. Credentials for the selected provider must be in{' '}
            <span className="font-mono text-xs">.env</span>.
          </p>

          {/* Provider selector */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Provider</label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {([
                { v: 'twilio', label: 'Twilio', hint: 'US/Global' },
                { v: 'plivo', label: 'Plivo', hint: 'India friendly' },
                { v: 'exotel', label: 'Exotel', hint: 'India' },
              ] as const).map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setProvider(p.v as any)}
                  className={`px-3 py-2 rounded-lg text-sm border text-left ${
                    provider === p.v
                      ? 'bg-teal-50 border-teal-400 text-teal-900'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[10px] text-gray-400">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-500"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
              ))}
            </select>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              className="flex-1 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-500"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submit} loading={dialing} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              {dialing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              Call now
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Call Configuration Tab (incl. phone-number assignment) ---------- */

function CallConfigurationTab({
  agentId, isNew, costPerMin, onCostChange, temperature, onTemperatureChange, enabledTools, onToolToggle,
  vmEnabled, onVmEnabled, vmAction, onVmAction, vmMessage, onVmMessage,
  transferEnabled, onTransferEnabled, transferNumbers, onTransferNumbers, transferTriggers, onTransferTriggers,
  fillerPhrases, onFillerPhrases,
}: {
  agentId?: string;
  isNew: boolean;
  costPerMin: number;
  onCostChange: (v: number) => void;
  temperature: number;
  onTemperatureChange: (v: number) => void;
  enabledTools: string[];
  onToolToggle: (t: string) => void;
  vmEnabled: boolean;
  onVmEnabled: (v: boolean) => void;
  vmAction: 'hangup' | 'leave_message';
  onVmAction: (v: 'hangup' | 'leave_message') => void;
  vmMessage: string;
  onVmMessage: (v: string) => void;
  transferEnabled: boolean;
  onTransferEnabled: (v: boolean) => void;
  transferNumbers: string[];
  onTransferNumbers: (v: string[]) => void;
  transferTriggers: string[];
  onTransferTriggers: (v: string[]) => void;
  fillerPhrases: string[];
  onFillerPhrases: (v: string[]) => void;
}) {
  const [numbers, setNumbers] = useState<PhoneNumberRecord[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setLoadingNumbers(true);
    setErr(null);
    try {
      const list = await phoneNumberApi.list();
      setNumbers(list);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e.message);
    } finally {
      setLoadingNumbers(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const toggleAssign = async (pn: PhoneNumberRecord) => {
    if (isNew || !agentId) return;
    const newAgentId = pn.agent_id === agentId ? null : agentId;
    try {
      await phoneNumberApi.assign(pn.id, newAgentId);
      reload();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e.message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Call Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cost per minute: ${costPerMin.toFixed(3)}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={costPerMin}
              onChange={(e) => onCostChange(parseFloat(e.target.value))}
              className="w-full accent-teal-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>$0.000</span><span>$0.500</span><span>$1.000</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Response creativity: {temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
              className="w-full accent-teal-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Precise</span><span>Balanced</span><span>Creative</span>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Phone Numbers</h3>
          <span className="text-xs text-gray-500">Click to assign/unassign this agent</span>
        </div>
        {isNew ? (
          <div className="text-sm text-gray-500 italic">Save the agent first to manage phone number assignments.</div>
        ) : err ? (
          <div className="text-sm text-red-600">{err}</div>
        ) : loadingNumbers ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading numbers…
          </div>
        ) : numbers.length === 0 ? (
          <div className="text-sm text-gray-500">
            No numbers yet. <a href="/settings/phone-numbers" className="text-teal-600 hover:underline">Provision one in Settings →</a>
          </div>
        ) : (
          <div className="space-y-2">
            {numbers.map((pn) => {
              const mine = pn.agent_id === agentId;
              return (
                <button
                  key={pn.id}
                  onClick={() => toggleAssign(pn)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left ${
                    mine
                      ? 'bg-teal-50 border-teal-300'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-gray-500" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{pn.phone_number}</div>
                      <div className="text-xs text-gray-500">{pn.provider} • {pn.agent_id ? (mine ? 'assigned to this agent' : 'assigned to another agent') : 'unassigned'}</div>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-md ${mine ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {mine ? 'Assigned' : 'Assign'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Tools</h3>
        <ToolConfigurator enabledTools={enabledTools} onToggle={onToolToggle} />
      </Card>

      {/* Voicemail detection */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Voicemail Detection</h3>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={vmEnabled} onChange={(e) => onVmEnabled(e.target.checked)} className="accent-teal-600" />
            <span className="text-gray-700">Enabled</span>
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          When the carrier detects an answering machine on an outbound call, the agent can either hang up or leave a pre-recorded message instead of starting a conversation with no listener.
        </p>
        {vmEnabled && (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={vmAction === 'hangup'} onChange={() => onVmAction('hangup')} className="accent-teal-600" />
                <span>Hang up immediately</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={vmAction === 'leave_message'} onChange={() => onVmAction('leave_message')} className="accent-teal-600" />
                <span>Leave a message</span>
              </label>
            </div>
            {vmAction === 'leave_message' && (
              <textarea
                value={vmMessage}
                onChange={(e) => onVmMessage(e.target.value)}
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none"
                placeholder="Hi, this is your assistant calling. Please call us back..."
              />
            )}
          </div>
        )}
      </Card>

      {/* Call transfer */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Call Transfer</h3>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={transferEnabled} onChange={(e) => onTransferEnabled(e.target.checked)} className="accent-teal-600" />
            <span className="text-gray-700">Enabled</span>
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Forward to a human when the caller asks. Numbers are tried in order — if the first doesn't answer, the next is dialed automatically. Or have your agent emit <code className="text-[11px] bg-gray-100 px-1 rounded">[TRANSFER]</code> in its reply to escalate.
        </p>
        {transferEnabled && (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">Backup numbers (E.164, in order)</div>
              <StringListEditor
                values={transferNumbers}
                onChange={onTransferNumbers}
                placeholder="+919xxxxxxxxx"
                addLabel="+ Add number"
                mono
              />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">Custom trigger phrases (optional)</div>
              <p className="text-[11px] text-gray-400 mb-2">Defaults already cover "transfer me", "speak to a human", "real person", "manager", etc.</p>
              <StringListEditor
                values={transferTriggers}
                onChange={onTransferTriggers}
                placeholder="connect me to billing"
                addLabel="+ Add phrase"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Filler phrases */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Filler Phrases</h3>
        <p className="text-xs text-gray-500 mb-3">
          Short verbal acknowledgments ("Hmm, let me check…", "One moment please…") prepended to each LLM reply so the agent feels human while it thinks. Leave empty to disable.
        </p>
        <StringListEditor
          values={fillerPhrases}
          onChange={onFillerPhrases}
          placeholder="Hmm, let me check that for you."
          addLabel="+ Add filler"
        />
      </Card>
    </div>
  );
}

/* ---------- Cal.com integration card ---------- */

function CalcomCard({
  enabled, onEnabledChange,
  apiKey, onApiKeyChange,
  eventTypeId, onEventTypeIdChange,
  timezoneName, onTimezoneNameChange,
  defaultDuration, onDefaultDurationChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  eventTypeId: string;
  onEventTypeIdChange: (v: string) => void;
  timezoneName: string;
  onTimezoneNameChange: (v: string) => void;
  defaultDuration: number;
  onDefaultDurationChange: (v: number) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900">Cal.com — Meeting Booking</h3>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} className="accent-teal-600" />
          <span className="text-gray-700">Enabled</span>
        </label>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Let the agent book meetings during a call or chat. When enabled, an instruction is appended to the system prompt teaching the LLM to emit{' '}
        <code className="text-[11px] bg-gray-100 px-1 rounded">{'[BOOK name="..." email="..." start="ISO" duration=30]'}</code>{' '}
        when the user is ready to schedule. The booking is created on Cal.com and the agent confirms the slot.
      </p>
      {enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Cal.com API Key *</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="cal_live_..."
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">cal.com → Settings → Developer → API Keys</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Event Type ID *</label>
              <input
                value={eventTypeId}
                onChange={(e) => onEventTypeIdChange(e.target.value)}
                placeholder="123456"
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">From the URL of your event type's edit page.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Time zone</label>
              <input
                value={timezoneName}
                onChange={(e) => onTimezoneNameChange(e.target.value)}
                placeholder="Asia/Kolkata"
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Default duration (min)</label>
              <input
                type="number"
                min={5}
                max={240}
                value={defaultDuration}
                onChange={(e) => onDefaultDurationChange(parseInt(e.target.value) || 30)}
                className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Embed widget snippet card ---------- */

function EmbedWidgetCard({ agentId, status }: { agentId?: string; status: string }) {
  const [copied, setCopied] = useState(false);
  const [primaryColor, setPrimaryColor] = useState('#4f46e5');
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');

  // Where the widget bundle is hosted. Same origin as the dashboard works for dev;
  // in prod, you'd serve `widget.js` from a CDN or your own static host.
  const widgetSrc = `${window.location.origin}/widget.js`;
  const apiUrl =
    (import.meta.env.VITE_PUBLIC_AI_RUNTIME_URL as string | undefined) ||
    'http://localhost:8000';

  if (!agentId) {
    return (
      <Card>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Embed Chat Widget</h3>
        <p className="text-xs text-gray-500">Save the agent first — the embed snippet needs the agent id.</p>
      </Card>
    );
  }

  if (status !== 'PUBLISHED' && status !== 'ACTIVE') {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="h-5 w-5 text-warning-500" />
          <h3 className="text-sm font-semibold text-gray-900">Embed Chat Widget</h3>
        </div>
        <p className="text-sm text-warning-700 bg-warning-50 border border-warning-200 rounded-lg p-3">
          The widget only loads deployed agents. Click <strong>Deploy</strong> at the top of the page before embedding this agent on a public site.
        </p>
      </Card>
    );
  }

  const snippet = `<script
  src="${widgetSrc}"
  data-agent-id="${agentId}"
  data-api-url="${apiUrl}"
  data-position="${position}"
  data-primary-color="${primaryColor}"
  async></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Globe className="h-5 w-5 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900">Embed Chat Widget</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Drop this single <code className="text-[11px] bg-gray-100 px-1 rounded">&lt;script&gt;</code> tag on any page of your website. Visitors get a floating chat that talks to this agent. No backend setup needed on their side — it calls our public widget endpoint.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs font-medium text-gray-700">Position</label>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as any)}
            className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Primary color</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-8 w-10 rounded border border-gray-200 cursor-pointer"
            />
            <input
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 font-mono"
            />
          </div>
        </div>
      </div>

      <div className="relative">
        <pre className="text-[11px] font-mono bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto whitespace-pre">
{snippet}
        </pre>
        <button
          onClick={copy}
          className={`absolute top-2 right-2 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
            copied ? 'bg-success-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        <strong>Note:</strong> Build the widget bundle from <code className="bg-gray-100 px-1 rounded">frontend/chat-widget</code> and host <code className="bg-gray-100 px-1 rounded">dist/widget.js</code> at the URL above. Set <code className="bg-gray-100 px-1 rounded">VITE_PUBLIC_AI_RUNTIME_URL</code> to your public ai-runtime URL when you deploy.
      </p>
    </Card>
  );
}

/* ---------- Reusable String list editor ---------- */

function StringListEditor({
  values, onChange, placeholder, addLabel = '+ Add', mono = false,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={v}
            onChange={(e) => {
              const next = values.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className={`flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 ${mono ? 'font-mono' : ''}`}
          />
          <button
            type="button"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            className="text-xs px-2 py-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-medium"
      >
        {addLabel}
      </button>
    </div>
  );
}

/* ---------- Recent calls ---------- */

function RecentCallsTab({ agentId, isNew }: { agentId?: string; isNew: boolean }) {
  const [calls, setCalls] = useState<any[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(true);

  useEffect(() => {
    if (isNew || !agentId) { setLoadingCalls(false); return; }
    setLoadingCalls(true);
    callApi.list({ limit: 20 } as any)
      .then((res) => {
        const all = Array.isArray(res) ? res : res.data || [];
        setCalls(all.filter((c: any) => c.agent_id === agentId || c.agentId === agentId));
      })
      .catch(() => setCalls([]))
      .finally(() => setLoadingCalls(false));
  }, [agentId, isNew]);

  if (isNew) {
    return <Card><div className="text-sm text-gray-500">Save the agent first to see its recent calls.</div></Card>;
  }
  if (loadingCalls) {
    return <Card><div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Card>;
  }
  if (calls.length === 0) {
    return (
      <Card>
        <div className="text-center py-10">
          <Clock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No calls yet</h3>
          <p className="text-sm text-gray-500">Trigger a test call to see it appear here.</p>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Calls</h3>
      <div className="divide-y divide-gray-100">
        {calls.map((c) => (
          <div key={c.id} className="py-2.5 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {c.direction === 'OUTBOUND' ? (
                <PhoneOutgoing className="h-4 w-4 text-indigo-600" />
              ) : (
                <PhoneIncoming className="h-4 w-4 text-teal-600" />
              )}
              <div>
                <div className="font-medium text-gray-900">{c.called_number || c.caller_number || '—'}</div>
                <div className="text-xs text-gray-500">{new Date(c.created_at || c.createdAt).toLocaleString()}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-gray-700">{c.status}</div>
              {c.duration_seconds != null && <div className="text-xs text-gray-400">{c.duration_seconds}s</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Generate Welcome button ---------- */
/**
 * Calls the agent's /test endpoint (which runs through the live agent runtime —
 * system prompt + grounding + RAG) with an internal instruction asking for a
 * one-line welcome. The reply is the agent's natural voice for greeting a
 * caller, written from inside its own persona. User can accept/edit.
 */
function GenerateWelcomeButton({
  agentId, disabled, onGenerated,
}: {
  agentId?: string;
  disabled?: boolean;
  onGenerated: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleClick = async () => {
    if (!agentId) {
      setErr('Save the agent first, then generate a welcome.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await agentApi.test(
        agentId,
        'INTERNAL_GENERATION (do not speak this back) — based on your system prompt and business context, produce ONE short voice-call welcome message (max 25 words). Greet the caller naturally, introduce yourself by first name only and what you help with, then ask ONE friendly opening question. Reply with ONLY the welcome line. No quotes, no labels, no markdown.',
      );
      const text = (res.reply || '').trim().replace(/^["']|["']$/g, '');
      if (!text) throw new Error('Empty reply from LLM');
      onGenerated(text);
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Failed to generate welcome');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={!!disabled || busy}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed"
        title={disabled && !agentId ? 'Save the agent first' : 'Generate a welcome from the system prompt'}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy ? 'Generating…' : 'Generate from prompt'}
      </button>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  );
}

/* ---------- Knowledge-Base Q&A Trainer ---------- */
/**
 * Lets the user "train" the agent on FAQ-style Q&A pairs. Each pair has a
 * question (what a customer would ask) + an answer (what the agent should
 * say). [Generate answer] auto-fills the answer using the agent's own runtime
 * so the trainer respects voice / language / business context. [Save to KB]
 * concatenates all pairs into one document and ingests it via /documents/text;
 * the embedder makes them retrievable at call time via RAG.
 */
type QaPair = { id: string; question: string; answer: string; generating?: boolean };
const newPairId = () => Math.random().toString(36).slice(2, 10);

function KnowledgeTrainerCard({
  agentId, isNew, systemPrompt, agentName, ensureKbId, onSaved,
}: {
  agentId?: string;
  isNew: boolean;
  systemPrompt: string;
  agentName: string;
  ensureKbId: () => Promise<string | null>;
  onSaved?: () => void;
}) {
  const [pairs, setPairs] = useState<QaPair[]>([
    { id: newPairId(), question: '', answer: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const updatePair = (id: string, patch: Partial<QaPair>) =>
    setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPair = () => setPairs((prev) => [...prev, { id: newPairId(), question: '', answer: '' }]);
  const removePair = (id: string) =>
    setPairs((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));

  const generateAnswer = async (id: string) => {
    if (!agentId || isNew) {
      setMsg({ kind: 'err', text: 'Save the agent first, then generate answers.' });
      return;
    }
    const pair = pairs.find((p) => p.id === id);
    if (!pair || !pair.question.trim()) return;
    updatePair(id, { generating: true });
    setMsg(null);
    try {
      const res = await agentApi.test(agentId, pair.question.trim());
      const text = (res.reply || '').trim();
      if (!text) throw new Error('Empty reply');
      updatePair(id, { answer: text, generating: false });
    } catch (e: any) {
      updatePair(id, { generating: false });
      setMsg({ kind: 'err', text: e?.response?.data?.error || e?.message || 'Failed to generate answer' });
    }
  };

  const saveToKb = async () => {
    setMsg(null);
    const usable = pairs.filter((p) => p.question.trim() && p.answer.trim());
    if (usable.length === 0) {
      setMsg({ kind: 'err', text: 'Fill at least one Q&A pair (question + answer) before saving.' });
      return;
    }
    setSaving(true);
    try {
      const kbId = await ensureKbId();
      if (!kbId) { setSaving(false); return; }
      // Format as a single FAQ document. Chunker splits each Q/A into its
      // own chunk via the blank-line separator; embedder makes them
      // retrievable at call time.
      const lines: string[] = [
        `# ${agentName || 'Agent'} — Q&A Training`,
        '',
        `Trained on ${new Date().toLocaleString()}.`,
        '',
      ];
      for (const p of usable) {
        lines.push(`Q: ${p.question.trim()}`);
        lines.push(`A: ${p.answer.trim()}`);
        lines.push('');
      }
      const content = lines.join('\n');
      const filename = `${(agentName || 'agent').replace(/\W+/g, '-').toLowerCase()}-qa-${Date.now()}.txt`;
      const doc = await knowledgeApi.addTextDocument({
        knowledge_base_id: kbId,
        filename,
        content,
      });
      setMsg({
        kind: 'ok',
        text: `Saved ${usable.length} Q&A pair${usable.length === 1 ? '' : 's'} as "${doc.filename}". Embeddings are processing — the agent will start using them on the next call.`,
      });
      setPairs([{ id: newPairId(), question: '', answer: '' }]);
      onSaved?.();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.detail || e?.message || 'Failed to save to KB' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" /> Train with Q&amp;A
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Add common customer questions and what the agent should say. Click <strong>Generate answer</strong> to let the agent answer from its own prompt + KB, then tweak. Saved pairs become searchable RAG context on every call.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {pairs.map((p, idx) => (
          <div key={p.id} className="border border-gray-200 rounded-xl p-3 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-gray-500">Q&amp;A #{idx + 1}</span>
              {pairs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePair(p.id)}
                  className="text-[11px] text-gray-400 hover:text-red-600"
                >
                  Remove
                </button>
              )}
            </div>
            <label className="block text-[11px] text-gray-500 mb-1">Question (what would a customer ask?)</label>
            <textarea
              value={p.question}
              onChange={(e) => updatePair(p.id, { question: e.target.value })}
              placeholder="e.g. What documents do I need for MBA admission?"
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none mb-2"
            />
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] text-gray-500">Answer (what the agent should say)</label>
              <button
                type="button"
                onClick={() => generateAnswer(p.id)}
                disabled={!p.question.trim() || !!p.generating || isNew}
                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isNew ? 'Save the agent first' : 'Let the agent generate the answer from its prompt + KB'}
              >
                {p.generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {p.generating ? 'Generating…' : 'Generate answer'}
              </button>
            </div>
            <textarea
              value={p.answer}
              onChange={(e) => updatePair(p.id, { answer: e.target.value })}
              placeholder="The agent's natural-sounding answer."
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-3">
        <Button type="button" variant="outline" size="sm" onClick={addPair}>
          + Add Q&amp;A
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={saveToKb}
          disabled={saving || isNew}
          title={isNew ? 'Save the agent first' : 'Save these Q&A pairs to the agent\'s knowledge base'}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Save Q&amp;A to knowledge base
        </Button>
      </div>

      {msg && (
        <div className={`mt-3 flex items-start gap-2 p-2.5 rounded-lg text-xs ${
          msg.kind === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {!systemPrompt?.trim() && (
        <p className="text-[11px] text-gray-400 mt-3">
          Tip: write a system prompt under Assistant Details first — generated answers use it for tone and accuracy.
        </p>
      )}
    </Card>
  );
}

/* ---------- Upload PDFs card ---------- */
/**
 * Drag-and-drop PDF uploader. Calls ensureKbId() on first use to lazy-create
 * a personal KB for the agent; subsequent uploads reuse it. PDF-only, 10MB
 * cap. The standard parse → chunk → embed pipeline picks up new docs and
 * indexes them for RAG retrieval at call time.
 */
function UploadPdfCard({
  ensureKbId, onUploaded,
}: {
  ensureKbId: () => Promise<string | null>;
  onUploaded?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_BYTES = 10 * 1024 * 1024;

  const upload = async (file: File) => {
    setMsg(null);
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setMsg({ kind: 'err', text: 'Only PDF files are supported here.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      setMsg({ kind: 'err', text: `File too large (${Math.round(file.size / 1024 / 1024)}MB — max 10MB).` });
      return;
    }
    setUploading(true);
    try {
      const kbId = await ensureKbId();
      if (!kbId) { setUploading(false); return; }
      const doc = await knowledgeApi.uploadDocument(kbId, file);
      setMsg({
        kind: 'ok',
        text: `Uploaded "${doc.filename}". Embeddings processing — usually ready in 10–30s.`,
      });
      onUploaded?.();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.detail || e?.message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Upload className="h-4 w-4 text-teal-500" />
        <h3 className="text-sm font-semibold text-gray-900">Upload PDFs</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">Add PDF files to your assistant's knowledge base</p>

      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          uploading
            ? 'border-gray-200 bg-gray-50 cursor-wait'
            : dragOver
              ? 'border-teal-400 bg-teal-50/60 cursor-copy'
              : 'border-gray-200 hover:border-gray-300 cursor-pointer bg-white'
        }`}
      >
        <div className="h-12 w-12 mx-auto mb-3 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6" />}
        </div>
        <p className="text-sm font-medium text-gray-900">
          {uploading ? 'Uploading…' : 'Drag and drop a file here, or click to select'}
        </p>
        <p className="text-xs text-gray-400 mt-1">Supported formats: PDF (max 10MB)</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />

      {msg && (
        <div className={`mt-3 flex items-start gap-2 p-2.5 rounded-lg text-xs ${
          msg.kind === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
    </Card>
  );
}

/* ---------- Website Knowledge Base card ---------- */
/**
 * URL → KB scraper. Same lazy-KB pattern as UploadPdfCard. BFS-crawls up to
 * max_pages of the same-domain pages, extracts main-content text, ingests
 * each as a KB document through the standard pipeline.
 */
function WebsiteKbCard({
  ensureKbId, onUploaded,
}: {
  ensureKbId: () => Promise<string | null>;
  onUploaded?: () => void;
}) {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async () => {
    setMsg(null);
    const u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setMsg({ kind: 'err', text: 'URL must start with http:// or https://' });
      return;
    }
    setBusy(true);
    try {
      const kbId = await ensureKbId();
      if (!kbId) { setBusy(false); return; }
      const res = await knowledgeApi.scrapeWebsite({
        knowledge_base_id: kbId,
        url: u,
        max_pages: maxPages,
        same_domain_only: true,
      });
      setMsg({
        kind: 'ok',
        text: `Ingested ${res.total_pages} page${res.total_pages === 1 ? '' : 's'} from ${res.root_url}. Embeddings processing.`,
      });
      setUrl('');
      onUploaded?.();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.detail || e?.message || 'Scrape failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Globe className="h-4 w-4 text-teal-500" />
        <h3 className="text-sm font-semibold text-gray-900">Website Knowledge Base</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">Add website content to your assistant's knowledge base</p>

      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-700">Website URL</label>
        <span title="We'll crawl this URL and pages it links to on the same domain — up to the page cap." className="text-gray-400 cursor-help">
          <AlertCircle className="h-3 w-3" />
        </span>
      </div>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
        placeholder="https://example.com/"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-teal-100"
      />

      <div className="flex items-center justify-between mb-3 text-xs">
        <label className="text-gray-600">Max pages to crawl</label>
        <input
          type="number"
          min={1}
          max={50}
          value={maxPages}
          onChange={(e) => setMaxPages(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
          className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1 text-center"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={busy || !url.trim()}
        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add to Knowledge Base
      </button>

      {msg && (
        <div className={`mt-3 flex items-start gap-2 p-2.5 rounded-lg text-xs ${
          msg.kind === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
    </Card>
  );
}

/* ---------- Knowledge Files list (with View modal) ---------- */
/**
 * Shows every document in the agent's KB with status + a View button. The
 * View modal fetches the raw bytes from knowledge-service and renders them
 * inline — PDF in an iframe, text/JSON in a <pre> block, anything else as
 * a download link.
 */
function DocumentsListCard({
  kbId, refreshSignal, onChanged,
}: {
  kbId: string | null;
  refreshSignal: number;
  onChanged?: () => void;
}) {
  const [docs, setDocs] = useState<KBDocumentApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<KBDocumentApi | null>(null);

  const reload = async () => {
    if (!kbId) { setDocs([]); setLoading(false); return; }
    setLoading(true);
    setErr(null);
    try {
      const list = await knowledgeApi.listDocuments(kbId);
      setDocs(list);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [kbId, refreshSignal]);

  // Background poll while any doc is still pending/processing so the status
  // pill flips to "Ready" without the user clicking refresh.
  useEffect(() => {
    if (!kbId) return;
    const anyPending = docs.some((d) => d.status === 'pending' || d.status === 'processing');
    if (!anyPending) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [docs, kbId]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this file? The agent will no longer be able to retrieve content from it.')) return;
    try {
      await knowledgeApi.deleteDocument(id);
      onChanged?.();
      reload();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Delete failed');
    }
  };

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Knowledge Files</h3>
          <span className="text-xs text-gray-400">{docs.length}</span>
        </div>
        <button
          type="button"
          onClick={reload}
          className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
          title="Refresh"
        >
          <Loader2 className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {err && (
        <div className="m-4 flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      {!kbId ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          Upload a PDF or website above — your agent's knowledge base will be created automatically and the file will land here.
        </div>
      ) : loading && docs.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
        </div>
      ) : docs.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          No files yet. Upload a PDF or crawl a website above to start training your agent.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {docs.map((d) => {
            const statusInfo: Record<string, { label: string; cls: string }> = {
              pending:    { label: 'Pending',    cls: 'bg-gray-100 text-gray-600' },
              processing: { label: 'Processing', cls: 'bg-blue-50 text-blue-700' },
              processed:  { label: 'Ready',      cls: 'bg-green-50 text-green-700' },
              completed:  { label: 'Ready',      cls: 'bg-green-50 text-green-700' },
              failed:     { label: 'Failed',     cls: 'bg-red-50 text-red-700' },
            };
            const si = statusInfo[d.status] || { label: d.status, cls: 'bg-gray-100 text-gray-600' };
            return (
              <div key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{d.filename}</div>
                    <div className="text-xs text-gray-500">
                      {d.chunk_count > 0 ? `${d.chunk_count} chunk${d.chunk_count === 1 ? '' : 's'}` : '—'}
                      {d.file_size ? ` · ${formatBytes(d.file_size)}` : ''}
                      {' · '}{new Date(d.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${si.cls}`}>{si.label}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setViewing(d)}
                    disabled={d.status === 'pending' || d.status === 'processing'}
                  >
                    View
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDelete(d.id)}
                    className="text-gray-400 hover:text-red-600 p-1"
                    title="Delete"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewing && (
        <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
      )}
    </Card>
  );
}

/**
 * Inline document viewer. Tries the cheap routes first: text-like content
 * gets rendered as <pre>, PDFs in an iframe via blob URL, everything else
 * falls back to a download link. Revokes the blob URL on unmount.
 */
function DocumentViewerModal({ doc, onClose }: { doc: KBDocumentApi; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>('');

  useEffect(() => {
    let url: string | null = null;
    setLoading(true);
    setErr(null);
    knowledgeApi.fetchDocumentRaw(doc.id)
      .then(async ({ blob, contentType: ct }) => {
        setContentType(ct);
        if (ct.startsWith('text/') || ct === 'application/json' || /\.txt$|\.md$|\.json$|\.csv$/.test(doc.filename)) {
          const t = await blob.text();
          setText(t);
        } else {
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      })
      .catch((e: any) => setErr(e?.response?.data?.detail || e?.message || 'Failed to fetch file'))
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [doc.id, doc.filename]);

  const isPdf = contentType === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf');

  return (
    <Modal isOpen={true} onClose={onClose} title={doc.filename} size="lg">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading file…
        </div>
      ) : err ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5" /> {err}
        </div>
      ) : text != null ? (
        <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-4 max-h-[60vh] overflow-auto">{text}</pre>
      ) : isPdf && blobUrl ? (
        <iframe src={blobUrl} title={doc.filename} className="w-full h-[60vh] border border-gray-200 rounded-lg" />
      ) : blobUrl ? (
        <div className="text-sm text-gray-600 p-4">
          This file type can't be previewed inline.{' '}
          <a href={blobUrl} download={doc.filename} className="text-teal-600 hover:underline">Download {doc.filename}</a>.
        </div>
      ) : null}
    </Modal>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

/* ---------- Test Your Knowledge card ---------- */
/**
 * Lets the user ask the agent a question and see the LLM answer with RAG
 * applied against the uploaded files. Useful for verifying that PDFs /
 * scraped pages / Q&A pairs actually ground answers without needing to dial
 * a real call. The badge shows how many KB chunks were retrieved.
 */
function TestKnowledgeCard({
  agentId, isNew, kbId,
}: { agentId?: string; isNew: boolean; kbId: string | null }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ text: string; chunks: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async () => {
    setErr(null);
    setAnswer(null);
    if (!question.trim()) return;
    if (!agentId || isNew) {
      setErr('Save the agent first, then test the knowledge.');
      return;
    }
    setBusy(true);
    try {
      const res = await agentApi.test(agentId, question.trim());
      setAnswer({ text: (res.reply || '').trim(), chunks: res.rag_chunks_used || 0 });
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Failed to get an answer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" /> Test Your Knowledge
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Ask the agent any question — it'll answer using the uploaded PDFs, scraped pages, and Q&amp;A pairs above (RAG retrieval). This is the same retrieval path used during a real call.
          </p>
        </div>
      </div>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) ask(); }}
        placeholder={'e.g. What is the MBA admission fee?\n     What documents do I need for the scholarship?\n     Who do I call for hostel queries?'}
        rows={3}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-100"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-gray-400">
          {kbId
            ? <>Knowledge base attached — answers will be grounded in uploaded files.</>
            : <>No knowledge base yet — upload a PDF or URL above first.</>}
        </span>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={ask}
          disabled={busy || !question.trim() || isNew}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Ask agent
        </Button>
      </div>

      {err && (
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> {err}
        </div>
      )}

      {answer && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Bot className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-[11px] font-medium text-gray-600">Agent reply</span>
            {answer.chunks > 0 ? (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                <BookOpen className="h-3 w-3" /> {answer.chunks} chunk{answer.chunks === 1 ? '' : 's'} retrieved
              </span>
            ) : (
              <span className="ml-auto text-[10px] text-gray-500">No KB chunks matched — answered from prompt only</span>
            )}
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{answer.text || <span className="italic text-gray-400">(empty reply)</span>}</p>
        </div>
      )}
    </Card>
  );
}
