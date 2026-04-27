import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, CreditCard, Lock, CheckCircle2, Loader2, AlertCircle, Mic,
} from 'lucide-react';
import { billingApi, type Plan } from '@/services/billing.api';
import { useAuthStore } from '@/stores/auth.store';
import { useToast } from '@/components/ui/Toast';
import { useFeatures } from '@/stores/features.context';

// Stripe-style two-column subscribe page. Left = order summary, right = card form.
// On submit we POST /billing/checkout which: charges the card via the payment
// provider (mock in dev — always succeeds), credits the wallet, debits for the
// plan, saves the card, and switches the subscription — all in one round-trip.
// On success we redirect to /settings/billing with a toast.

const COUNTRIES = [
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
];

// Mock USD/INR rate for the currency toggle. Real implementation would hit a
// rates API on plan-selection time and lock in the exchange.
const USD_PER_INR = 1 / 83;
const INR_TO_USD_FEE_PCT = 4;

export function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const planId = params.get('plan');
  const user = useAuthStore((s) => s.user);
  const { refresh: refreshFeatures } = useFeatures();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');

  // Card form state — explicit, simple controlled inputs
  const [card, setCard] = useState({
    number: '', exp: '', cvc: '', name: '', country: 'IN', email: user?.email || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!planId) { setError('No plan selected'); setLoading(false); return; }
    billingApi.getPlans()
      .then((plans) => {
        const p = plans.find((x) => x.id === planId);
        if (!p) { setError('Plan not found'); return; }
        if (p.custom) { setError('Enterprise plans require a sales quote — please contact sales.'); return; }
        if (p.price <= 0) { navigate('/settings/billing'); return; }
        setPlan(p);
      })
      .finally(() => setLoading(false));
  }, [planId, navigate]);

  const total = useMemo(() => {
    if (!plan) return { display: 0, raw: 0, suffix: '' };
    if (currency === 'INR') return { display: plan.price, raw: plan.price, suffix: '₹' };
    const raw = plan.price * USD_PER_INR * (1 + INR_TO_USD_FEE_PCT / 100);
    return { display: +raw.toFixed(2), raw, suffix: '$' };
  }, [plan, currency]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const num = card.number.replace(/\s+/g, '');
    if (!/^\d{12,19}$/.test(num)) e.number = 'Enter a valid card number';
    const expMatch = /^(\d{2})\s*\/\s*(\d{2,4})$/.exec(card.exp);
    if (!expMatch) e.exp = 'MM / YY';
    else {
      const mm = parseInt(expMatch[1]); const yy = parseInt(expMatch[2]);
      if (mm < 1 || mm > 12) e.exp = 'Invalid month';
      const fullYear = yy < 100 ? 2000 + yy : yy;
      const now = new Date();
      const cardEnd = new Date(fullYear, mm, 0, 23, 59, 59);
      if (cardEnd < now) e.exp = 'Card has expired';
    }
    if (!/^\d{3,4}$/.test(card.cvc)) e.cvc = '3 or 4 digits';
    if (!card.name.trim()) e.name = 'Required';
    if (!/^\S+@\S+\.\S+$/.test(card.email)) e.email = 'Enter a valid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!plan) return;
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const expMatch = /^(\d{2})\s*\/\s*(\d{2,4})$/.exec(card.exp)!;
      const mm = parseInt(expMatch[1]);
      const yy = parseInt(expMatch[2]);
      const fullYear = yy < 100 ? 2000 + yy : yy;

      const result = await billingApi.checkout({
        plan_id: plan.id,
        card: {
          number: card.number.replace(/\s+/g, ''),
          exp_month: mm,
          exp_year: fullYear,
          cvc: card.cvc,
          name: card.name.trim(),
        },
        country: card.country,
        email: card.email.trim(),
        save_card: true,
      });

      // Refresh feature flags BEFORE navigating so the destination page renders
      // with the new plan's capabilities already unlocked. Don't block the
      // success message on it — features fetch is fast but failure is fine.
      refreshFeatures().catch(() => {});

      toast.addToast(
        `Subscribed to ${result.subscription.plan_name} — features active immediately. Charge ref: ${result.charge.ref.slice(0, 16)}…`,
        'success',
      );
      navigate('/settings/billing', { replace: true });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.reason || err?.response?.data?.error || 'Payment failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>;
  if (error && !plan) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
        <p className="text-sm text-slate-700">{error}</p>
        <Link to="/settings/pricing" className="inline-flex text-sm text-primary-600 hover:underline">← Back to pricing</Link>
      </div>
    );
  }
  if (!plan) return null;

  return (
    <div className="min-h-screen bg-white">
      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen">

        {/* ── Left pane: order summary ─────────────────────────────── */}
        <div className="px-8 lg:px-16 py-10 lg:border-r border-slate-100">
          <button onClick={() => navigate('/settings/pricing')}
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8">
            <ArrowLeft className="h-4 w-4" />
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center shadow">
              <Mic className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-900">VoiceAgent AI</span>
          </button>

          <p className="text-sm text-slate-600 mb-2">Subscribe to {plan.name}</p>
          <h1 className="text-5xl font-bold text-slate-900 leading-none">
            {currency === 'INR' ? '₹' : '$'}{total.display.toLocaleString()}
            <span className="text-sm font-normal text-slate-500 ml-2 align-middle">due today</span>
          </h1>
          <p className="text-sm text-slate-600 mt-3">
            Then starting at <span className="font-semibold text-slate-900">{currency === 'INR' ? '₹' : '$'}{total.display.toLocaleString()}</span> per month
          </p>

          {/* Currency toggle */}
          <div className="mt-7 grid grid-cols-2 gap-3 max-w-sm">
            <button onClick={() => setCurrency('INR')}
              className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${currency === 'INR' ? 'border-slate-900 bg-white text-slate-900 shadow-sm' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              🇮🇳 INR
            </button>
            <button onClick={() => setCurrency('USD')}
              className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${currency === 'USD' ? 'border-slate-900 bg-white text-slate-900 shadow-sm' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              🇺🇸 USD
            </button>
          </div>
          {currency === 'USD' && (
            <p className="text-xs text-slate-500 mt-3 max-w-sm">
              1 USD = ₹{(1 / USD_PER_INR).toFixed(4)} INR <span className="underline">(includes {INR_TO_USD_FEE_PCT}% conversion fee)</span>. Charges may vary based on exchange rates.
            </p>
          )}

          {/* Line items */}
          <div className="mt-10 max-w-md space-y-5">
            <div className="flex justify-between items-start pb-5 border-b border-slate-100">
              <div>
                <p className="text-sm font-semibold text-slate-900">{plan.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">Billed monthly</p>
              </div>
              <p className="text-sm font-medium text-slate-900">{currency === 'INR' ? '₹' : '$'}{total.display.toLocaleString()}</p>
            </div>
            <div className="flex justify-between items-start pb-5 border-b border-slate-100">
              <div>
                <p className="text-sm font-semibold text-slate-900">{plan.name} usage</p>
                <p className="text-xs text-slate-500 mt-0.5">Billed monthly based on usage beyond {plan.features.included_minutes} included min</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">Price varies</p>
                <p className="text-xs text-slate-500 mt-0.5">{currency === 'INR' ? '₹' : '$'}{currency === 'INR' ? plan.features.extra_per_min : (plan.features.extra_per_min * USD_PER_INR * 1.04).toFixed(2)} per minute</p>
              </div>
            </div>
            <div className="flex justify-between items-center pb-3">
              <p className="text-sm text-slate-600">Subtotal</p>
              <p className="text-sm font-medium text-slate-900">{currency === 'INR' ? '₹' : '$'}{total.display.toLocaleString()}</p>
            </div>
            <div className="flex justify-between items-center pt-3 border-t-2 border-slate-200">
              <p className="text-base font-semibold text-slate-900">Total due today</p>
              <p className="text-base font-bold text-slate-900">{currency === 'INR' ? '₹' : '$'}{total.display.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* ── Right pane: contact + card form ──────────────────────── */}
        <div className="px-8 lg:px-16 py-10 bg-slate-50/30">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Contact information</h2>
          <div className="bg-white rounded-xl p-4 border border-slate-200 mb-8">
            <label className="block text-xs text-slate-500 mb-1">Email</label>
            <input value={card.email} onChange={(e) => setCard((c) => ({ ...c, email: e.target.value }))}
              className="w-full text-sm text-slate-900 outline-none bg-transparent" />
            {errors.email && <p className="text-xs text-rose-600 mt-1">{errors.email}</p>}
          </div>

          <h2 className="text-lg font-semibold text-slate-900 mb-4">Payment method</h2>
          <div className="border border-slate-200 rounded-xl bg-white">
            {/* Card tab */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-700" />
              <span className="text-sm font-medium text-slate-900">Card</span>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Card information</label>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="relative">
                    <input
                      value={card.number}
                      onChange={(e) => setCard((c) => ({ ...c, number: formatCardNumber(e.target.value) }))}
                      placeholder="1234 1234 1234 1234"
                      maxLength={23}
                      className="w-full px-3 py-2.5 text-sm font-mono outline-none border-b border-slate-200"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1 text-[8px] font-bold pointer-events-none">
                      <span className="px-1 py-0.5 bg-blue-600 text-white rounded">VISA</span>
                      <span className="px-1 py-0.5 bg-orange-500 text-white rounded">MC</span>
                      <span className="px-1 py-0.5 bg-cyan-700 text-white rounded">AMEX</span>
                      <span className="px-1 py-0.5 bg-red-600 text-white rounded">RUPAY</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-slate-200">
                    <input
                      value={card.exp}
                      onChange={(e) => setCard((c) => ({ ...c, exp: formatExp(e.target.value) }))}
                      placeholder="MM / YY"
                      maxLength={7}
                      className="px-3 py-2.5 text-sm font-mono outline-none"
                    />
                    <input
                      value={card.cvc}
                      onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      placeholder="CVC"
                      maxLength={4}
                      className="px-3 py-2.5 text-sm font-mono outline-none"
                    />
                  </div>
                </div>
                {(errors.number || errors.exp || errors.cvc) && (
                  <p className="text-xs text-rose-600 mt-1">{errors.number || errors.exp || errors.cvc}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Cardholder name</label>
                <input
                  value={card.name}
                  onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))}
                  placeholder="Full name on card"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-primary-500"
                />
                {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Country or region</label>
                <select value={card.country} onChange={(e) => setCard((c) => ({ ...c, country: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-primary-500 bg-white">
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full mt-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2 shadow-md"
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing payment…</> : 'Subscribe'}
          </button>

          <p className="text-[11px] text-center text-slate-500 mt-4 inline-flex items-center gap-1.5 w-full justify-center">
            <Lock className="h-3 w-3" /> Payments processed securely. Your card details never touch our servers.
          </p>

          {/* Trust strip */}
          <div className="mt-6 flex items-center justify-center gap-3 text-[10px] text-slate-400">
            <CheckCircle2 className="h-3 w-3" /> PCI-compliant gateway · 256-bit TLS · Cancel anytime
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCardNumber(s: string): string {
  const digits = s.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(\d{4})/g, '$1 ').trim();
}
function formatExp(s: string): string {
  const digits = s.replace(/\D/g, '').slice(0, 4);
  if (digits.length < 3) return digits;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}
