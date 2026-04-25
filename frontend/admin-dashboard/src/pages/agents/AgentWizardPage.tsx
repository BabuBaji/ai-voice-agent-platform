import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Play,
  PhoneCall,
  Globe2,
  Mic,
  Sparkles,
  AlertCircle,
  Loader2,
  ChevronDown,
  Wand2,
  X,
  ListTree,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import {
  LANGUAGES,
  WIZARD_VOICE_PROVIDERS,
  WIZARD_VOICES,
  COUNTRY_CODES,
} from '@/utils/constants';
import { agentApi } from '@/services/agent.api';
import { callApi } from '@/services/call.api';
import { generateConversationFlow } from '@/utils/conversationFlow';
import { MyAssistantsSection } from '@/components/agent-builder/MyAssistantsSection';
import {
  USE_CASE_TABS,
  AGENT_TEMPLATES,
  type UseCaseId,
  type AgentTemplate,
} from './agentTemplates';
// Icons referenced by agentTemplates.ts (stored there as string names so
// that file stays free of React imports). This map resolves each string to
// the actual component.
import {
  Phone as PhoneIcon,
  Shield,
  ShoppingCart,
  CalendarPlus,
  Stethoscope,
  Scissors,
  Monitor,
  Wrench,
  Headphones,
  Package,
  Wifi,
  GraduationCap,
  FileSignature,
  Car,
  Briefcase,
  Receipt,
  Landmark,
  Home,
  Zap,
} from 'lucide-react';

const TEMPLATE_ICONS: Record<string, any> = {
  Phone: PhoneIcon,
  Shield,
  ShoppingCart,
  CalendarPlus,
  Stethoscope,
  Scissors,
  Monitor,
  Wrench,
  Headphones,
  Package,
  Wifi,
  GraduationCap,
  FileSignature,
  Car,
  Briefcase,
  Receipt,
  Landmark,
  Home,
  Zap,
};

/** Use-case chips shown under the prompt textarea. Click to prefill a template. */
const USE_CASES: Array<{ label: string; prompt: string }> = [
  {
    label: 'Lead Generation',
    prompt:
      'Call prospects from our list to qualify their interest in our product. Ask about their current setup, budget range, and timeline. If they\'re a good fit, schedule a 15-minute demo with our sales team.',
  },
  {
    label: 'Appointments',
    prompt:
      'Help callers book an appointment. Ask for their full name, email, preferred date and time. Confirm the slot, then create the booking.',
  },
  {
    label: 'Support',
    prompt:
      'Provide first-line customer support. Greet the caller, ask how you can help, and answer using our knowledge base. If the issue needs a human, transfer to a support agent.',
  },
  {
    label: 'Negotiation',
    prompt:
      'Negotiate payment terms or contract details on behalf of the business. Stay calm, restate the customer\'s position, and offer pre-approved discounts when appropriate.',
  },
  {
    label: 'Collections',
    prompt:
      'Politely contact customers about overdue invoices. Confirm their identity, state the outstanding amount, and offer a payment link or installment plan.',
  },
];

const LLM_PROVIDERS = [
  { value: 'mock', label: 'Demo Mode (No API Key)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'google', label: 'Google (Gemini)' },
];

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  mock: [{ value: 'mock-v1', label: 'Mock AI (Demo)' }],
  openai: [
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
};

const STEPS = [
  { id: 1, title: 'System Prompt', icon: Sparkles },
  { id: 2, title: 'Language(s)', icon: Globe2 },
  { id: 3, title: 'Voice', icon: Mic },
];

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {STEPS.map((s, idx) => {
        const done = step > s.id;
        const active = step === s.id;
        return (
          <div key={s.id} className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  done
                    ? 'bg-teal-500 text-white'
                    : active
                    ? 'bg-teal-500 text-white ring-2 ring-teal-100'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <span
                className={`text-xs font-medium hidden sm:inline ${
                  active ? 'text-gray-900' : done ? 'text-gray-600' : 'text-gray-400'
                }`}
              >
                {s.title}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`h-px w-6 sm:w-10 ${done ? 'bg-teal-500' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AgentWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Step 1: prompt-driven create (matches OmniDim's landing screen)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [llmProvider, setLlmProvider] = useState('google');
  const [llmModel, setLlmModel] = useState('gemini-2.5-flash');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [guidedFlow, setGuidedFlow] = useState(true);
  const [enhancing, setEnhancing] = useState(false);

  // Step 2: languages
  const [languages, setLanguages] = useState<string[]>(['en-US']);

  // Step 3: voice
  const [voiceTab, setVoiceTab] = useState('recommended');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  // Final create + call modal
  const [creating, setCreating] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callSubmitting, setCallSubmitting] = useState(false);

  const primaryLanguage = languages[0] || 'en-US';

  const visibleVoices = useMemo(() => {
    if (voiceTab === 'recommended') {
      return WIZARD_VOICES.filter((v) => v.languages.includes(primaryLanguage));
    }
    if (voiceTab === 'cloned') return [];
    return WIZARD_VOICES.filter((v) => v.provider === voiceTab);
  }, [voiceTab, primaryLanguage]);

  const selectedVoice = useMemo(
    () => WIZARD_VOICES.find((v) => v.id === selectedVoiceId) || null,
    [selectedVoiceId]
  );

  const pickUseCase = (uc: typeof USE_CASES[number]) => {
    setSystemPrompt(uc.prompt);
    if (!name.trim()) setName(`${uc.label} Agent`);
  };

  // Use-case tab + template-card state. No category is active by default —
  // the templates row only appears after the user picks one.
  const [activeUseCase, setActiveUseCase] = useState<UseCaseId | null>(null);

  // Restore prefill from the public LandingPage (`/landing`) — when a new
  // visitor types a prompt + picks a use case there and clicks "Create Agent",
  // we route them through signup, then drop them on this wizard with their
  // selections already filled in and Step 1 marked complete.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('va-landing-prefill');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.systemPrompt) setSystemPrompt(data.systemPrompt);
      if (data?.name) setName(data.name);
      if (data?.description) setDescription(data.description);
      if (data?.activeUseCase) setActiveUseCase(data.activeUseCase);
      if (typeof data?.guidedFlow === 'boolean') setGuidedFlow(data.guidedFlow);
      // Skip the System Prompt step since the user already wrote one on the
      // landing page — advance straight to Language selection.
      if (data?.systemPrompt) setStep(2);
      sessionStorage.removeItem('va-landing-prefill');
    } catch {
      sessionStorage.removeItem('va-landing-prefill');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTemplates = useMemo(
    () => (activeUseCase ? AGENT_TEMPLATES.filter((t) => t.use_case === activeUseCase) : []),
    [activeUseCase]
  );
  const pickTemplate = (t: AgentTemplate) => {
    setSystemPrompt(t.prompt);
    if (!name.trim()) setName(t.title);
  };

  /**
   * "Generate Flow" — deterministic client-side alternative to "Enhance Prompt".
   * Takes whatever the user has typed (or the current system prompt) and
   * rewrites it as a structured multi-section prompt — Agent Identity & Purpose
   * → Understand Caller Query → Provide Information → Close the Conversation.
   * No LLM call, so it always works even when providers are down.
   */
  const handleGenerateFlow = () => {
    const expanded = generateConversationFlow({
      userDescription: systemPrompt.trim() || (name.trim() || 'a helpful voice assistant'),
      agentName: name.trim(),
      businessName: description.trim() || undefined,
    });
    setSystemPrompt(expanded);
    setError(null);
  };

  /**
   * "Enhance Prompt" — POST the short user-typed prompt to the LLM via
   * the existing /chat/simple proxy, asking it to expand into a full system
   * prompt with persona / goal / behaviour / greeting sections. Falls back
   * gracefully when the LLM is unavailable so the user can still continue.
   */
  const enhancePrompt = async () => {
    if (!systemPrompt.trim()) {
      setError('Type a one-line description first, then I can expand it.');
      return;
    }
    setEnhancing(true);
    setError(null);
    try {
      const aiUrl =
        (import.meta.env.VITE_PUBLIC_AI_RUNTIME_URL as string | undefined) ||
        `${window.location.protocol}//${window.location.hostname}:8000`;
      const resp = await fetch(`${aiUrl}/chat/simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt:
            'You are a prompt engineer for voice AI agents. Given a one-line user description, write a clean, focused system prompt for the agent. Use this structure:\n\n# AGENT GLOBAL INSTRUCTIONS\n\n## PERSONA\n- (warm, conversational, etc.)\n\n## GOAL\n- (the call objective)\n\n## BEHAVIOUR\n- (specific rules: ask one question, escalate to human if asked, never make promises, etc.)\n\n## GREETING\n- "<the actual line the agent should open with>"\n\nWrite plainly. No preamble, no markdown fences. Output ONLY the prompt body.',
          messages: [{ role: 'user', content: systemPrompt }],
          provider: llmProvider,
          model: llmModel,
          temperature: 0.6,
          max_tokens: 600,
        }),
      });
      if (!resp.ok) throw new Error(`LLM ${resp.status}`);
      const data = (await resp.json()) as { reply?: string };
      const expanded = (data?.reply || '').trim();
      if (expanded.length > 50) {
        setSystemPrompt(expanded);
      } else {
        setError('Couldn\'t expand the prompt right now. Edit it manually instead.');
      }
    } catch (e: any) {
      setError(`Enhance failed: ${e?.message || 'unknown'}. You can still write the prompt by hand.`);
    } finally {
      setEnhancing(false);
    }
  };

  const previewVoice = (voiceName: string, lang: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(
      `Hello, I'm ${voiceName}. I can help you on calls in your preferred language.`
    );
    utter.lang = lang;
    utter.onend = () => setPreviewingVoiceId(null);
    utter.onerror = () => setPreviewingVoiceId(null);
    setPreviewingVoiceId(voiceName);
    window.speechSynthesis.speak(utter);
  };

  const validateStep = (current: number): string | null => {
    if (current === 1) {
      if (!name.trim()) return 'Agent name is required';
      if (!systemPrompt.trim()) return 'System prompt cannot be empty';
    }
    if (current === 2) {
      if (languages.length === 0) return 'Select at least one language';
    }
    if (current === 3) {
      if (!selectedVoiceId) return 'Pick a voice for your assistant';
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // Step 1 + Guided Flow OFF → skip language/voice and create immediately
    // with sensible defaults (en-US + first recommended voice).
    if (step === 1 && !guidedFlow) {
      if (!selectedVoiceId) {
        const fallback = WIZARD_VOICES.find((v) => v.languages.includes('en-US')) || WIZARD_VOICES[0];
        if (fallback) setSelectedVoiceId(fallback.id);
      }
      // setSelectedVoiceId is async; defer creation to next tick so state lands first
      setTimeout(() => { void handleCreateAgent(); }, 0);
      return;
    }
    setStep((s) => Math.min(STEPS.length, s + 1));
  };

  const handleBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const handleCreateAgent = async () => {
    const err = validateStep(STEPS.length);
    if (err) {
      setError(err);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const voice = selectedVoice!;
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        system_prompt: systemPrompt.trim(),
        llm_provider: llmProvider,
        llm_model: llmModel,
        temperature: 0.7,
        voice_config: {
          provider: voice.provider,
          voice_id: voice.id,
          speed: 1.0,
          language: primaryLanguage,
          languages,
        },
        tools_config: [],
        knowledge_base_ids: [],
      };
      const created = await agentApi.create(payload as any);
      setCreatedAgentId(created.id);
      setShowCallModal(true);
    } catch (e: any) {
      setError(
        e?.response?.data?.error ||
          e?.response?.data?.details?.[0]?.message ||
          e.message ||
          'Failed to create agent'
      );
    } finally {
      setCreating(false);
    }
  };

  const handleStartWebCall = () => {
    if (!createdAgentId) return;
    setShowCallModal(false);
    navigate(`/agents/${createdAgentId}/call`);
  };

  const handleStartPhoneCall = async () => {
    if (!createdAgentId) return;
    if (!phoneNumber.trim()) {
      setError('Enter a phone number for the test call');
      return;
    }
    setCallSubmitting(true);
    setError(null);
    try {
      const fullNumber = `${countryCode}${phoneNumber.replace(/\s+/g, '')}`;
      await callApi.initiate({ agentId: createdAgentId, phoneNumber: fullNumber });
      setShowCallModal(false);
      navigate(`/agents/${createdAgentId}`);
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.response?.data?.err ||
        e.message ||
        'Failed to start phone call';
      setError(msg);
    } finally {
      setCallSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/agents')}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            Set Up Your <span className="text-teal-500">Voice AI</span> Assistant
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure your assistant in {STEPS.length} simple steps
          </p>
        </div>
      </div>

      <StepIndicator step={step} />

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Step content */}
      <Card>
        {step === 1 && (
          <div className="space-y-3">
            {/* OmniDim-style centered hero: prompt first, name second */}
            <div className="text-center pb-1">
              <p className="text-xs text-gray-500">
                Describe what your agent should do — pick a use case below for a starter, or write your own.
              </p>
            </div>

            <div className="relative">
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="e.g., book an appointment for hospital"
                rows={5}
                className="font-mono text-xs leading-relaxed pr-2"
              />
              <div className="flex items-center justify-between mt-1.5">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={guidedFlow}
                    onChange={(e) => setGuidedFlow(e.target.checked)}
                    className="accent-teal-600 h-3 w-3"
                  />
                  <span>Guided Flow <span className="text-gray-400">(language + voice picker)</span></span>
                </label>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateFlow}
                    className="rounded-lg"
                    title="Rewrite as a structured conversation flow (no LLM call)"
                  >
                    <ListTree className="h-3 w-3" />
                    Generate Flow
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={enhancePrompt}
                    disabled={enhancing}
                    className="rounded-lg"
                  >
                    {enhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Enhance Prompt
                  </Button>
                </div>
              </div>
            </div>

            {/* Use-case tabs — click one to filter the template cards below */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 mb-1.5">Choose from use cases</p>
              <div className="flex flex-wrap gap-1.5">
                {USE_CASE_TABS.map((tab) => {
                  const isActive = activeUseCase === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveUseCase(tab.id)}
                      className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-colors border ${
                        isActive
                          ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Template cards for the active use case — only shown once the
                user picks a use-case tab (no default selection). */}
            {activeUseCase && (
            <div>
              <p className="text-[11px] font-medium text-gray-500 mb-1.5">Choose from templates</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredTemplates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] || Sparkles;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTemplate(t)}
                      className="text-left rounded-lg border border-gray-200 bg-white p-2.5 hover:border-teal-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-2">
                        <span className="w-7 h-7 rounded-md bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-xs text-gray-900 truncate">{t.title}</h4>
                            <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 whitespace-nowrap">
                              {t.industry}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-500 line-clamp-2 leading-snug">{t.short_description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredTemplates.length === 0 && (
                <div className="text-xs text-gray-400 py-4 text-center">No templates for this category yet.</div>
              )}
            </div>
            )}

            {/* Agent name + optional description */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <Input
                label="Agent Name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Ava — Sales Qualifier"
              />
              <Input
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short note about this agent"
              />
            </div>

            {/* Advanced — LLM provider + model */}
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                />
                Advanced — LLM model
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <Select
                    label="Provider"
                    value={llmProvider}
                    onChange={(e) => {
                      setLlmProvider(e.target.value);
                      setLlmModel(LLM_MODELS[e.target.value]?.[0]?.value || '');
                    }}
                    options={LLM_PROVIDERS}
                  />
                  <Select
                    label="Model"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    options={LLM_MODELS[llmProvider] || []}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Choose language(s)</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Pick the language the agent will use on calls.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {LANGUAGES.map((lang) => {
                const checked = languages[0] === lang.value;
                return (
                  <button
                    key={lang.value}
                    type="button"
                    onClick={() => setLanguages([lang.value])}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                      checked
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-900">
                      {lang.label}
                    </span>
                    {checked && <Check className="h-4 w-4 text-teal-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Pick a voice</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Selected:{' '}
                <span className="font-medium text-gray-900">
                  {selectedVoice ? `${selectedVoice.name} (${selectedVoice.provider})` : 'None Selected'}
                </span>
              </p>
            </div>

            <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-hide">
              {WIZARD_VOICE_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setVoiceTab(p.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-all ${
                    voiceTab === p.id
                      ? 'border-teal-500 text-teal-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {voiceTab === 'recommended' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-teal-50 text-teal-700 text-sm">
                <Sparkles className="h-4 w-4" />
                These voices are specifically recommended for{' '}
                <span className="font-semibold">
                  {LANGUAGES.find((l) => l.value === primaryLanguage)?.label || primaryLanguage}
                </span>
              </div>
            )}

            {visibleVoices.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-500">
                {voiceTab === 'cloned'
                  ? 'No cloned voices yet. Upload a voice sample in settings to see them here.'
                  : 'No voices available for this provider yet.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleVoices.map((v) => {
                  const active = selectedVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        active
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedVoiceId(v.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                              active ? 'border-teal-500 bg-teal-500' : 'border-gray-300'
                            }`}
                          >
                            {active && <div className="h-2 w-2 bg-white rounded-full" />}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{v.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5 capitalize">{v.provider}</div>
                            <span className="inline-block mt-2 px-2 py-0.5 rounded-md bg-gray-100 text-[11px] text-gray-700">
                              {v.gender}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            previewVoice(v.name, primaryLanguage);
                          }}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                          title="Preview voice"
                        >
                          {previewingVoiceId === v.name ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Quick-access Next button sitting at the top-right corner, right
          above the "My Voice AI Assistants" grid. This is in addition to the
          footer Next button below — both work identically so users don't have
          to scroll back down after inspecting existing agents. */}
      {step === 1 && (
        <div className="flex justify-end">
          <Button
            variant="gradient"
            onClick={handleNext}
            loading={step === 1 && !guidedFlow && creating}
            className="rounded-xl"
          >
            {step === 1 && !guidedFlow ? 'Create Agent' : 'Next'}
            {!(step === 1 && !guidedFlow) && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {/* Existing assistants — shown alongside step 1 only so it doesn't
          interfere with the language/voice steps. Entirely self-contained:
          fetches its own data, navigates on click, doesn't touch wizard state. */}
      {step === 1 && <MyAssistantsSection />}

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={step === 1 ? () => navigate('/agents') : handleBack}
          className="rounded-xl"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {step < STEPS.length ? (
          <Button variant="gradient" onClick={handleNext} loading={step === 1 && !guidedFlow && creating} className="rounded-xl">
            {step === 1 && !guidedFlow ? 'Create Agent' : 'Next'}
            {!(step === 1 && !guidedFlow) && <ArrowRight className="h-4 w-4" />}
          </Button>
        ) : (
          <Button variant="gradient" onClick={handleCreateAgent} loading={creating} className="rounded-xl">
            Create Agent
          </Button>
        )}
      </div>

      {/* Test call modal */}
      <Modal
        isOpen={showCallModal}
        onClose={() => {
          setShowCallModal(false);
          if (createdAgentId) navigate(`/agents/${createdAgentId}`);
        }}
        title=""
      >
        <div className="space-y-5 relative">
          {/* Close button — the outer Modal only renders its built-in X when a
              title is passed, so we drop a manual X here to dismiss the popup
              without placing a test call. Clicking it navigates to the newly-
              created agent's page (same behaviour as Modal.onClose). */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setShowCallModal(false);
              if (createdAgentId) navigate(`/agents/${createdAgentId}`);
            }}
            className="absolute -top-2 -right-2 p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3">
            {creating ? (
              <div className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-600">
                <Check className="h-5 w-5" />
              </div>
            )}
            <h3 className="text-xl font-semibold text-gray-900">
              {creating ? 'Your agent is being created...' : 'Agent ready — let\'s test it'}
            </h3>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Call To (Phone Number)
            </label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="rounded-xl border border-gray-300 px-2.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-500"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="91001 20435"
                className="flex-1 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-500"
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              A test call will be placed to this number within 2 minutes to test your assistant.
              Please provide a real phone number you have access to.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              variant="outline"
              onClick={handleStartWebCall}
              className="rounded-xl"
            >
              <PhoneCall className="h-4 w-4" />
              Start Web Call
            </Button>
            <Button
              variant="gradient"
              onClick={handleStartPhoneCall}
              loading={callSubmitting}
              className="rounded-xl"
            >
              <PhoneCall className="h-4 w-4" />
              Start Phone Call
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
