import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mic, Phone, Sparkles, ListTree, Wand2, ArrowRight,
  Briefcase, CalendarPlus, Car, FileSignature, GraduationCap, Headphones, Home,
  Landmark, Monitor, Package, Receipt, Scissors, Shield, ShoppingCart, Stethoscope,
  Wifi, Wrench, Zap,
} from 'lucide-react';
import { USE_CASE_TABS, AGENT_TEMPLATES, type UseCaseId } from '@/pages/agents/agentTemplates';

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
    if (!name) setName(t.title);
    if (!description) setDescription(t.short_description);
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
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Top nav */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center shadow-sm">
              <Mic className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-gray-900 tracking-tight">VoiceAgent AI</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="h-9 px-3.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 inline-flex items-center"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="h-9 px-4 rounded-lg text-sm font-semibold bg-gradient-to-br from-primary-600 to-accent-600 text-white shadow-sm hover:opacity-90 inline-flex items-center gap-1.5"
            >
              Sign up <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-4 lg:px-6 py-10 lg:py-14">
        <div className="text-center mb-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 tracking-tight">
            Set Up Your <span className="text-teal-500">Voice AI</span> Assistant
          </h1>
          <p className="text-sm text-gray-500 mt-2">Describe what your agent should do — pick a use case below for a starter, or write your own.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  s.id === 1 ? 'bg-teal-500 text-white' : 'bg-gray-200 text-gray-500'
                }`}>{s.id}</div>
                <span className={`text-xs font-medium hidden sm:inline ${s.id === 1 ? 'text-gray-900' : 'text-gray-500'}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div className="h-px w-8 sm:w-12 bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* Main card */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-6 space-y-5">
          {/* Prompt textarea */}
          <div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g., book an appointment for hospital"
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white font-mono text-sm leading-relaxed placeholder:text-gray-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-100 focus:outline-none resize-y"
            />
            <div className="flex items-center justify-between mt-2.5">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={guidedFlow}
                  onChange={(e) => setGuidedFlow(e.target.checked)}
                  className="accent-teal-600 h-3.5 w-3.5"
                />
                Guided Flow <span className="text-gray-400">(language + voice picker)</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <ListTree className="h-3.5 w-3.5" /> Generate Flow
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Enhance Prompt
                </button>
              </div>
            </div>
          </div>

          {/* Use case chips */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Choose from use cases</p>
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
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
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
              <p className="text-xs font-medium text-gray-500 mb-2">Choose from templates</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filteredTemplates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] || Sparkles;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTemplate(t)}
                      className="text-left rounded-lg border border-gray-200 bg-white p-3 hover:border-teal-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-8 h-8 rounded-md bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-sm text-gray-900 truncate">{t.title}</h4>
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 whitespace-nowrap">
                              {t.industry}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 line-clamp-2 leading-snug">{t.short_description}</p>
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
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Agent Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Ava — Sales Qualifier"
                className="w-full h-10 px-3.5 rounded-lg border border-gray-200 text-sm placeholder:text-gray-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-100 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Description (optional)</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short note about this agent"
                className="w-full h-10 px-3.5 rounded-lg border border-gray-200 text-sm placeholder:text-gray-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-100 focus:outline-none"
              />
            </div>
          </div>

          {/* CTA */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              No credit card required · ₹500 trial credit on signup
            </p>
            <button
              onClick={handleCreate}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl text-sm font-semibold bg-gradient-to-br from-primary-600 to-accent-600 text-white shadow-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Agent <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Already have an account? <Link to="/login" className="text-primary-600 hover:underline font-medium">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
