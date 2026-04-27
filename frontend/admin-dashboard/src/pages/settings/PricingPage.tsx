import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Check, X, Sparkles, ArrowRight, Loader2, Zap, Users, PhoneCall,
  Globe, BarChart3, Webhook, Calendar, Shield, Headphones, Building2,
  Calculator, Mic, Bot, Wallet, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { billingApi, type Plan, type Subscription, type Wallet as WalletT } from '@/services/billing.api';

// "Compare features" matrix — what each plan can do vs the others. Drives the
// feature comparison table at the bottom of the page. Order = display order.
const FEATURE_MATRIX: Array<{ key: string; label: string; group: string; icon: any }> = [
  { group: 'Calling',         key: 'web_calls',                    label: 'Web calls',                       icon: Globe },
  { group: 'Calling',         key: 'phone_calls',                  label: 'Phone calls',                     icon: PhoneCall },
  { group: 'Calling',         key: 'whatsapp',                     label: 'WhatsApp',                        icon: PhoneCall },
  { group: 'Calling',         key: 'bulk_calls',                   label: 'Bulk campaigns (CSV)',            icon: Zap },
  { group: 'Voice',           key: 'voice_cloning',                label: 'Voice cloning',                   icon: Mic },
  { group: 'Voice',           key: 'multilingual',                 label: 'Multilingual (Te/Hi/En + more)',  icon: Globe },
  { group: 'Data',            key: 'transcript',                   label: 'Call transcripts',                icon: BarChart3 },
  { group: 'Data',            key: 'recording',                    label: 'Call recordings',                 icon: BarChart3 },
  { group: 'Analytics',       key: 'basic_analytics',              label: 'Basic analytics',                 icon: BarChart3 },
  { group: 'Analytics',       key: 'advanced_analytics',           label: 'Advanced analytics',              icon: BarChart3 },
  { group: 'Analytics',       key: 'sentiment_detection',          label: 'Sentiment detection (AI)',        icon: Sparkles },
  { group: 'Analytics',       key: 'lead_scoring',                 label: 'AI lead scoring',                 icon: Sparkles },
  { group: 'Integrations',    key: 'crm_basic',                    label: 'Basic CRM integrations',          icon: Bot },
  { group: 'Integrations',    key: 'crm_advanced',                 label: 'Salesforce / Zoho / HubSpot',     icon: Bot },
  { group: 'Integrations',    key: 'webhooks',                     label: 'Webhooks',                        icon: Webhook },
  { group: 'Integrations',    key: 'calendar',                     label: 'Calendar integration',            icon: Calendar },
  { group: 'Integrations',    key: 'custom_workflows',             label: 'Custom workflows',                icon: Webhook },
  { group: 'Platform',        key: 'api_access',                   label: 'API access',                      icon: Webhook },
  { group: 'Platform',        key: 'multi_team',                   label: 'Multi-team support',              icon: Users },
  { group: 'Platform',        key: 'rbac',                         label: 'Role-based access (RBAC)',        icon: Shield },
  { group: 'Platform',        key: 'sso',                          label: 'SSO',                             icon: Shield },
  { group: 'Enterprise',      key: 'dedicated_support',            label: 'Dedicated support',               icon: Headphones },
  { group: 'Enterprise',      key: 'sla',                          label: 'SLA guarantees',                  icon: Shield },
  { group: 'Enterprise',      key: 'custom_models',                label: 'Custom AI models',                icon: Sparkles },
  { group: 'Enterprise',      key: 'agent_training_from_recordings', label: 'Agent training from recordings', icon: Mic },
  { group: 'Enterprise',      key: 'on_prem',                      label: 'On-prem / private cloud',         icon: Building2 },
];

const FAQS: Array<{ q: string; a: string }> = [
  { q: 'How does pay-as-you-go work?', a: 'Each plan includes a monthly bundle of minutes at your plan\'s rate. Calls beyond that are billed per minute at the overage rate from your wallet — so you only pay for what you actually use.' },
  { q: 'Can I change plans mid-cycle?', a: 'Yes. Upgrades take effect immediately and we charge the new plan\'s monthly fee from your wallet. Downgrades take effect at the next renewal so you don\'t lose features you\'ve already paid for.' },
  { q: 'What happens if my wallet runs out?', a: 'New calls are blocked with a clear error and existing calls finish gracefully. Top up the wallet (any amount) and calling resumes immediately. We email the OWNER user when balance falls below the threshold so it doesn\'t catch you off guard.' },
  { q: 'How are minutes counted?', a: 'We count actual call duration end-to-end (rounded up to the nearest second), debited from the wallet at your plan\'s included rate until your monthly bundle is exhausted. Beyond that, the overage rate applies.' },
  { q: 'What\'s included in "minutes"?', a: 'Voice (telephony or web), STT, TTS, and LLM tokens are all bundled into the per-minute rate so your invoicing is simple and predictable. The dashboard breaks them down so you can see where the cost goes.' },
  { q: 'Do you offer GST invoices?', a: 'Yes — every wallet top-up and plan charge generates a GST-compliant invoice in your tenant\'s billing tab. Enterprise contracts get bespoke invoicing on PO terms.' },
  { q: 'Can I cancel anytime?', a: 'Yes. Cancel from settings > billing and your subscription stays active through the end of the current period. We don\'t auto-renew after cancellation.' },
  { q: 'How do I get on Enterprise?', a: 'Hit "Contact sales" on the Enterprise card. Custom pricing depends on volume, integrations, and deployment model (cloud / on-prem). Most onboarding takes 2–4 weeks.' },
];

export function PricingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [wallet, setWallet] = useState<WalletT | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [acting, setActing] = useState(false);
  const [calculatorMinutes, setCalculatorMinutes] = useState(2000);

  useEffect(() => {
    Promise.all([billingApi.getPlans(), billingApi.getCurrentPlan(), billingApi.getWallet()])
      .then(([p, c, w]) => { setPlans(p); setCurrent(c); setWallet(w); })
      .finally(() => setLoading(false));
  }, []);

  const visiblePlans = useMemo(
    () => plans.filter((p) => !p.hidden_from_grid).sort((a, b) => a.price - b.price),
    [plans],
  );

  const handlePlanClick = (plan: Plan) => {
    if (plan.custom) {
      navigate('/help/contact?topic=enterprise');
      return;
    }
    if (current?.plan_id === plan.id) {
      toast.addToast(`You're already on the ${plan.name} plan`, 'info');
      return;
    }
    if (plan.price === 0) {
      // Free plan — no card needed, just switch via the legacy upgrade endpoint
      setPendingPlan(plan);
      return;
    }
    // Paid plan → Stripe-style checkout collects card + processes payment
    navigate(`/settings/checkout?plan=${plan.id}`);
  };

  const confirmUpgrade = async () => {
    if (!pendingPlan) return;
    setActing(true);
    try {
      const updated = await billingApi.upgradePlan(pendingPlan.id);
      setCurrent(updated);
      // Refresh wallet (the upgrade debited it)
      const w = await billingApi.getWallet();
      setWallet(w);
      toast.addToast(`Upgraded to ${pendingPlan.name} — features are active immediately`, 'success');
      setPendingPlan(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || 'Plan change failed';
      toast.addToast(msg, 'error');
      // If the failure was insufficient funds, send them to the wallet top-up.
      if (err?.response?.data?.required) {
        setTimeout(() => navigate('/settings/billing'), 1500);
      }
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>;

  const calcCost = (minutes: number, rate: number) => +(minutes * rate).toFixed(2);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50/40 to-white -mx-4 -my-4 pb-12">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="px-6 py-12 lg:py-16 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-50 border border-primary-200 text-primary-700 text-xs font-medium mb-5">
            <Sparkles className="h-3.5 w-3.5" /> Pricing that scales with you
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight">
            Start free, <span className="bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">scale as you grow.</span>
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Every plan includes voice + STT + TTS + LLM in one per-minute rate. No hidden fees, no setup costs, cancel anytime.
          </p>
          {current && (
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>You're currently on the <b>{current.plan_name}</b> plan</span>
              {wallet && <span className="text-slate-400">·</span>}
              {wallet && <span className="text-slate-600">Wallet ₹{wallet.balance.toFixed(2)}</span>}
            </div>
          )}
        </div>
      </section>

      {/* ── Plan cards ──────────────────────────────────────────────── */}
      <section className="px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {visiblePlans.map((plan) => {
            const isCurrent = current?.plan_id === plan.id;
            const canUpgrade = !plan.custom && !isCurrent;
            const insufficient = !plan.custom && plan.price > 0 && wallet && wallet.balance < plan.price;
            return (
              <div key={plan.id}
                className={`relative bg-white border-2 rounded-2xl p-5 transition-all flex flex-col ${
                  plan.popular ? 'border-primary-500 shadow-xl shadow-primary-500/10' :
                  isCurrent ? 'border-emerald-500 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                }`}>
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-0.5 bg-gradient-to-r from-primary-600 to-accent-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow">
                    <Sparkles className="h-3 w-3" /> Most popular
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-0.5 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow">
                    <CheckCircle2 className="h-3 w-3" /> Current plan
                  </span>
                )}

                <div className="mb-4">
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  {plan.tagline && <p className="text-xs text-slate-500 mt-0.5">{plan.tagline}</p>}
                </div>

                <div className="mb-5 pb-4 border-b border-slate-100">
                  {plan.custom ? (
                    <>
                      <p className="text-3xl font-bold text-slate-900">Custom</p>
                      <p className="text-xs text-slate-500 mt-1">Volume-tiered from ₹{plan.features.rate_per_min}/min</p>
                    </>
                  ) : plan.price === 0 ? (
                    <>
                      <p className="text-3xl font-bold text-slate-900">Free</p>
                      <p className="text-xs text-slate-500 mt-1">Forever · 100 mins included</p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-slate-900">
                        ₹{plan.price.toLocaleString()}
                        <span className="text-sm text-slate-500 font-normal">/mo</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1">+ ₹{plan.features.extra_per_min}/min over {plan.features.included_minutes} included</p>
                    </>
                  )}
                </div>

                <ul className="space-y-2 mb-5 flex-1">
                  {plan.features.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                      <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan)}
                  disabled={isCurrent}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all inline-flex items-center justify-center gap-1.5 ${
                    isCurrent ? 'bg-emerald-50 text-emerald-700 cursor-default' :
                    plan.custom ? 'bg-slate-900 text-white hover:bg-slate-800' :
                    plan.popular ? 'bg-gradient-to-r from-primary-600 to-accent-600 text-white shadow-md hover:shadow-lg' :
                    'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {isCurrent ? 'Current plan' : plan.custom ? <>Contact sales <ArrowRight className="h-3.5 w-3.5" /></> : canUpgrade ? <>Upgrade <ArrowRight className="h-3.5 w-3.5" /></> : 'Choose plan'}
                </button>
                {insufficient && (
                  <p className="mt-2 text-[10px] text-rose-600 inline-flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Top up ₹{(plan.price - wallet!.balance).toFixed(2)} first
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Usage calculator ────────────────────────────────────────── */}
      <section className="px-6 max-w-4xl mx-auto mt-12">
        <div className="bg-white border border-slate-200 rounded-3xl p-7 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <Calculator className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-bold text-slate-900">Usage calculator</h2>
          </div>
          <p className="text-sm text-slate-600 mb-5">Estimate your monthly cost across plans based on expected call volume.</p>
          <div className="flex items-center gap-3 mb-6">
            <input type="range" min={50} max={20000} step={50} value={calculatorMinutes}
              onChange={(e) => setCalculatorMinutes(Number(e.target.value))}
              className="flex-1 accent-primary-600" />
            <input type="number" min={50} max={50000} value={calculatorMinutes}
              onChange={(e) => setCalculatorMinutes(Number(e.target.value) || 0)}
              className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-2 text-right" />
            <span className="text-sm text-slate-500">minutes / mo</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {visiblePlans.map((plan) => {
              const included = plan.features.included_minutes;
              const overageMin = Math.max(0, calculatorMinutes - included);
              const totalCost = plan.custom
                ? calcCost(calculatorMinutes, plan.features.rate_per_min)
                : plan.price + calcCost(overageMin, plan.features.extra_per_min);
              return (
                <div key={plan.id} className={`p-3 rounded-xl border ${plan.popular ? 'bg-primary-50/40 border-primary-200' : 'bg-slate-50/50 border-slate-200'}`}>
                  <p className="text-xs font-semibold text-slate-700">{plan.name}</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {plan.custom ? `₹${calcCost(calculatorMinutes, plan.features.rate_per_min).toLocaleString()}` : `₹${totalCost.toLocaleString()}`}
                    <span className="text-[10px] text-slate-500 font-normal"> /mo</span>
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {plan.custom
                      ? `@ ₹${plan.features.rate_per_min}/min`
                      : overageMin > 0
                        ? `${included} incl + ${overageMin}m overage`
                        : `${calculatorMinutes} of ${included} incl`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Feature comparison ──────────────────────────────────────── */}
      <section className="px-6 max-w-7xl mx-auto mt-12">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Compare every feature</h2>
        <p className="text-sm text-slate-600 text-center mb-6">Detailed breakdown of what each plan includes.</p>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-700 sticky left-0 bg-slate-50">Feature</th>
                {visiblePlans.map((p) => (
                  <th key={p.id} className={`px-3 py-3 text-center font-semibold ${p.popular ? 'text-primary-700' : 'text-slate-700'}`}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Limits row */}
              <tr className="bg-slate-50/50">
                <td colSpan={visiblePlans.length + 1} className="px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Limits</td>
              </tr>
              <LimitRow label="Agents" plans={visiblePlans} render={(p) => p.features.agents === 'unlimited' ? '∞' : p.features.agents} />
              <LimitRow label="Included minutes / mo" plans={visiblePlans} render={(p) => p.features.included_minutes === 0 ? 'custom' : p.features.included_minutes.toLocaleString()} />
              <LimitRow label="Concurrent calls" plans={visiblePlans} render={(p) => p.features.concurrent_calls ?? p.features.channels} />
              <LimitRow label="Knowledge base" plans={visiblePlans} render={(p) => `${p.features.knowledge_base_mb} MB`} />
              <LimitRow label="Rate per minute" plans={visiblePlans} render={(p) => `₹${p.features.rate_per_min}`} />
              <LimitRow label="Overage rate" plans={visiblePlans} render={(p) => p.features.extra_per_min ? `₹${p.features.extra_per_min}` : '—'} />
              <LimitRow label="Support" plans={visiblePlans} render={(p) => p.features.support} />

              {/* Capability rows grouped */}
              {Array.from(new Set(FEATURE_MATRIX.map((m) => m.group))).map((group) => (
                <tr key={group} className="bg-slate-50/50">
                  <td colSpan={visiblePlans.length + 1} className="px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">{group}</td>
                </tr>
              )).flatMap((groupHeader, idx) => {
                const group = Array.from(new Set(FEATURE_MATRIX.map((m) => m.group)))[idx];
                return [
                  groupHeader,
                  ...FEATURE_MATRIX.filter((m) => m.group === group).map((feat) => (
                    <tr key={feat.key} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 text-slate-700 sticky left-0 bg-white inline-flex items-center gap-2">
                        <feat.icon className="h-3.5 w-3.5 text-slate-400" />
                        {feat.label}
                      </td>
                      {visiblePlans.map((p) => (
                        <td key={p.id} className="px-3 py-2.5 text-center">
                          {p.feature_flags?.[feat.key] ?
                            <Check className="h-4 w-4 text-emerald-500 inline" /> :
                            <X className="h-4 w-4 text-slate-300 inline" />}
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section className="px-6 max-w-3xl mx-auto mt-12">
        <h2 className="text-2xl font-bold text-slate-900 text-center mb-6">Frequently asked questions</h2>
        <div className="space-y-3">
          {FAQS.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
        </div>
      </section>

      {/* ── Contact sales banner ────────────────────────────────────── */}
      <section className="px-6 max-w-5xl mx-auto mt-12">
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-3xl p-8 text-center text-white">
          <Building2 className="h-10 w-10 mx-auto mb-3 text-amber-400" />
          <h2 className="text-2xl font-bold">Need something custom?</h2>
          <p className="text-slate-300 mt-2 max-w-xl mx-auto">
            Enterprise plans include volume pricing, dedicated infrastructure, custom AI models, agent training from your call recordings, and SOC 2 compliance.
          </p>
          <Link to="/help/contact?topic=enterprise" className="mt-5 inline-flex items-center gap-2 px-6 py-2.5 bg-amber-400 text-slate-900 rounded-xl font-semibold hover:bg-amber-300">
            Talk to sales <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── Settings shortcut ───────────────────────────────────────── */}
      <section className="px-6 max-w-5xl mx-auto mt-8 text-center">
        <Link to="/settings/billing" className="text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
          <Wallet className="h-4 w-4" /> Manage wallet, view invoices & usage
        </Link>
      </section>

      {/* ── Confirmation modal ──────────────────────────────────────── */}
      <Modal isOpen={!!pendingPlan} onClose={() => setPendingPlan(null)} title={`Switch to ${pendingPlan?.name || ''}?`}>
        {pendingPlan && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">{pendingPlan.description}</p>
            <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">New plan</span><span className="font-semibold">{pendingPlan.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Charged today</span><span className="font-semibold">₹{pendingPlan.price.toLocaleString()}</span></div>
              {wallet && <div className="flex justify-between"><span className="text-slate-500">Wallet balance</span><span className={`font-semibold ${wallet.balance < pendingPlan.price ? 'text-rose-700' : 'text-slate-900'}`}>₹{wallet.balance.toFixed(2)}</span></div>}
              {wallet && wallet.balance >= pendingPlan.price && (
                <div className="flex justify-between text-xs"><span className="text-slate-500">After charge</span><span className="text-slate-700">₹{(wallet.balance - pendingPlan.price).toFixed(2)}</span></div>
              )}
            </div>
            <p className="text-xs text-slate-500">
              The new plan's features activate immediately. Your wallet is charged once and we'll auto-renew at ₹{pendingPlan.price}/mo on {pendingPlan.price > 0 ? 'the same day next month' : 'end of period'}.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingPlan(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={confirmUpgrade} disabled={acting || (wallet ? wallet.balance < pendingPlan.price : false)}
                className="px-5 py-2 bg-gradient-to-r from-primary-600 to-accent-600 text-white rounded-lg font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                {acting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Confirm & charge wallet
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function LimitRow({ label, plans, render }: { label: string; plans: Plan[]; render: (p: Plan) => any }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2.5 text-slate-700 font-medium sticky left-0 bg-white">{label}</td>
      {plans.map((p) => (
        <td key={p.id} className={`px-3 py-2.5 text-center text-slate-700 ${p.popular ? 'bg-primary-50/30' : ''}`}>{render(p)}</td>
      ))}
    </tr>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50">
        <span className="text-sm font-semibold text-slate-900">{q}</span>
        <ArrowRight className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <p className="px-5 pb-4 text-sm text-slate-600 leading-relaxed">{a}</p>}
    </div>
  );
}
