import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { Mic, Eye, EyeOff } from 'lucide-react';

const registerSchema = z
  .object({
    companyName: z.string().min(2, 'Company name is required'),
    name: z.string().min(2, 'Name is required'),
    email: z.string().email('Please enter a valid email'),
    phone: z.string().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setLoading(true);
    setError('');
    try {
      await registerUser(data.companyName, data.name, data.email, data.password);
      // After signup, drop the new user into the agent-creation wizard so
      // they can build their first agent immediately.
      navigate('/agents/new');
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-2.5 mb-8">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center">
          <Mic className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-bold text-gray-900">VoiceAgent AI</span>
      </div>

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

        <Input
          label="Company Name"
          placeholder="Acme Inc."
          {...register('companyName')}
          error={errors.companyName?.message}
        />

        <Input
          label="Full Name"
          placeholder="John Doe"
          {...register('name')}
          error={errors.name?.message}
        />

        <Input
          label="Email address"
          type="email"
          placeholder="you@company.com"
          {...register('email')}
          error={errors.email?.message}
        />

        <Input
          label="Phone Number"
          type="tel"
          placeholder="+1 (555) 123-4567"
          {...register('phone')}
          error={errors.phone?.message}
        />

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
    </div>
  );
}
