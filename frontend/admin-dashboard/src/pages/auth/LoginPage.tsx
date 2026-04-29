import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Mic, Eye, EyeOff, ArrowRight, PhoneCall, MessageSquare,
  Bot, BarChart3, ShieldCheck, Sparkles,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const features = [
  { icon: Bot,         title: 'AI voice agents',     desc: 'Spin up an inbound or outbound agent in minutes — pick a template, customize the prompt, deploy.' },
  { icon: PhoneCall,   title: 'Real phone calls',    desc: 'Plivo, Twilio, Exotel — your numbers, your minutes, full call recording and AI analysis included.' },
  { icon: MessageSquare,title: 'Chatbots & widgets', desc: 'Embeddable text chatbot for any site. Same brain as your voice agent — lead capture, knowledge base, multi-language.' },
  { icon: BarChart3,   title: 'Built-in analytics',  desc: 'Per-call sentiment, lead score, transcript, and an AI-generated summary in every conversation log.' },
];

const trust = [
  'No credit card to start · 50 free voice clones',
  'Telugu / Hindi / English / Tamil / Kannada · multilingual out of the box',
  'Bring your own LLM — OpenAI, Gemini, Claude, Sarvam',
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    setError('');
    try {
      await login(data.email, data.password);
      navigate('/agents/new');
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Invalid email or password';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* ── Top nav ────────────────────────────────────────────────── */}
      <header className="border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center shadow-md shadow-amber-500/20">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">VoiceAgent AI</p>
              <p className="text-[10px] uppercase tracking-wider text-amber-600 font-medium">Build · Call · Convert</p>
            </div>
          </Link>
          <Link to="/super-admin/login" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
            Platform admin <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 pt-12 lg:pt-20 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left: pitch */}
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium mb-6">
            <Sparkles className="h-3.5 w-3.5" /> Welcome back · sign in to keep building
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight">
            Build, deploy and scale <span className="bg-gradient-to-r from-amber-500 to-rose-500 bg-clip-text text-transparent">AI voice agents</span> that close.
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
            Voice and chat assistants on the same platform. Deploy across phone, web, and WhatsApp — with full transcripts, AI analysis, and CRM out of the box.
          </p>

          {/* Trust strip */}
          <ul className="mt-7 space-y-2">
            {trust.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm text-slate-700">
                <ShieldCheck className="h-4 w-4 text-emerald-500" /> {t}
              </li>
            ))}
          </ul>

          {/* Feature grid */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((f) => (
              <div key={f.title} className="p-4 rounded-2xl border border-slate-200 hover:border-amber-200 hover:shadow-sm transition-all bg-white">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center mb-3">
                  <f.icon className="h-4 w-4 text-amber-600" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: login card */}
        <div className="lg:col-span-5 lg:sticky lg:top-12">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xl shadow-slate-200/50 p-8">
            <h2 className="text-xl font-bold text-slate-900">Sign in to your workspace</h2>
            <p className="text-sm text-slate-500 mt-1">Welcome back — pick up where you left off.</p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 animate-slide-down">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Work email</label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  {...register('email')}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 transition-colors"
                />
                {errors.email && <p className="text-xs text-rose-600 mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    {...register('password')}
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-rose-600 mt-1">{errors.password.message}</p>}
              </div>

              <div className="flex items-center justify-between text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-600">
                  <input type="checkbox" className="rounded border-slate-300 text-amber-600 focus:ring-amber-400" />
                  Remember me
                </label>
                <a href="#" className="text-amber-600 hover:text-amber-700 font-semibold">Forgot password?</a>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-semibold text-sm shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 transition-all"
              >
                {loading ? 'Signing in…' : (<>Continue to dashboard <ArrowRight className="h-4 w-4" /></>)}
              </button>
            </form>
          </div>

          <p className="text-xs text-center text-slate-400 mt-4">
            New to VoiceAgent AI? <Link to="/register" className="text-amber-700 font-semibold hover:underline">Create a free account →</Link>
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} VoiceAgent AI · Build voice and chat agents</p>
          <p>Need help? <a href="/contact" className="text-amber-700 hover:underline">Contact us</a></p>
        </div>
      </footer>
    </div>
  );
}
