import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Mic, Eye, EyeOff, ArrowRight, ArrowLeft, Mail, ShieldCheck,
  PhoneCall, MessageSquare, Bot, BarChart3, Sparkles, CheckCircle2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import api from '@/services/api';

const COMPANY_SIZE_OPTIONS = [
  { value: '', label: 'Prefer not to say' },
  { value: '1-10', label: '1–10 employees' },
  { value: '11-50', label: '11–50 employees' },
  { value: '51-200', label: '51–200 employees' },
  { value: '201-500', label: '201–500 employees' },
  { value: '501-1000', label: '501–1,000 employees' },
  { value: '1000+', label: '1,000+ employees' },
] as const;

const registerSchema = z
  .object({
    companyName: z.string().min(2, 'Company name is required'),
    companySize: z.string().optional(),
    name: z.string().min(2, 'Name is required'),
    email: z.string().email('Please enter a valid email'),
    phone: z.string().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormData = z.infer<typeof registerSchema>;
type Step = 'form' | 'otp';

const features = [
  { icon: Bot,         title: 'AI voice agents',     desc: 'Build inbound and outbound agents in minutes — pick a template, deploy live.' },
  { icon: PhoneCall,   title: 'Real phone calls',    desc: 'Plivo, Twilio, Exotel — your numbers, full call recording and AI analysis included.' },
  { icon: MessageSquare,title: 'Chatbots & widgets', desc: 'Embeddable text chatbot for any site. Same brain as voice — lead capture, knowledge base.' },
  { icon: BarChart3,   title: 'Built-in analytics',  desc: 'Sentiment, lead score, transcript, and AI summary on every conversation.' },
];

const trust = [
  '50 free voice clones — no credit card',
  'Multilingual: English / Hindi / Telugu / Tamil / Kannada',
  'Bring your own LLM keys (OpenAI, Gemini, Claude, Sarvam)',
];

export function RegisterPage() {
  const navigate = useNavigate();
  const setLogin = useAuthStore((s) => s.login);

  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // OTP step
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string>('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { register, handleSubmit, watch, formState: { errors } } =
    useForm<RegisterFormData>({ resolver: zodResolver(registerSchema) });

  const phoneValue = watch('phone') || '';
  const phoneIsValid = /^\+?[1-9]\d{9,14}$/.test(phoneValue.replace(/[\s\-()]/g, ''));

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  async function onSubmit(data: RegisterFormData) {
    setLoading(true); setError(''); setInfo('');
    try {
      const parts = data.name.trim().split(/\s+/);
      const firstName = parts[0] || data.name;
      const lastName = parts.slice(1).join(' ') || '';
      const res = await api.post('/auth/register-otp', {
        tenantName: data.companyName,
        firstName,
        lastName,
        email: data.email,
        password: data.password,
        ...(data.companySize ? { companySize: data.companySize } : {}),
      });
      setPendingUserId(res.data.user_id);
      setPendingEmail(res.data.email);
      setDevOtp(res.data.dev_otp || null);
      setStep('otp');
      setResendCooldown(30);
      setInfo(`We sent a 6-digit code to ${res.data.email}`);
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Registration failed');
    } finally { setLoading(false); }
  }

  function setDigit(i: number, v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 1);
    setCode((cur) => { const next = [...cur]; next[i] = cleaned; return next; });
    if (cleaned && i < 5) inputRefs.current[i + 1]?.focus();
  }
  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) inputRefs.current[i - 1]?.focus();
  }
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted.length) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setCode(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function verifyOtp() {
    if (!pendingUserId) return;
    const otp = code.join('');
    if (otp.length !== 6) { setError('Please enter the full 6-digit code'); return; }
    setLoading(true); setError(''); setInfo('');
    try {
      const res = await api.post('/auth/verify-otp', { user_id: pendingUserId, otp });
      const u = res.data.user;
      setLogin(
        { id: u.id, email: u.email, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email, role: 'admin', tenantId: u.tenantId },
        res.data.accessToken,
        res.data.refreshToken,
      );
      navigate('/agents/new');
    } catch (err: any) {
      const reason = err?.response?.data?.reason;
      const msg = reason === 'expired' ? 'That code has expired — request a new one.'
        : reason === 'too_many_attempts' ? 'Too many wrong attempts — request a new code.'
        : reason === 'invalid' ? 'That code is incorrect.'
        : reason === 'no_pending' ? 'No pending verification — please sign up again.'
        : err?.response?.data?.error || err?.message || 'Verification failed';
      setError(msg);
    } finally { setLoading(false); }
  }

  async function resendOtp() {
    if (!pendingUserId || resendCooldown > 0) return;
    setLoading(true); setError(''); setInfo('');
    try {
      const res = await api.post('/auth/resend-otp', { user_id: pendingUserId });
      setDevOtp(res.data.dev_otp || null);
      setCode(['', '', '', '', '', '']);
      setInfo('A new code has been sent.');
      setResendCooldown(30);
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Resend failed');
    } finally { setLoading(false); }
  }

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
          <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
            Already have an account? <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 pt-12 lg:pt-20 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left: pitch */}
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium mb-6">
            <Sparkles className="h-3.5 w-3.5" /> Free to start · no card required
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight">
            Start building your <span className="bg-gradient-to-r from-amber-500 to-rose-500 bg-clip-text text-transparent">AI voice agent</span> in minutes.
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
            Voice + chat agents on one platform. Phone calls, web widgets, WhatsApp, CRM, transcripts, AI analysis — everything you need to launch.
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

        {/* Right: signup card */}
        <div className="lg:col-span-5 lg:sticky lg:top-12">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xl shadow-slate-200/50 p-8">
            {step === 'form' ? (
              <>
                <h2 className="text-xl font-bold text-slate-900">Create your account</h2>
                <p className="text-sm text-slate-500 mt-1">Start with a free workspace — upgrade anytime.</p>

                <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                  {error && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 animate-slide-down">{error}</div>
                  )}

                  <Field label="Company name" error={errors.companyName?.message}>
                    <input placeholder="Acme Inc." {...register('companyName')} className={inputCls} />
                    <p className="text-[11px] text-slate-400 mt-1">Multiple employees from the same company can register — names don't need to be unique.</p>
                  </Field>
                  <Field label="Company size (optional)" error={errors.companySize?.message}>
                    <select {...register('companySize')} className={inputCls} defaultValue="">
                      {COMPANY_SIZE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Full name" error={errors.name?.message}>
                    <input placeholder="John Doe" {...register('name')} className={inputCls} />
                  </Field>
                  <Field label="Work email" error={errors.email?.message}>
                    <input type="email" placeholder="you@company.com" {...register('email')} className={inputCls} />
                  </Field>
                  <Field label="Phone (optional)" error={errors.phone?.message}>
                    <div className="relative">
                      <input
                        type="tel"
                        placeholder="+91 91234 56789"
                        {...register('phone')}
                        className={`${inputCls} ${phoneIsValid ? 'pr-10 border-emerald-300 focus:border-emerald-400 focus:ring-emerald-100' : ''}`}
                      />
                      {phoneIsValid && (
                        <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                  </Field>
                  <Field label="Password" error={errors.password?.message}>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Min. 8 characters"
                        {...register('password')}
                        className={`${inputCls} pr-10`}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                  <Field label="Confirm password" error={errors.confirmPassword?.message}>
                    <input type="password" placeholder="Re-enter your password" {...register('confirmPassword')} className={inputCls} />
                  </Field>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-semibold text-sm shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 transition-all"
                  >
                    {loading ? 'Creating account…' : (<>Create account <ArrowRight className="h-4 w-4" /></>)}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => { setStep('form'); setError(''); setInfo(''); }}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 -ml-1 mt-1"
                    title="Edit details"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-50 to-rose-50 flex items-center justify-center text-amber-600 flex-shrink-0">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-slate-900">Verify your email</h2>
                    <p className="text-sm text-slate-500 mt-1 truncate">
                      <Mail className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" />
                      Code sent to <span className="font-medium text-slate-700">{pendingEmail}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
                  {info && !error && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{info}</div>}
                  {devOtp && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      <strong>DEV mode:</strong> your OTP is <code className="font-mono font-bold">{devOtp}</code>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Enter the 6-digit code</label>
                    <div className="flex justify-center gap-2">
                      {code.map((d, i) => (
                        <input
                          key={i}
                          ref={(el) => { inputRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={d}
                          onChange={(e) => setDigit(i, e.target.value)}
                          onKeyDown={(e) => onKeyDown(i, e)}
                          onPaste={onPaste}
                          autoFocus={i === 0}
                          className="w-11 h-13 text-center text-xl font-mono font-bold rounded-xl border border-slate-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={verifyOtp}
                    disabled={code.join('').length !== 6 || loading}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-semibold text-sm shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 transition-all"
                  >
                    {loading ? 'Verifying…' : (<>Verify & continue <ArrowRight className="h-4 w-4" /></>)}
                  </button>

                  <div className="text-center text-sm text-slate-500">
                    Didn't get a code?{' '}
                    <button
                      onClick={resendOtp}
                      disabled={resendCooldown > 0 || loading}
                      className="text-amber-700 hover:underline font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {step === 'form' && (
            <p className="text-xs text-center text-slate-400 mt-4">
              Already have an account? <Link to="/login" className="text-amber-700 font-semibold hover:underline">Sign in →</Link>
            </p>
          )}
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

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 transition-colors';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
