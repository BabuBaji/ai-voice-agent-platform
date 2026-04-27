import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import {
  Shield, Eye, EyeOff, ArrowRight, BarChart3, Building2,
  Activity, Wallet, ShieldCheck, Lock, CheckCircle2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth.store';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const features = [
  { icon: Building2,  title: 'Tenant management', desc: 'Suspend, impersonate, and adjust wallets across every customer account.' },
  { icon: Activity,   title: 'Live activity feed', desc: 'Every login, call, and wallet move across the platform in one timeline.' },
  { icon: BarChart3,  title: 'Cross-tenant analytics', desc: 'Drill from a global stat into the exact day, tenant, or agent behind it.' },
  { icon: Wallet,     title: 'Billing & wallet control', desc: 'Audit-tracked credits, debits, and subscription oversight in one click.' },
];

const trust = [
  { icon: ShieldCheck, label: 'All actions audited' },
  { icon: Lock,        label: 'Platform-admin RBAC' },
  { icon: CheckCircle2,label: 'Zero blast radius — read-mostly by default' },
];

export function SuperAdminLoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  if (isAuthed && user?.isPlatformAdmin) {
    return <Navigate to="/super-admin" replace />;
  }

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    setError('');
    try {
      const u = await login(data.email, data.password);
      if (!u?.isPlatformAdmin) {
        logout();
        setError('This account is not a platform admin. Use /login for tenant access.');
        return;
      }
      navigate('/super-admin', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* ── Top nav ────────────────────────────────────────────────── */}
      <header className="border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center shadow-md shadow-amber-500/20">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Platform Admin</p>
              <p className="text-[10px] uppercase tracking-wider text-amber-600 font-medium">VoiceAgent AI</p>
            </div>
          </div>
          <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
            Tenant login <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 pt-12 lg:pt-20 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left: pitch */}
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium mb-6">
            <ShieldCheck className="h-3.5 w-3.5" /> Restricted access · super admins only
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight">
            Run your <span className="bg-gradient-to-r from-amber-500 to-rose-500 bg-clip-text text-transparent">AI Voice Agent</span> platform.
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
            The platform-admin console. Real-time visibility, drill-down analytics, and audited control across every tenant in one place.
          </p>

          {/* Trust strip */}
          <ul className="mt-7 space-y-2">
            {trust.map((t) => (
              <li key={t.label} className="flex items-center gap-2 text-sm text-slate-700">
                <t.icon className="h-4 w-4 text-emerald-500" /> {t.label}
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
            <h2 className="text-xl font-bold text-slate-900">Sign in to admin</h2>
            <p className="text-sm text-slate-500 mt-1">Use your platform-admin credentials</p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 animate-slide-down">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Admin email</label>
                <input
                  type="email"
                  placeholder="info@smartgrowinfotech.com"
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

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-semibold text-sm shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 transition-all"
              >
                {loading ? 'Signing in…' : (<>Access platform <ArrowRight className="h-4 w-4" /></>)}
              </button>

              <p className="text-[11px] text-slate-500 text-center pt-2">
                Every action you take here is recorded in the platform audit log.
              </p>
            </form>
          </div>

          <p className="text-xs text-center text-slate-400 mt-4">
            Not a platform admin? <Link to="/login" className="text-amber-700 hover:underline">Open tenant login →</Link>
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} VoiceAgent AI · Platform admin console</p>
          <p>Authorized personnel only.</p>
        </div>
      </footer>
    </div>
  );
}
