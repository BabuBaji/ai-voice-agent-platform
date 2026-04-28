import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mic, Phone, Sparkles, ListTree, Wand2, ArrowRight,
  Briefcase, CalendarPlus, Car, FileSignature, GraduationCap, Headphones, Home,
  Landmark, Monitor, Package, Receipt, Scissors, Shield, ShoppingCart, Stethoscope,
  Wifi, Wrench, Zap,
  Bot, MessageSquare, BookOpen, Users, BarChart3, PhoneCall, PenLine, Globe2,
  Rocket, Star, ShieldCheck, Zap as ZapIcon,
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
      <main className="max-w-5xl mx-auto px-6 py-10 lg:py-14">
        <div className="text-center mb-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
            Set Up Your <span className="bg-gradient-to-r from-amber-500 to-rose-500 bg-clip-text text-transparent">Voice AI</span> Assistant
          </h1>
          <p className="text-sm text-slate-500 mt-2">Describe what your agent should do — pick a use case below for a starter, or write your own.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
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
        <div className="rounded-3xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50 p-8 space-y-5">
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

        <p className="text-center text-xs text-slate-400 mt-6">
          Already have an account? <Link to="/login" className="text-amber-700 hover:underline font-semibold">Sign in</Link>
        </p>
      </main>

      {/* ── Trust strip — language coverage ──────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold mb-5">
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
      <section id="features" className="max-w-7xl mx-auto px-6 py-16 lg:py-24 scroll-mt-32">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-3">
            Everything you need
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
            One platform. Voice, chat, and the data behind every conversation.
          </h2>
          <p className="text-base text-slate-600 mt-4 max-w-2xl mx-auto leading-relaxed">
            Build an AI agent once, deploy it across phone, web widget, and WhatsApp.
            Every conversation is transcribed, scored, and synced to your CRM automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-slate-200 bg-white p-6 hover:border-amber-200 hover:shadow-lg hover:shadow-amber-500/5 hover:-translate-y-0.5 transition-all"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-50 to-rose-50 flex items-center justify-center mb-4 group-hover:from-amber-500 group-hover:to-rose-500 transition-all">
                <f.icon className="h-5 w-5 text-amber-600 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works — 3 steps ───────────────────────────────────── */}
      <section className="bg-gradient-to-b from-slate-50 to-white border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-16 lg:py-24">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-3">
              How it works
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
              From prompt to phone call — in minutes.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_STEPS.map((s, i) => (
              <div
                key={s.title}
                className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-rose-500 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-amber-500/20">
                    {i + 1}
                  </div>
                  <s.icon className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-1.5">{s.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases — "Built for every team" ───────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-3">
            Built for every team
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
            From sales calls to support to bookings.
          </h2>
          <p className="text-base text-slate-600 mt-4 max-w-2xl mx-auto leading-relaxed">
            Templates and workflows tuned for the conversations Indian teams actually have.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {USE_CASES.map((u) => (
            <div
              key={u.title}
              className="group rounded-2xl border border-slate-200 bg-white p-5 hover:border-amber-300 hover:shadow-md transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-50 group-hover:bg-gradient-to-br group-hover:from-amber-500 group-hover:to-rose-500 flex items-center justify-center mb-3 transition-all">
                <u.icon className="h-5 w-5 text-amber-600 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1">{u.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{u.desc}</p>
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
        <div className="relative max-w-7xl mx-auto px-6 py-14 lg:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl lg:text-5xl font-bold tracking-tight">{s.value}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-amber-50 mt-2 font-semibold">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrations — "Bring your own stack" ────────────────────── */}
      <section id="integrations" className="max-w-7xl mx-auto px-6 py-16 lg:py-24 scroll-mt-32">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-3">
            Bring your own stack
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight max-w-2xl mx-auto">
            Works with the providers you already use.
          </h2>
          <p className="text-base text-slate-600 mt-4 max-w-2xl mx-auto leading-relaxed">
            Plug in your own LLM, voice, and telephony — no vendor lock-in.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {INTEGRATIONS.map((i) => (
            <div
              key={i.name}
              className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3 hover:border-amber-200 hover:shadow-sm hover:bg-amber-50/30 transition-all"
            >
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 bg-gradient-to-br ${i.gradient} shadow-sm`}>
                {i.initials}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{i.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{i.kind}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-500" /> SOC2-ready architecture</span>
          <span className="inline-flex items-center gap-1.5"><ZapIcon className="h-4 w-4 text-amber-500" /> 50ms streaming TTS</span>
          <span className="inline-flex items-center gap-1.5"><Globe2 className="h-4 w-4 text-rose-500" /> Hosted in India</span>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────── */}
      <section id="testimonials" className="bg-slate-50 border-y border-slate-100 scroll-mt-32">
        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 mb-3">
              Loved by founders
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
              What teams are saying.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-1 mb-3">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed mb-5">“{t.quote}”</p>
                <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${t.gradient} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
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
      <section className="max-w-5xl mx-auto px-6 py-16 lg:py-24">
        <div className="relative rounded-3xl bg-gradient-to-br from-amber-500 via-rose-500 to-rose-600 p-10 lg:p-14 text-center text-white shadow-2xl shadow-rose-500/20 overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-amber-200/20 blur-3xl pointer-events-none" />

          <div className="relative">
            <Sparkles className="h-8 w-8 mx-auto mb-4 opacity-90" />
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">
              Ship your first voice agent today.
            </h2>
            <p className="text-base lg:text-lg text-amber-50 mt-4 max-w-xl mx-auto leading-relaxed">
              No credit card required · ₹500 trial credit · Set up in 5 minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-white text-rose-600 font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
              >
                Get started free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-white/40 bg-white/10 backdrop-blur text-white font-semibold text-sm hover:bg-white/20 transition-all"
              >
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} VoiceAgent AI · Build voice and chat agents</p>
          <p>Need help? <Link to="/contact" className="text-amber-700 hover:underline">Contact us</Link></p>
        </div>
      </footer>
    </div>
  );
}
