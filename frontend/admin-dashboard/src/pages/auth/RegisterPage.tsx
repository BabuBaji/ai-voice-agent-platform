import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth.store';
import { Mic, Eye, EyeOff, Mail, ArrowLeft, ShieldCheck } from 'lucide-react';
import api from '@/services/api';

const registerSchema = z
  .object({
    companyName: z.string().min(2, 'Company name is required'),
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

export function RegisterPage() {
  const navigate = useNavigate();
  const setLogin = useAuthStore((s) => s.login);

  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // OTP step state
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string>('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({ resolver: zodResolver(registerSchema) });

  // Resend cooldown ticker
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
    } finally {
      setLoading(false);
    }
  }

  function setDigit(i: number, v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 1);
    setCode((cur) => {
      const next = [...cur];
      next[i] = cleaned;
      return next;
    });
    if (cleaned && i < 5) inputRefs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setCode(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function verifyOtp() {
    if (!pendingUserId) return;
    const otp = code.join('');
    if (otp.length !== 6) {
      setError('Please enter the full 6-digit code');
      return;
    }
    setLoading(true); setError(''); setInfo('');
    try {
      const res = await api.post('/auth/verify-otp', { user_id: pendingUserId, otp });
      const u = res.data.user;
      // Sign the user in via the existing auth store contract.
      setLogin(
        {
          id: u.id,
          email: u.email,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
          role: 'admin',
          tenantId: u.tenantId,
        },
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
    } finally {
      setLoading(false);
    }
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-fade-in">
      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-2.5 mb-8">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center">
          <Mic className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-bold text-gray-900">VoiceAgent AI</span>
      </div>

      {step === 'form' ? (
        <>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Create your account</h2>
            <p className="text-sm text-gray-500 mt-1">Start building voice agents for free</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700 animate-slide-down">
                {error}
              </div>
            )}

            <Input label="Company Name" placeholder="Acme Inc." {...register('companyName')} error={errors.companyName?.message} />
            <Input label="Full Name" placeholder="John Doe" {...register('name')} error={errors.name?.message} />
            <Input label="Email address" type="email" placeholder="you@company.com" {...register('email')} error={errors.email?.message} />
            <Input label="Phone Number" type="tel" placeholder="+1 (555) 123-4567" {...register('phone')} error={errors.phone?.message} />

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                {...register('password')}
                error={errors.password?.message}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[34px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <Input
              label="Confirm Password"
              type="password"
              placeholder="Re-enter your password"
              {...register('confirmPassword')}
              error={errors.confirmPassword?.message}
            />

            <Button type="submit" variant="gradient" className="w-full rounded-xl" size="lg" loading={loading}>
              Create Account
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-600 hover:text-primary-700 font-semibold">
              Log in
            </Link>
          </p>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-2">
            <button
              onClick={() => { setStep('form'); setError(''); setInfo(''); }}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 -ml-1"
              title="Edit details"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-50 to-accent-50 flex items-center justify-center text-primary-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Verify your email</h2>
              <p className="text-sm text-gray-500 mt-1">
                <Mail className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" />
                We sent a 6-digit code to <span className="font-medium text-gray-700">{pendingEmail}</span>
              </p>
            </div>
          </div>

          <div className="mt-7 space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700 animate-slide-down">
                {error}
              </div>
            )}
            {info && !error && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
                {info}
              </div>
            )}

            {devOtp && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <strong>DEV mode:</strong> your OTP is <code className="font-mono font-bold">{devOtp}</code>{' '}
                (real email delivery activates when you wire SMTP credentials).
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">Enter the 6-digit code</label>
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
                    className="w-12 h-14 text-center text-xl font-mono font-bold rounded-xl border border-gray-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
                  />
                ))}
              </div>
            </div>

            <Button
              variant="gradient"
              className="w-full rounded-xl"
              size="lg"
              onClick={verifyOtp}
              loading={loading}
              disabled={code.join('').length !== 6 || loading}
            >
              Verify & continue
            </Button>

            <div className="text-center text-sm text-gray-500">
              Didn't get a code?{' '}
              <button
                onClick={resendOtp}
                disabled={resendCooldown > 0 || loading}
                className="text-primary-600 hover:text-primary-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
