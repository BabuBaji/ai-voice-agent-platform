import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mic, Phone, Sparkles, ListTree, Wand2, ArrowRight,
  Briefcase, CalendarPlus, Car, FileSignature, GraduationCap, Headphones, Home,
  Landmark, Monitor, Package, Receipt, Scissors, Shield, ShoppingCart, Stethoscope,
  Wifi, Wrench, Zap,
  Bot, MessageSquare, BookOpen, Users, BarChart3, PhoneCall, PenLine, Globe2,
  Rocket, Star, ShieldCheck, Zap as ZapIcon, Workflow, Megaphone, Check, KeyRound,
} from 'lucide-react';

const LANGUAGE_BADGES = [
  'English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu', 'Odia',
];

const FEATURES = [
  { icon: Bot,           title: 'AI Voice Agents',    desc: 'Spin up an inbound or outbound agent in minutes. Pick a template, customize the prompt, deploy.' },
  { icon: PhoneCall,     title: 'Real Phone Calls',   desc: 'Plivo, Twilio, Exotel — your numbers, your minutes. Full call recording and AI analysis included.' },
  { icon: MessageSquare, title: 'Chatbot Widgets',    desc: 'Embeddable text chatbot for any website. Same brain as your voice agent — lead capture, multi-language.' },
  { icon: BookOpen,      title: 'Knowledge Base',     desc: 'Upload PDFs, docs, and URLs. Your agent answers grounded in your content with inline citations.' },
  { icon: Users,         title: 'Built-in CRM',       desc: 'Every call lands in CRM with sentiment, lead score, and next-best-action — no integration needed.' },
  { icon: BarChart3,     title: 'Deep Analytics',     desc: 'Per-call sentiment, transcript, AI summary, and team-level dashboards out of the box.' },
];

const HOW_STEPS = [
  { icon: PenLine, title: 'Describe your agent',         desc: 'Write a prompt or pick a starter template. Tone, opening line, and goals — all configurable.' },
  { icon: Globe2,  title: 'Configure language & voice', desc: 'Pick from 14+ Indian languages and 50+ voices. Or clone your own brand voice in seconds.' },
  { icon: Rocket,  title: 'Deploy & connect',           desc: 'Get a phone number, embed a chat widget, or wire it to WhatsApp. Live in minutes.' },
];

const USE_CASES = [
  { icon: Briefcase,     title: 'Sales & Lead Qualification', desc: 'Outbound calling, qualification, and warm hand-off to humans.' },
  { icon: Headphones,    title: 'Customer Support',           desc: '24×7 inbound support with knowledge-grounded answers.' },
  { icon: CalendarPlus,  title: 'Appointments & Bookings',    desc: 'Slot suggestions, confirmations, reminders, and reschedules.' },
  { icon: Package,       title: 'Order & Delivery Updates',   desc: 'Status pings, OTP delivery, and exception handling at scale.' },
  { icon: Stethoscope,   title: 'Healthcare Triage',          desc: 'Symptom intake, doctor matching, and follow-up reminders.' },
  { icon: GraduationCap, title: 'Education & Coaching',       desc: 'Admissions calls, course discovery, and student check-ins.' },
  { icon: Landmark,      title: 'Real Estate & Loans',        desc: 'Lead screening, KYC pre-checks, and document collection.' },
  { icon: FileSignature, title: 'Surveys & Feedback',         desc: 'NPS, CSAT, and post-call surveys with sentiment scoring.' },
];

const STATS = [
  { value: '14+',    label: 'Indian Languages' },
  { value: '<500ms', label: 'Voice Latency' },
  { value: '99.9%',  label: 'Uptime SLA' },
  { value: '50',     label: 'Free Voice Clones' },
];

const INTEGRATIONS = [
  { name: 'OpenAI',     kind: 'GPT · Whisper',    initials: 'AI', gradient: 'from-emerald-500 to-teal-600' },
  { name: 'Gemini',     kind: 'Google AI · LLM',  initials: 'GG', gradient: 'from-blue-500 to-indigo-600' },
  { name: 'Claude',     kind: 'Anthropic · LLM',  initials: 'AC', gradient: 'from-orange-500 to-amber-600' },
  { name: 'Sarvam AI',  kind: 'Indic LLM/TTS',    initials: 'SA', gradient: 'from-purple-500 to-fuchsia-600' },
  { name: 'Deepgram',   kind: 'STT · TTS',        initials: 'DG', gradient: 'from-cyan-500 to-sky-600' },
  { name: 'ElevenLabs', kind: 'Voice Cloning',    initials: '11', gradient: 'from-rose-500 to-pink-600' },
  { name: 'Plivo',      kind: 'Telephony',        initials: 'PL', gradient: 'from-amber-500 to-orange-600' },
  { name: 'Twilio',     kind: 'Telephony',        initials: 'TW', gradient: 'from-red-500 to-rose-600' },
];

type ProductDetail = {
  id: string;
  icon: any;
  title: string;
  tagline: string;
  description: string;
  capabilities: string[];
  metrics: { value: string; label: string }[];
  accent: string;
};

const PRODUCT_DETAILS: ProductDetail[] = [
  {
    id: 'voice-agents', icon: Bot, title: 'AI Voice Agents',
    tagline: 'AI that picks up the phone — in 14 languages.',
    description: 'Build inbound or outbound voice agents in minutes. Pick a template, customize the prompt, and deploy — agents handle qualification, support, bookings, and follow-ups end-to-end.',
    capabilities: [
      'Multi-language: English + 13 Indian languages out of the box',
      'Streaming TTS · <500 ms first-byte voice latency',
      'Inbound and outbound calling, both via the same agent',
      'Plivo, Twilio, Exotel telephony — your numbers, your minutes',
      'Stereo recording, transcript, and AI summary on every call',
      'Lead score + sentiment auto-attached to your CRM',
    ],
    metrics: [
      { value: '14+',    label: 'Languages' },
      { value: '<500ms', label: 'Voice latency' },
      { value: '99.9%',  label: 'Uptime' },
    ],
    accent: 'from-amber-500 to-rose-500',
  },
  {
    id: 'chatbots', icon: MessageSquare, title: 'Chatbots',
    tagline: 'Embeddable text bot — same brain as your voice agent.',
    description: 'Drop a chat widget on any website. Same prompt, same knowledge, same lead capture — deployable to web, WhatsApp, and your support email in minutes.',
    capabilities: [
      'One-line embed snippet — works on any website',
      'RAG-grounded answers from your knowledge base',
      'Lead-capture forms with custom fields',
      'Multi-language replies — auto-detects user language',
      'Hand-off to human agent with full conversation context',
      'Same agent definition for voice and chat',
    ],
    metrics: [
      { value: '<200ms', label: 'First token' },
      { value: '14+',    label: 'Languages' },
      { value: '1 line', label: 'To embed' },
    ],
    accent: 'from-rose-500 to-pink-600',
  },
  {
    id: 'phone-numbers', icon: Phone, title: 'Phone Numbers',
    tagline: 'Bring your own numbers. Or rent ours.',
    description: 'Connect Plivo, Twilio, or Exotel and assign numbers per agent. Inbound webhook, outbound dial, and full call recording — all wired up automatically.',
    capabilities: [
      'Plivo, Twilio, Exotel integrations — pick your provider',
      'India + US numbers; international support on request',
      'Per-agent number routing and answer-XML',
      'Inbound + outbound on the same number',
      'Stereo call recordings with caller / agent split',
      'Webhook events for ringing, answered, completed',
    ],
    metrics: [
      { value: '3',     label: 'Telcos supported' },
      { value: 'IN/US', label: 'Number coverage' },
      { value: '100%',  label: 'Recordings stored' },
    ],
    accent: 'from-orange-500 to-amber-600',
  },
  {
    id: 'knowledge', icon: BookOpen, title: 'Knowledge Base',
    tagline: 'Upload your docs. Your agent reads them.',
    description: 'PDFs, web pages, CSVs — your agent answers grounded in your content with inline citations. No prompt engineering, no retraining, no vector-DB plumbing.',
    capabilities: [
      'PDF, DOCX, URL, CSV, plain-text ingestion',
      'Auto-chunked, embedded, and indexed',
      'Citation-backed answers in voice + chat',
      'Per-agent collections — share or isolate by tenant',
      'Real-time sync — re-ingest on document update',
      'Hybrid search (vector + keyword) under the hood',
    ],
    metrics: [
      { value: '5',      label: 'Source formats' },
      { value: '<2s',    label: 'Re-ingest' },
      { value: 'inline', label: 'Citations' },
    ],
    accent: 'from-emerald-500 to-teal-600',
  },
  {
    id: 'crm', icon: Users, title: 'Built-in CRM',
    tagline: 'Every conversation lands in CRM, scored and ready.',
    description: 'Built-in lead pipeline that gets every call’s sentiment, lead score, and next-best-action — with zero integration work. Bring your existing CRM later if you want.',
    capabilities: [
      'Auto-create lead per inbound or outbound call',
      'Kanban pipeline with custom stages',
      'Hot / warm / cold scoring from call sentiment',
      'Custom fields and tags per tenant',
      'Push to HubSpot, Zoho, Salesforce, Pipedrive',
      'Per-rep activity feed and follow-up reminders',
    ],
    metrics: [
      { value: 'auto',  label: 'Lead capture' },
      { value: '0',     label: 'Setup steps' },
      { value: '4+',    label: 'CRM exports' },
    ],
    accent: 'from-blue-500 to-indigo-600',
  },
  {
    id: 'analytics', icon: BarChart3, title: 'Analytics',
    tagline: 'Per-call AI analysis, team-level dashboards.',
    description: 'Sentiment, lead score, transcript, AI summary, and team-level performance — automatically computed and surfaced in dashboards out of the box.',
    capabilities: [
      'Per-call sentiment, summary, and follow-up actions',
      'Agent performance: handle time, conversion, QA score',
      'Conversion funnel from first call to closed lead',
      'Cost per call (LLM + voice + telephony combined)',
      'Recording playback with synced transcript',
      'Custom date ranges and CSV export',
    ],
    metrics: [
      { value: 'auto',   label: 'AI summary' },
      { value: '4+',     label: 'Dashboards' },
      { value: 'export', label: 'CSV ready' },
    ],
    accent: 'from-purple-500 to-fuchsia-600',
  },
  {
    id: 'voice-cloning', icon: Mic, title: 'Voice Cloning',
    tagline: 'Clone your brand voice in 30 seconds.',
    description: 'Upload a 30-second sample, get a custom voice your agent uses across every call. 50 free clones included with every account.',
    capabilities: [
      '30-second voice sample is enough',
      '50 free clones per tenant',
      'Streaming synthesis at <500ms',
      'Use the same voice across voice + chat (TTS)',
      'Multi-language cross-lingual cloning',
    ],
    metrics: [
      { value: '30s',  label: 'Sample needed' },
      { value: '50',   label: 'Free clones' },
      { value: '14+',  label: 'Languages' },
    ],
    accent: 'from-fuchsia-500 to-rose-500',
  },
  {
    id: 'workflows', icon: Workflow, title: 'Workflows',
    tagline: 'Multi-step automations beyond a single call.',
    description: 'Chain calls, SMS, email, and webhooks into automated flows — like "missed call → SMS → callback in 30 min". Visual builder, JSON-exportable.',
    capabilities: [
      'Visual node-based builder',
      'Triggers: call ended, lead created, time-based',
      'Actions: call, SMS, email, webhook, branch',
      'Per-tenant workflow library',
      'JSON-exportable definitions',
    ],
    metrics: [
      { value: '5+',    label: 'Trigger types' },
      { value: 'JSON',  label: 'Exportable' },
    ],
    accent: 'from-cyan-500 to-sky-600',
  },
  {
    id: 'campaigns', icon: Megaphone, title: 'Campaigns',
    tagline: 'Bulk outbound calling that actually scales.',
    description: 'Upload a CSV of phone numbers, pick an agent, hit start. Per-call status, retry policy, and live progress all built in.',
    capabilities: [
      'CSV upload — up to 100k rows',
      'Concurrency limits per tenant + provider',
      'Retry policy: backoff + max attempts',
      'Live progress + per-call status',
      'Pause / resume / cancel mid-campaign',
    ],
    metrics: [
      { value: '100k',  label: 'Rows per CSV' },
      { value: 'live',  label: 'Progress' },
    ],
    accent: 'from-amber-500 to-orange-600',
  },
  {
    id: 'api', icon: KeyRound, title: 'API & Webhooks',
    tagline: 'Programmatic access to every agent and call.',
    description: 'REST endpoints for every tenant resource — agents, calls, leads, knowledge — plus streaming webhooks for real-time call events.',
    capabilities: [
      'REST API for agents, calls, leads, knowledge',
      'Webhooks for ringing, answered, completed, summarized',
      'Per-tenant API keys with scoped permissions',
      'Streaming events over WebSocket',
      'OpenAPI spec + auto-generated SDKs',
    ],
    metrics: [
      { value: 'REST',  label: 'API style' },
      { value: 'WSS',   label: 'Streaming' },
    ],
    accent: 'from-slate-500 to-slate-700',
  },
];

const PRICING_TIERS = [
  {
    id: 'starter', name: 'Starter', price: '₹0', period: 'forever',
    tagline: 'For tinkering and side projects.',
    cta: 'Start free', highlight: false,
    features: [
      '1 voice agent · 1 chatbot',
      '60 free minutes / month',
      'English + Hindi + Telugu',
      'Web call widget',
      'Basic analytics',
      'Community support',
    ],
  },
  {
    id: 'growth', name: 'Growth', price: '₹2,499', period: '/month',
    tagline: 'For founders shipping their first agent.',
    cta: 'Start 14-day trial', highlight: true,
    features: [
      'Unlimited agents + chatbots',
      '500 minutes / month included',
      'All 14+ Indian languages',
      'Phone numbers + recordings',
      'Built-in CRM + lead scoring',
      'Knowledge base (10 GB)',
      'Email support',
    ],
  },
  {
    id: 'pro', name: 'Pro', price: '₹9,999', period: '/month',
    tagline: 'For teams running real call volume.',
    cta: 'Start 14-day trial', highlight: false,
    features: [
      'Everything in Growth',
      '2,500 minutes / month included',
      'Voice cloning (50 free)',
      'Workflows + bulk campaigns',
      'Advanced analytics + QA scoring',
      'Salesforce / Zoho / HubSpot push',
      'Webhooks + API access',
      'Priority support',
    ],
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 'Custom', period: '',
    tagline: 'For volume, SLAs, and on-prem.',
    cta: 'Contact sales', highlight: false,
    features: [
      'Everything in Pro',
      'Volume minute pricing',
      'SSO + RBAC + audit logs',
      'Custom AI models',
      'Dedicated success manager',
      'SLA + uptime guarantees',
      'On-prem / private cloud',
    ],
  },
];

const TESTIMONIALS = [
  {
    quote:    'We replaced our outbound calling team with a voice agent in two weeks. Same conversion, fraction of the cost.',
    name:     'Priya R.',
    role:     'Founder, Lendly',
    initials: 'PR',
    gradient: 'from-amber-500 to-rose-500',
  },
  {
    quote:    'The Telugu and Tamil support was the dealbreaker for us. Customers feel like they\'re talking to a local.',
    name:     'Karthik V.',
    role:     'Head of Ops, MetroCare',
    initials: 'KV',
    gradient: 'from-blue-500 to-indigo-600',
  },
  {
    quote:    'Connected to our CRM in five minutes. Lead scores started flowing the same day. Felt like cheating.',
    name:     'Anjali M.',
    role:     'GTM Lead, Brewx',
    initials: 'AM',
    gradient: 'from-emerald-500 to-teal-600',
  },
];
import { USE_CASE_TABS, AGENT_TEMPLATES, type UseCaseId } from '@/pages/agents/agentTemplates';
import { LandingHeader } from '@/components/landing/LandingHeader';

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Phone, Sparkles, Briefcase, CalendarPlus, Car, FileSignature, GraduationCap,
  Headphones, Home, Landmark, Monitor, Package, Receipt, Scissors, Shield,
  ShoppingCart, Stethoscope, Wifi, Wrench, Zap,
};

const STEPS = [
  { id: 1, label: 'System Prompt' },
  { id: 2, label: 'Language(s)' },
  { id: 3, label: 'Voice' },
];

export function LandingPage() {
  const navigate = useNavigate();
  const [systemPrompt, setSystemPrompt] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [guidedFlow, setGuidedFlow] = useState(true);
  const [activeUseCase, setActiveUseCase] = useState<UseCaseId | null>(null);

  const filteredTemplates = useMemo(
    () => (activeUseCase ? AGENT_TEMPLATES.filter((t) => t.use_case === activeUseCase) : []),
    [activeUseCase],
  );

  function pickTemplate(t: typeof AGENT_TEMPLATES[number]) {
    setSystemPrompt(t.prompt);
    setName(t.title);
    setDescription(t.short_description);
  }

  function handleCreate() {
    // Save what the user typed so we can restore it after signup.
    try {
      sessionStorage.setItem(
        'va-landing-prefill',
        JSON.stringify({ systemPrompt, name, description, activeUseCase, guidedFlow }),
      );
    } catch {}
    navigate('/register');
  }

  const canSubmit = systemPrompt.trim().length > 0 && name.trim().length > 0;

  return (
    <div className="min-h-screen bg-white">
      {/* Zoho-style two-row header */}
      <LandingHeader />

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-6 py-8 lg:py-10">
        <div className="text-center mb-5">
          <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
            Set Up Your <span className="bg-gradient-to-r from-amber-500 to-rose-500 bg-clip-text text-transparent">Voice AI</span> Assistant
          </h1>
          <p className="text-sm text-slate-500 mt-2">Describe what your agent should do — pick a use case below for a starter, or write your own.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  s.id === 1
                    ? 'bg-gradient-to-br from-amber-500 to-rose-500 text-white shadow-sm shadow-amber-500/20'
                    : 'bg-slate-200 text-slate-500'
                }`}>{s.id}</div>
                <span className={`text-xs font-medium hidden sm:inline ${s.id === 1 ? 'text-slate-900' : 'text-slate-500'}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div className="h-px w-8 sm:w-12 bg-slate-200" />}
            </div>
          ))}
        </div>

        {/* Main card */}
        <div className="rounded-3xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50 p-6 space-y-4">
          {/* Prompt textarea with animated gradient border */}
          <div>
            <div className="prompt-animated-border">
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="e.g., book an appointment for hospital"
                rows={5}
                className="w-full block px-4 py-3 rounded-xl border-0 bg-white font-mono text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 resize-y"
              />
            </div>
            <div className="flex items-center justify-between mt-2.5">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={guidedFlow}
                  onChange={(e) => setGuidedFlow(e.target.checked)}
                  className="accent-amber-600 h-3.5 w-3.5"
                />
                Guided Flow <span className="text-slate-400">(language + voice picker)</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-amber-200"
                >
                  <ListTree className="h-3.5 w-3.5" /> Generate Flow
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-amber-200"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Enhance Prompt
                </button>
              </div>
            </div>
          </div>

          {/* Use case chips */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Choose from use cases</p>
            <div className="flex flex-wrap gap-2">
              {USE_CASE_TABS.map((tab) => {
                const isActive = activeUseCase === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveUseCase(tab.id)}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors border ${
                      isActive
                        ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white border-transparent shadow-sm shadow-amber-500/20'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-amber-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Templates */}
          {activeUseCase && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">Choose from templates</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filteredTemplates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] || Sparkles;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTemplate(t)}
                      className="text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-amber-200 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-8 h-8 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-sm text-slate-900 truncate">{t.title}</h4>
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap">
                              {t.industry}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 line-clamp-2 leading-snug">{t.short_description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Agent name + description */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Agent Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Ava — Sales Qualifier"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description (optional)</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short note about this agent"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-200 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* CTA */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              No credit card required · ₹500 trial credit on signup
            </p>
            <button
              onClick={handleCreate}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl text-sm font-semibold bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Create Agent <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Already have an account? <Link to="/login" className="text-amber-700 hover:underline font-semibold">Sign in</Link>
        </p>
      </main>

      {/* ── Trust strip — language coverage ──────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold mb-3">
            Multilingual out of the box · 14+ Indian languages
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {LANGUAGE_BADGES.map((lang) => (
              <span
                key={lang}
                className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:border-amber-300 hover:text-amber-700 transition-colors"
              >
                {lang}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features — "Everything you need" ─────────────────────────── */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-10 lg:py-14 scroll-mt-24">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
            Everything you need
          </p>
          <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
            One platform. Voice, chat, and the data behind every conversation.
          </h2>
          <p className="text-sm text-slate-600 mt-3 max-w-2xl mx-auto leading-relaxed">
            Build an AI agent once, deploy it across phone, web widget, and WhatsApp.
            Every conversation is transcribed, scored, and synced to your CRM automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-slate-200 bg-white p-5 hover:border-amber-200 hover:shadow-lg hover:shadow-amber-500/5 hover:-translate-y-0.5 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-50 to-rose-50 flex items-center justify-center mb-3 group-hover:from-amber-500 group-hover:to-rose-500 transition-all">
                <f.icon className="h-5 w-5 text-amber-600 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1">{f.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works — 3 steps ───────────────────────────────────── */}
      <section className="bg-gradient-to-b from-slate-50 to-white border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-10 lg:py-14">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
              How it works
            </p>
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
              From prompt to phone call — in minutes.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HOW_STEPS.map((s, i) => (
              <div
                key={s.title}
                className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-rose-500 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-amber-500/20">
                    {i + 1}
                  </div>
                  <s.icon className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-1">{s.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases — "Built for every team" ───────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-10 lg:py-14">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
            Built for every team
          </p>
          <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
            From sales calls to support to bookings.
          </h2>
          <p className="text-sm text-slate-600 mt-3 max-w-2xl mx-auto leading-relaxed">
            Templates and workflows tuned for the conversations Indian teams actually have.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {USE_CASES.map((u) => (
            <div
              key={u.title}
              className="group rounded-2xl border border-slate-200 bg-white p-4 hover:border-amber-300 hover:shadow-md transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-50 group-hover:bg-gradient-to-br group-hover:from-amber-500 group-hover:to-rose-500 flex items-center justify-center mb-2 transition-all">
                <u.icon className="h-4.5 w-4.5 text-amber-600 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-0.5">{u.title}</h3>
              <p className="text-xs text-slate-500 leading-snug">{u.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats banner ─────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-amber-500 via-rose-500 to-rose-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 30%, white 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />
        <div className="relative max-w-7xl mx-auto px-6 py-10 lg:py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl lg:text-4xl font-bold tracking-tight">{s.value}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-amber-50 mt-1.5 font-semibold">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrations — "Bring your own stack" ────────────────────── */}
      <section id="integrations" className="max-w-7xl mx-auto px-6 py-10 lg:py-14 scroll-mt-24">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
            Bring your own stack
          </p>
          <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
            Works with the providers you already use.
          </h2>
          <p className="text-sm text-slate-600 mt-3 max-w-2xl mx-auto leading-relaxed">
            Plug in your own LLM, voice, and telephony — no vendor lock-in.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {INTEGRATIONS.map((i) => (
            <div
              key={i.name}
              className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 hover:border-amber-200 hover:shadow-sm hover:bg-amber-50/30 transition-all"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 bg-gradient-to-br ${i.gradient} shadow-sm`}>
                {i.initials}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{i.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{i.kind}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-500" /> SOC2-ready architecture</span>
          <span className="inline-flex items-center gap-1.5"><ZapIcon className="h-4 w-4 text-amber-500" /> 50ms streaming TTS</span>
          <span className="inline-flex items-center gap-1.5"><Globe2 className="h-4 w-4 text-rose-500" /> Hosted in India</span>
        </div>
      </section>

      {/* ── Product detail sections — anchored from header dropdown ──── */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 lg:py-14">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
              Products
            </p>
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
              Everything in one place. No hidden modules.
            </h2>
          </div>

          <div className="space-y-5">
            {PRODUCT_DETAILS.map((p, idx) => (
              <div
                key={p.id}
                id={p.id}
                className="scroll-mt-20 grid grid-cols-1 lg:grid-cols-5 gap-5 items-start rounded-2xl border border-slate-200 bg-white p-5 lg:p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="lg:col-span-2">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.accent} text-white flex items-center justify-center shadow-md`}>
                      <p.icon className="h-5 w-5" />
                    </div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-semibold">
                      {String(idx + 1).padStart(2, '0')} · Product
                    </p>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 tracking-tight">{p.title}</h3>
                  <p className="text-sm text-amber-700 font-medium mt-0.5">{p.tagline}</p>
                  <p className="text-sm text-slate-600 leading-relaxed mt-2">{p.description}</p>

                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {p.metrics.map((m) => (
                      <div key={m.label} className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
                        <div className="text-sm font-bold text-slate-900">{m.value}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{m.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 mt-4">
                    <Link
                      to="/register"
                      className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-white bg-gradient-to-r ${p.accent} shadow-md hover:opacity-90 transition-opacity`}
                    >
                      Get started <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <Link
                      to="/contact"
                      className="text-xs font-medium text-slate-600 hover:text-amber-700 px-2 py-2"
                    >
                      Talk to us
                    </Link>
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-semibold mb-2.5">
                    What you get
                  </p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {p.capabilities.map((c) => (
                      <li key={c} className="flex items-start gap-2 text-sm text-slate-700 leading-snug">
                        <span className={`mt-0.5 w-4 h-4 rounded-full bg-gradient-to-br ${p.accent} text-white flex items-center justify-center shrink-0`}>
                          <Check className="h-2.5 w-2.5" />
                        </span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing — inline on landing page ─────────────────────────── */}
      <section id="pricing" className="bg-gradient-to-b from-slate-50 to-white border-y border-slate-100 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 py-10 lg:py-14">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
              Pricing
            </p>
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
              Simple, transparent pricing.
            </h2>
            <p className="text-sm text-slate-600 mt-3 max-w-2xl mx-auto leading-relaxed">
              Start free. Upgrade when you need more minutes — pay only for what you use.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.id}
                className={`relative rounded-2xl bg-white p-5 flex flex-col ${
                  tier.highlight
                    ? 'border-2 border-amber-400 shadow-xl shadow-amber-500/10 ring-4 ring-amber-100'
                    : 'border border-slate-200 shadow-sm hover:shadow-md transition-shadow'
                }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-rose-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                    Most Popular
                  </div>
                )}
                <h3 className="text-base font-bold text-slate-900">{tier.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug min-h-[28px]">{tier.tagline}</p>
                <div className="mt-3 mb-3">
                  <span className="text-2xl font-bold text-slate-900 tracking-tight">{tier.price}</span>
                  {tier.period && <span className="text-xs text-slate-500 ml-1">{tier.period}</span>}
                </div>
                <Link
                  to={tier.id === 'enterprise' ? '/contact' : '/register'}
                  className={`block text-center h-9 leading-9 rounded-lg text-xs font-semibold transition-all ${
                    tier.highlight
                      ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-md shadow-amber-500/25 hover:opacity-90'
                      : 'border border-slate-300 text-slate-800 hover:border-amber-400 hover:text-amber-700'
                  }`}
                >
                  {tier.cta}
                </Link>
                <ul className="mt-4 space-y-1.5 text-xs text-slate-700">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 leading-snug">
                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-slate-500 mt-6">
            All plans include GST-compliant invoicing · Cancel anytime · Pay-as-you-go for overage minutes
          </p>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────── */}
      <section id="testimonials" className="bg-slate-50 border-y border-slate-100 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 py-10 lg:py-14">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-2">
              Loved by founders
            </p>
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
              What teams are saying.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-1 mb-2">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed mb-4">“{t.quote}”</p>
                <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                  <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${t.gradient} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
                    {t.initials}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA banner ─────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-10 lg:py-14">
        <div className="relative rounded-3xl bg-gradient-to-br from-amber-500 via-rose-500 to-rose-600 p-8 lg:p-10 text-center text-white shadow-2xl shadow-rose-500/20 overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-amber-200/20 blur-3xl pointer-events-none" />

          <div className="relative">
            <Sparkles className="h-7 w-7 mx-auto mb-3 opacity-90" />
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">
              Ship your first voice agent today.
            </h2>
            <p className="text-sm lg:text-base text-amber-50 mt-2 max-w-xl mx-auto leading-relaxed">
              No credit card required · ₹500 trial credit · Set up in 5 minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 mt-5">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-rose-600 font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
              >
                Get started free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl border border-white/40 bg-white/10 backdrop-blur text-white font-semibold text-sm hover:bg-white/20 transition-all"
              >
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} VoiceAgent AI · Build voice and chat agents</p>
          <p>Need help? <Link to="/contact" className="text-amber-700 hover:underline">Contact us</Link></p>
        </div>
      </footer>
    </div>
  );
}
