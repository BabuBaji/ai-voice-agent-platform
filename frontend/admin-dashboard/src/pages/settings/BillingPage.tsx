import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Phone, Check,
  Activity, DollarSign, Database, FileText, Plus, AlertCircle, AlertTriangle, Receipt,
  Trash2, Star, ArrowDownLeft, ArrowUpRight, Printer, Loader2, Info,
  TrendingUp, Sparkles, Wallet,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { Input } from '@/components/ui/Input';
import { formatINR, formatDateShort, formatDate } from '@/utils/formatters';
import {
  billingApi, type Plan, type Subscription, type Wallet as WalletT, type WalletTransaction,
  type UsageSummary, type PhoneRental, type PaymentMethod, type Invoice,
} from '@/services/billing.api';

const TOPUP_PRESETS = [500, 1000, 2500, 5000, 10000];

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'active' || status === 'paid') return 'success';
  if (status === 'past_due' || status === 'failed' || status === 'suspended') return 'danger';
  if (status === 'pending') return 'warning';
  return 'default';
}

function DarkBadge({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'default' | 'cyan'; children: React.ReactNode }) {
  const cls: Record<typeof tone, string> = {
    success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
    default: 'bg-gray-100 text-gray-600 border-gray-200',
    cyan: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls[tone]}`}>
      {children}
    </span>
  );
}

function DarkBtn({
  variant = 'primary', children, onClick, disabled, loading, size = 'md', className = '',
}: {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger' | 'cyan-outline';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes: Record<typeof size, string> = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  };
  const variants: Record<typeof variant, string> = {
    primary: 'bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold',
    outline: 'border border-gray-200 text-gray-700 hover:bg-gray-100',
    'cyan-outline': 'border border-cyan-500/40 text-cyan-600 hover:bg-cyan-500/10',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'bg-rose-600 hover:bg-rose-500 text-gray-900',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function BillingPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [wallet, setWallet] = useState<WalletT | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [rentals, setRentals] = useState<PhoneRental[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [showAddFunds, setShowAddFunds] = useState(false);
  const [showAddPM, setShowAddPM] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [showModels, setShowModels] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, p, w, tx, u, r, pm, inv] = await Promise.all([
        billingApi.getCurrentPlan(),
        billingApi.getPlans(),
        billingApi.getWallet(),
        billingApi.getTransactions(15),
        billingApi.getUsage(),
        billingApi.getPhoneNumbers(),
        billingApi.getPaymentMethods(),
        billingApi.getInvoices(20),
      ]);
      setSubscription(s);
      setPlans(p);
      setWallet(w);
      setTransactions(tx);
      setUsage(u);
      setRentals(r);
      setPaymentMethods(pm);
      setInvoices(inv);
    } catch (err: any) {
      toast.addToast(err?.response?.data?.error || 'Failed to load billing data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const lowBalance = wallet ? wallet.balance < wallet.low_balance_threshold : false;
  const subscriptionPastDue = subscription?.status === 'past_due';

  const ratePerMin = subscription?.plan?.features.rate_per_min ?? 4.5;
  const minutesLeft = wallet ? wallet.balance / ratePerMin : 0;
  const includedMinutes = subscription?.plan?.features.included_minutes ?? 0;
  const includedUsed = usage?.included_minutes_used ?? 0;
  const includedRemaining = usage?.included_minutes_remaining ?? Math.max(0, includedMinutes - includedUsed);

  const visiblePlans = useMemo(
    () => plans.filter((p) => !p.hidden_from_grid),
    [plans],
  );

  async function confirmPlanChange() {
    if (!pendingPlan) return;
    if (pendingPlan.custom) {
      toast.addToast('Reach out to sales for an Enterprise quote', 'info');
      setPendingPlan(null);
      return;
    }
    try {
      await billingApi.upgradePlan(pendingPlan.id);
      toast.addToast(`Plan updated to ${pendingPlan.name}`, 'success');
      setPendingPlan(null);
      await loadAll();
    } catch (err: any) {
      const data = err?.response?.data;
      if (err?.response?.status === 402 && data?.shortfall) {
        toast.addToast(
          `Insufficient wallet balance — top up ₹${data.shortfall} to continue`,
          'error',
        );
        setPendingPlan(null);
        setShowAddFunds(true);
        return;
      }
      toast.addToast(data?.error || 'Plan change failed', 'error');
    }
  }

  async function confirmCancel() {
    try {
      await billingApi.cancelPlan();
      toast.addToast('Subscription will end at the next renewal', 'success');
      setShowCancelConfirm(false);
      await loadAll();
    } catch (err: any) {
      toast.addToast(err?.response?.data?.error || 'Cancel failed', 'error');
    }
  }

  return (
    <div className="-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gray-50">
      <div className="max-w-7xl mx-auto p-8 space-y-8">
            {loading && (
              <div className="flex items-center justify-center py-16 text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading billing data…
              </div>
            )}

            {!loading && subscription && (
              <>
                {/* Top-of-page alerts */}
                <DarkAlerts
                  lowBalance={lowBalance}
                  wallet={wallet}
                  pastDue={subscriptionPastDue}
                  renewal={subscription.next_renewal_date}
                  cancelAtPeriodEnd={subscription.cancel_at_period_end}
                  onTopUp={() => setShowAddFunds(true)}
                />

                {/* 3 stat cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatTile
                    icon={<Activity className="h-4 w-4" />}
                    label="Active Plan"
                    value={subscription.plan_name}
                    sub={`Voice AI Cost: ₹${ratePerMin.toFixed(2)} / min`}
                  />
                  <StatTile
                    icon={<DollarSign className="h-4 w-4" />}
                    label="Current Balance"
                    value={formatINR(wallet?.balance ?? 0)}
                    sub={`~${minutesLeft.toFixed(2)} Minutes left`}
                  />
                  <StatTile
                    icon={<Database className="h-4 w-4" />}
                    label="Plan Minutes"
                    value={includedMinutes > 0 ? `${includedUsed.toFixed(1)} used / ${includedMinutes}` : '—'}
                    sub={includedMinutes > 0 ? `${includedRemaining.toFixed(1)} min remaining this period` : 'Pay-per-use'}
                  />
                </div>

                {/* Voice AI Pricing section */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1" />
                    <div className="text-center flex-1">
                      <h3 className="text-2xl font-bold text-gray-900">Voice AI Pricing</h3>
                      <span className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium border border-cyan-500/30 text-cyan-600 bg-cyan-500/5">
                        Billed monthly
                      </span>
                    </div>
                    <div className="flex-1 flex justify-end">
                      <DarkBtn variant="cyan-outline" onClick={() => setShowAddFunds(true)}>
                        <Plus className="h-4 w-4" />
                        Top Up Credits
                        <span className="text-xs text-cyan-600/70">(UPI Available)</span>
                      </DarkBtn>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mt-8">
                    {visiblePlans.map((p) => (
                      <PlanTile
                        key={p.id}
                        plan={p}
                        current={p.id === subscription.plan_id}
                        onSelect={() => setPendingPlan(p)}
                      />
                    ))}
                  </div>

                  {/* Flexible Model Selection banner */}
                  <div className="mt-6 flex flex-col md:flex-row items-start md:items-center gap-3 p-4 rounded-2xl bg-cyan-500/[0.04] border border-cyan-500/20">
                    <div className="h-9 w-9 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
                      <Info className="h-4 w-4 text-cyan-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Flexible Model Selection</p>
                      <p className="text-sm text-gray-400">You can use any combination of supported models for your Voice AI agents.</p>
                    </div>
                    <DarkBtn variant="outline" size="sm" onClick={() => setShowModels(true)}>
                      Show Available Models
                    </DarkBtn>
                  </div>
                </section>

                {/* Chatbot Pricing */}
                <ChatbotPricingSection plans={visiblePlans} />

                {/* Features comparison */}
                <FeaturesComparisonSection plans={visiblePlans} />

                {/* Wallet + transactions + Usage cost row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <DarkCard className="lg:col-span-1">
                    <CardTitle title="Wallet" action={
                      <DarkBtn size="sm" variant="primary" onClick={() => setShowAddFunds(true)}>
                        <Plus className="h-4 w-4" /> Add Funds
                      </DarkBtn>
                    } />
                    <div className="rounded-2xl p-5 bg-gradient-to-br from-cyan-500/15 to-cyan-700/10 border border-cyan-500/20">
                      <div className="flex items-center gap-2 text-xs text-cyan-600/80 uppercase tracking-wide">
                        <Wallet className="h-3.5 w-3.5" /> Available balance
                      </div>
                      <p className="text-3xl font-bold text-gray-900 mt-1 tracking-tight">{formatINR(wallet?.balance ?? 0)}</p>
                      <p className="text-xs text-gray-400 mt-1">Auto-deducted for calls &amp; rentals</p>
                    </div>
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent transactions</p>
                      {transactions.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4 text-center">No transactions yet</p>
                      ) : (
                        <ul className="divide-y divide-gray-100">
                          {transactions.slice(0, 5).map((t) => (
                            <li key={t.id} className="py-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`h-7 w-7 rounded-full flex items-center justify-center ${t.type === 'credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                                  {t.type === 'credit' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{t.reason}</p>
                                  <p className="text-xs text-gray-500">{formatDate(t.created_at)}</p>
                                </div>
                              </div>
                              <p className={`text-sm font-semibold whitespace-nowrap ${t.type === 'credit' ? 'text-emerald-600' : 'text-gray-600'}`}>
                                {t.type === 'credit' ? '+' : '−'}{formatINR(t.amount)}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </DarkCard>

                  <DarkCard className="lg:col-span-2">
                    <CardTitle
                      title="Usage This Month"
                      subtitle={usage ? `${formatDateShort(usage.period_start)} – ${formatDateShort(usage.period_end)}` : ''}
                    />
                    {usage && (
                      <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                          <MiniStat icon={<Phone className="h-4 w-4" />} label="Calls" value={usage.total_calls.toLocaleString()} />
                          <MiniStat icon={<TrendingUp className="h-4 w-4" />} label="Minutes" value={usage.total_minutes.toFixed(1)} />
                          <MiniStat icon={<Sparkles className="h-4 w-4" />} label="Active agents" value={usage.active_agents.toString()} />
                          <MiniStat icon={<Phone className="h-4 w-4" />} label="Channels" value={usage.concurrent_channels.toString()} />
                        </div>
                        {usage.included_minutes > 0 && (
                          <div className="mb-5">
                            <div className="flex items-center justify-between mb-2 text-sm">
                              <span className="font-medium text-gray-700">Included minutes</span>
                              <span className="text-gray-400">
                                {usage.included_minutes_used.toFixed(1)} / {usage.included_minutes.toLocaleString()} min
                              </span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-cyan-500"
                                style={{ width: `${Math.min(100, (usage.included_minutes_used / usage.included_minutes) * 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {usage.included_minutes_remaining.toFixed(1)} min remaining • after that ₹{usage.rate_per_min}/min
                            </p>
                          </div>
                        )}
                        <CostBreakdownTable usage={usage} />
                      </>
                    )}
                  </DarkCard>
                </div>

                {/* Recent invoices — render only when there's content */}
                {invoices.length > 0 && (
                  <DarkCard>
                    <CardTitle title="Recent Invoices" subtitle="Click any invoice to view or print" />
                    <ul className="divide-y divide-gray-100">
                      {invoices.slice(0, 5).map((inv) => (
                        <li key={inv.id} className="py-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center">
                              <FileText className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{inv.reason}</p>
                              <p className="text-xs text-gray-500">{inv.invoice_no} • {formatDate(inv.created_at)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <DarkBadge tone={statusTone(inv.status)}>{inv.status}</DarkBadge>
                            <p className="text-sm font-semibold text-gray-900 w-24 text-right">{formatINR(inv.total_amount)}</p>
                            <DarkBtn size="sm" variant="ghost" onClick={() => setActiveInvoice(inv)}>
                              <Receipt className="h-4 w-4" />View
                            </DarkBtn>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </DarkCard>
                )}

                {/* How billing works + FAQ */}
                <BillingHelpSection />

                {/* Cancel subscription footer */}
                {subscription.plan_id !== 'free' && !subscription.cancel_at_period_end && (
                  <div className="text-center text-xs text-gray-500">
                    <button onClick={() => setShowCancelConfirm(true)} className="hover:text-rose-600">
                      Cancel subscription
                    </button>
                    <span className="mx-2">·</span>
                    Plan auto-renews on {formatDateShort(subscription.next_renewal_date)}
                  </div>
                )}
              </>
            )}
      </div>

      {/* Modals */}
      <AddFundsModal
        isOpen={showAddFunds}
        onClose={() => setShowAddFunds(false)}
        paymentMethods={paymentMethods}
        onSuccess={async () => {
          await loadAll();
          toast.addToast('Funds added successfully', 'success');
          setShowAddFunds(false);
        }}
      />
      <AddPaymentMethodModal
        isOpen={showAddPM}
        onClose={() => setShowAddPM(false)}
        onSuccess={async () => {
          await loadAll();
          toast.addToast('Payment method added', 'success');
          setShowAddPM(false);
        }}
      />
      <PlanChangeModal
        plan={pendingPlan}
        currentPlanId={subscription?.plan_id}
        onClose={() => setPendingPlan(null)}
        onConfirm={confirmPlanChange}
      />
      <CancelSubscriptionModal
        isOpen={showCancelConfirm}
        renewal={subscription?.next_renewal_date}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={confirmCancel}
      />
      <InvoiceModal
        invoice={activeInvoice}
        onClose={() => setActiveInvoice(null)}
      />
      <ModelsModal isOpen={showModels} onClose={() => setShowModels(false)} />
    </div>
  );
}

// ────────────────────────── Building blocks ──────────────────────────

function DarkCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white border border-gray-200 p-5 ${className}`}>
      {children}
    </div>
  );
}

function CardTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h4 className="text-base font-semibold text-gray-900">{title}</h4>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function StatTile({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-transparent border border-gray-200 p-6 text-center hover:border-cyan-500/40 transition-colors">
      <div className="inline-flex items-center gap-2 text-sm font-medium text-gray-600">
        <span className="text-cyan-600">{icon}</span>{label}
      </div>
      <p className="text-3xl font-bold text-cyan-600 mt-3 tracking-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-2">{sub}</p>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide">
        <span className="text-gray-400">{icon}</span>{label}
      </div>
      <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function PlanTile({ plan, current, onSelect }: { plan: Plan; current: boolean; onSelect: () => void }) {
  const isEnterprise = plan.custom;
  return (
    <div
      className={`relative rounded-2xl p-5 border transition-all duration-200 ${
        current
          ? 'border-cyan-500/60 bg-cyan-500/[0.06] shadow-[0_0_0_1px_rgba(34,211,238,0.4)]'
          : plan.popular
            ? 'border-cyan-500/30 bg-white'
            : 'border-gray-200 bg-white'
      } hover:border-cyan-500/40`}
    >
      {plan.popular && !current && (
        <div className="absolute -top-2.5 right-4">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500 text-emerald-950">
            {plan.discount_pct}% OFF
          </span>
        </div>
      )}
      {current && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500 text-cyan-950">
            CURRENT
          </span>
        </div>
      )}

      <h4 className="text-center font-semibold text-gray-900 truncate">{plan.name}</h4>
      <div className="text-center mt-3 mb-1 min-h-[4rem] flex flex-col items-center justify-center">
        {isEnterprise ? (
          <>
            <p className="text-2xl lg:text-3xl font-bold text-cyan-600 leading-tight">Custom</p>
            <p className="text-xs text-gray-400 mt-0.5">pricing</p>
          </>
        ) : (
          <>
            {plan.original_price && plan.original_price > plan.price && (
              <p className="text-xs text-gray-500 line-through leading-tight mb-0.5">
                ₹{plan.original_price.toLocaleString('en-IN')}
              </p>
            )}
            <p className="text-2xl lg:text-3xl font-bold text-cyan-600 leading-tight whitespace-nowrap">
              ₹{plan.price.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">/month</p>
          </>
        )}
      </div>

      {plan.description && (
        <p className="text-xs text-gray-500 text-center min-h-[3rem] px-1 mb-4">{plan.description}</p>
      )}

      {!isEnterprise ? (
        <div className="space-y-2 mb-5 text-xs">
          <DataRow label="Cost" value={`₹${plan.features.rate_per_min.toFixed(2)}/min`} />
          <DataRow label="Minutes" value={`~${plan.features.included_minutes.toLocaleString('en-IN')} minutes`} />
          <DataRow
            label="Extra Usage"
            value={<><span className="text-[10px] text-gray-500 mr-1">Existing</span>+ ₹{plan.features.extra_per_min.toFixed(2)}</>}
          />
          <DataRow label="Knowledge base" value={`${plan.features.knowledge_base_mb} MB`} />
        </div>
      ) : (
        <ul className="space-y-2 mb-5 text-xs">
          {plan.features.highlights.slice(0, 3).map((h) => (
            <li key={h} className="flex items-start gap-1.5 text-gray-600">
              <Check className="h-3.5 w-3.5 text-cyan-600 flex-shrink-0 mt-0.5" />{h}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onSelect}
        disabled={current}
        className={`w-full h-9 rounded-xl text-sm font-semibold transition-colors ${
          current
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : isEnterprise
              ? 'border border-cyan-500/40 text-cyan-600 hover:bg-cyan-500/10'
              : 'bg-cyan-500 hover:bg-cyan-400 text-gray-950'
        }`}
      >
        {current ? 'Current Plan' : isEnterprise ? 'Contact Us' : 'Upgrade'}
      </button>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-200/60 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  );
}

// Per-message chatbot rate by plan id (INR/message). Hardcoded: same flat rate
// across all paid tiers for now, custom for Enterprise (matches OmniDim).
const CHATBOT_RATE_INR: Record<string, number | 'custom'> = {
  starter: 0.5,
  jump_starter: 0.5,
  early: 0.5,
  growth: 0.5,
  enterprise: 'custom',
};

function ChatbotPricingSection({ plans }: { plans: Plan[] }) {
  return (
    <section>
      <div className="text-center mb-6">
        <h3 className="text-2xl font-bold text-gray-900">Chatbot Pricing</h3>
        <p className="text-sm text-gray-400 mt-1">Simple per-message pricing for all plans</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col">
          <p className="text-2xl font-bold text-gray-500 text-center mb-3">—</p>
          <div className="flex-1" />
          <p className="text-xs uppercase tracking-wide text-gray-400">Cost</p>
        </div>
        {plans.map((p) => {
          const rate = CHATBOT_RATE_INR[p.id];
          return (
            <div
              key={p.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col items-center text-center hover:border-cyan-500/30 transition-colors"
            >
              <p className="font-semibold text-gray-900">{p.name}</p>
              <div className="flex-1 flex items-center justify-center mt-3">
                {rate === 'custom' ? (
                  <span className="text-sm text-gray-600">custom</span>
                ) : (
                  <span className="text-sm text-gray-700">
                    <span className="font-semibold">₹{rate?.toFixed(2)}</span> / message
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Feature comparison matrix. true = ✓, false = ✗, string = literal text shown.
type FeatureCell = boolean | string;
interface FeatureRow {
  label: string;
  hint?: string;
  values: Record<string, FeatureCell>;
}

const FEATURE_MATRIX: FeatureRow[] = [
  {
    label: 'OmniCRM',
    hint: 'Built-in CRM with leads, deals, contacts',
    values: { starter: false, jump_starter: false, early: false, growth: false, enterprise: true },
  },
  {
    label: 'Dedicated support',
    hint: 'Channels you can reach support on',
    values: {
      starter: 'Email', jump_starter: 'Email', early: 'Email', growth: 'Email',
      enterprise: 'Email / Whatsapp / Slack',
    },
  },
  {
    label: 'Train assistant from call recording',
    hint: 'Auto-fine-tune your agent on past calls',
    values: { starter: false, jump_starter: false, early: false, growth: false, enterprise: true },
  },
  {
    label: 'API access',
    hint: 'REST + webhooks for full programmatic control',
    values: { starter: false, jump_starter: false, early: true, growth: true, enterprise: true },
  },
  {
    label: 'Custom voice cloning',
    values: { starter: false, jump_starter: true, early: true, growth: true, enterprise: true },
  },
  {
    label: 'Bulk call campaigns',
    values: { starter: false, jump_starter: true, early: true, growth: true, enterprise: true },
  },
  {
    label: 'Advanced analytics',
    values: { starter: false, jump_starter: false, early: true, growth: true, enterprise: true },
  },
  {
    label: 'Concurrent channels',
    values: { starter: '1', jump_starter: '2', early: '3', growth: '5', enterprise: '20' },
  },
  {
    label: 'Knowledge base storage',
    values: { starter: '5 MB', jump_starter: '10 MB', early: '50 MB', growth: '100 MB', enterprise: '1 GB' },
  },
  {
    label: 'White-label',
    values: { starter: false, jump_starter: false, early: false, growth: true, enterprise: true },
  },
  {
    label: 'SSO',
    values: { starter: false, jump_starter: false, early: false, growth: false, enterprise: true },
  },
  {
    label: 'GST invoicing',
    values: { starter: false, jump_starter: false, early: false, growth: false, enterprise: true },
  },
];

function FeaturesComparisonSection({ plans }: { plans: Plan[] }) {
  return (
    <section>
      <div className="text-center mb-6">
        <h3 className="text-2xl font-bold text-gray-900">Features</h3>
        <p className="text-sm text-gray-400 mt-1">Compare features across all plans</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-white">
                <th className="text-left px-5 py-4 font-semibold text-gray-900 w-1/4">Features</th>
                {plans.map((p) => (
                  <th key={p.id} className="text-center px-4 py-4 font-semibold text-gray-900">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_MATRIX.map((row, i) => (
                <tr key={i} className="border-b border-gray-200/60 last:border-0">
                  <td className="px-5 py-4 text-gray-700">
                    <span className="inline-flex items-center gap-1.5">
                      {row.label}
                      {row.hint && (
                        <span title={row.hint} className="text-gray-500 cursor-help">
                          <Info className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </span>
                  </td>
                  {plans.map((p) => {
                    const v = row.values[p.id];
                    return (
                      <td key={p.id} className="px-4 py-4 text-center">
                        <FeatureCellView v={v ?? false} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function BillingHelpSection() {
  const [open, setOpen] = useState<number | null>(0);
  const steps = [
    { icon: Wallet, title: 'Top up wallet', body: 'Add funds via UPI or card. Money sits in your wallet.' },
    { icon: Phone, title: 'Use the platform', body: 'Calls, rentals, and add-ons auto-deduct from the wallet.' },
    { icon: Sparkles, title: 'Renew automatically', body: 'Your plan renews monthly from wallet — no surprises.' },
  ];
  const faqs = [
    {
      q: 'How does billing work?',
      a: 'You top up your wallet, then we auto-deduct usage as you go: per-minute call cost, monthly subscription, phone-number rental, add-ons. Everything is logged in transactions.',
    },
    {
      q: 'What happens if my balance runs out?',
      a: 'In-flight calls finish gracefully, but new outbound calls will be blocked until you top up. Subscription renewal will be marked past_due and retried on the next cron tick.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes. Cancellation takes effect at the end of the current billing period — your plan stays active until then, then auto-downgrades to Free. No partial refunds.',
    },
    {
      q: 'How are call costs calculated?',
      a: 'Duration × your plan\'s per-minute rate. Each plan has included minutes (e.g., 222 min on Starter) — those are free. After they\'re used, per-minute billing kicks in at the plan\'s overage rate.',
    },
    {
      q: 'Are there any setup fees?',
      a: 'No. Start free with the trial credit, pay as you grow. The only charges are your plan price (if any) plus usage.',
    },
    {
      q: 'Do you support GST invoices?',
      a: 'All paid invoices include 18% GST and a unique invoice number. Enterprise customers get formal GST invoices with custom company details on request.',
    },
  ];
  return (
    <section className="space-y-6">
      <div>
        <div className="text-center mb-6">
          <h3 className="text-2xl font-bold text-gray-900">How billing works</h3>
          <p className="text-sm text-gray-400 mt-1">Pay as you grow — wallet-based, transparent, no setup fees</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col items-center text-center hover:border-cyan-500/30 transition-colors">
              <div className="h-12 w-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 relative">
                <s.icon className="h-5 w-5 text-cyan-600" />
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-cyan-500 text-gray-950 text-[10px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <p className="text-sm font-semibold text-gray-900">{s.title}</p>
              <p className="text-xs text-gray-400 mt-1">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-center mb-4">
          <h3 className="text-2xl font-bold text-gray-900">Frequently asked</h3>
          <p className="text-sm text-gray-400 mt-1">Common billing questions answered</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
          {faqs.map((f, i) => (
            <button
              key={i}
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full text-left px-5 py-4 hover:bg-white transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-900">{f.q}</span>
                <span className={`text-cyan-600 text-lg transition-transform ${open === i ? 'rotate-45' : ''}`}>+</span>
              </div>
              {open === i && (
                <p className="text-sm text-gray-400 mt-2 pr-8 leading-relaxed">{f.a}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCellView({ v }: { v: FeatureCell }) {
  if (v === true) return <Check className="h-4 w-4 text-emerald-600 inline-block" />;
  if (v === false) return <span className="text-rose-600 text-base font-bold leading-none">✕</span>;
  return <span className="text-sm text-gray-700">{v}</span>;
}

function CostBreakdownTable({ usage }: { usage: UsageSummary }) {
  const rows = [
    { label: 'Voice calls', value: usage.breakdown.voice },
    { label: 'STT', value: usage.breakdown.stt },
    { label: 'TTS', value: usage.breakdown.tts },
    { label: 'AI processing', value: usage.breakdown.ai },
    { label: 'Phone numbers', value: usage.breakdown.phone_numbers },
    { label: 'Extra channels', value: usage.breakdown.extra_channels },
  ];
  const total = usage.breakdown.total;
  return (
    <div className="border-t border-gray-200 pt-4">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Cost breakdown</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => {
            const pct = total > 0 ? (r.value / total) * 100 : 0;
            return (
              <tr key={r.label} className="border-b border-gray-200/40">
                <td className="py-2 text-gray-600">{r.label}</td>
                <td className="py-2 w-1/2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                </td>
                <td className="py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{formatINR(r.value)}</td>
              </tr>
            );
          })}
          <tr className="font-bold text-cyan-600">
            <td className="pt-3">Total</td>
            <td></td>
            <td className="pt-3 text-right">{formatINR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DarkAlerts({
  lowBalance, wallet, pastDue, renewal, cancelAtPeriodEnd, onTopUp,
}: {
  lowBalance: boolean;
  wallet: WalletT | null;
  pastDue: boolean;
  renewal?: string;
  cancelAtPeriodEnd?: boolean;
  onTopUp: () => void;
}) {
  const items: { tone: 'rose' | 'amber' | 'cyan'; icon: any; title: string; body: string; action?: React.ReactNode }[] = [];
  if (pastDue) items.push({
    tone: 'rose', icon: AlertCircle, title: 'Subscription payment failed',
    body: 'Last subscription renewal could not be charged. Add funds and we\'ll retry on the next cycle.',
    action: <DarkBtn size="sm" variant="primary" onClick={onTopUp}>Add Funds</DarkBtn>,
  });
  if (lowBalance && wallet) items.push({
    tone: 'amber', icon: AlertTriangle, title: 'Low wallet balance',
    body: `Balance is ${formatINR(wallet.balance)} (alert ${formatINR(wallet.low_balance_threshold)}). Top up to avoid call interruptions.`,
    action: <DarkBtn size="sm" variant="cyan-outline" onClick={onTopUp}>Top up</DarkBtn>,
  });
  if (cancelAtPeriodEnd && renewal) items.push({
    tone: 'cyan', icon: AlertCircle, title: 'Subscription set to cancel',
    body: `Your plan will end on ${formatDateShort(renewal)}. Re-activate by upgrading to any plan before that date.`,
  });
  if (items.length === 0) return null;
  const tone: Record<typeof items[number]['tone'], string> = {
    rose: 'bg-rose-500/[0.07] border-rose-500/30 text-rose-700',
    amber: 'bg-amber-500/[0.07] border-amber-500/30 text-amber-700',
    cyan: 'bg-cyan-500/[0.05] border-cyan-500/20 text-cyan-700',
  };
  const iconCls: Record<typeof items[number]['tone'], string> = {
    rose: 'text-rose-600', amber: 'text-amber-600', cyan: 'text-cyan-600',
  };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className={`flex items-start gap-3 p-4 rounded-xl border ${tone[it.tone]}`}>
          <it.icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${iconCls[it.tone]}`} />
          <div className="flex-1">
            <p className="text-sm font-semibold">{it.title}</p>
            <p className="text-sm mt-0.5 opacity-90">{it.body}</p>
          </div>
          {it.action}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────── Modals (light, since they live above the dark panel) ──────────────────────────

function AddFundsModal({
  isOpen, onClose, paymentMethods, onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  paymentMethods: PaymentMethod[];
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState<number>(1000);
  const [pm, setPm] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (isOpen) {
      setAmount(1000);
      const def = paymentMethods.find((m) => m.is_default) || paymentMethods[0];
      setPm(def?.id || '');
    }
  }, [isOpen, paymentMethods]);

  async function submit() {
    if (amount <= 0) return;
    setSubmitting(true);
    try {
      await billingApi.addFunds(amount, pm || undefined);
      onSuccess();
    } catch (err: any) {
      toast.addToast(err?.response?.data?.error || 'Add funds failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Funds to Wallet" size="md">
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Amount (INR)</label>
          <Input
            type="number"
            min={100}
            step={100}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {TOPUP_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  amount === v ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {formatINR(v)}
              </button>
            ))}
          </div>
        </div>

        {paymentMethods.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Pay with</label>
            <select
              value={pm}
              onChange={(e) => setPm(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.type === 'upi'
                    ? `UPI · ${m.upi_id}`
                    : `${m.brand?.toUpperCase() || 'Card'} •••• ${m.last4}`}
                  {m.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {paymentMethods.length === 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-50 border border-warning-200 text-sm text-warning-900">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>No payment method on file. The mock provider auto-succeeds in dev. In production you'd add one first.</div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
          <button
            onClick={submit}
            disabled={amount <= 0 || submitting}
            className="h-10 px-5 rounded-lg text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-600 text-gray-900 hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Pay {formatINR(amount)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddPaymentMethodModal({
  isOpen, onClose, onSuccess,
}: { isOpen: boolean; onClose: () => void; onSuccess: () => void }) {
  const [type, setType] = useState<'card' | 'upi'>('card');
  const [brand, setBrand] = useState('visa');
  const [last4, setLast4] = useState('');
  const [holder, setHolder] = useState('');
  const [expM, setExpM] = useState<number>(12);
  const [expY, setExpY] = useState<number>(new Date().getFullYear() + 2);
  const [upi, setUpi] = useState('');
  const [setDefault, setSetDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (isOpen) {
      setType('card'); setBrand('visa'); setLast4(''); setHolder('');
      setExpM(12); setExpY(new Date().getFullYear() + 2);
      setUpi(''); setSetDefault(true);
    }
  }, [isOpen]);

  async function submit() {
    setSubmitting(true);
    try {
      await billingApi.addPaymentMethod(
        type === 'card'
          ? { type, brand, last4, holder_name: holder, exp_month: expM, exp_year: expY, set_default: setDefault }
          : { type, upi_id: upi, set_default: setDefault }
      );
      onSuccess();
    } catch (err: any) {
      toast.addToast(err?.response?.data?.error || 'Failed to add', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const valid = type === 'card'
    ? /^\d{4}$/.test(last4) && brand && holder.trim().length > 0
    : /^[\w.-]+@[\w.-]+$/.test(upi);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Payment Method" size="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          {(['card', 'upi'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border ${
                type === t ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'card' ? 'Card' : 'UPI'}
            </button>
          ))}
        </div>

        {type === 'card' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Brand</label>
                <select className="w-full h-10 px-3 rounded-lg border border-gray-300 text-sm" value={brand} onChange={(e) => setBrand(e.target.value)}>
                  <option value="visa">Visa</option>
                  <option value="mastercard">Mastercard</option>
                  <option value="amex">Amex</option>
                  <option value="rupay">RuPay</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last 4 digits</label>
                <Input maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cardholder name</label>
              <Input value={holder} onChange={(e) => setHolder(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Exp month</label>
                <Input type="number" min={1} max={12} value={expM} onChange={(e) => setExpM(Number(e.target.value))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Exp year</label>
                <Input type="number" min={new Date().getFullYear()} value={expY} onChange={(e) => setExpY(Number(e.target.value))} />
              </div>
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">UPI ID</label>
            <Input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@bank" />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} className="rounded" />
          Make this my default payment method
        </label>

        <div className="text-xs text-gray-400 flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          Card details are tokenized via the payment gateway — we never store the full PAN. (Mock provider in dev.)
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="h-10 px-5 rounded-lg text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-600 text-gray-900 hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add method
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PlanChangeModal({
  plan, currentPlanId, onClose, onConfirm,
}: { plan: Plan | null; currentPlanId?: string; onClose: () => void; onConfirm: () => void }) {
  if (!plan) return null;
  if (plan.custom) {
    return (
      <Modal isOpen={!!plan} onClose={onClose} title="Contact us — Enterprise" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            For Enterprise pricing reach out to <a href="mailto:sales@example.com" className="text-cyan-600 underline">sales@example.com</a>.
            We'll get back within one business day with a custom quote (volume discounts, dedicated infra, custom contracts).
          </p>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Close</button>
            <button onClick={onConfirm} className="h-10 px-5 rounded-lg text-sm font-semibold bg-cyan-500 text-gray-900 hover:bg-cyan-400">OK</button>
          </div>
        </div>
      </Modal>
    );
  }
  const order: Record<string, number> = { free: 0, starter: 1, jump_starter: 2, early: 3, growth: 4, enterprise: 5 };
  const isUpgrade = (order[plan.id] ?? 0) > (order[currentPlanId || 'free'] ?? 0);
  return (
    <Modal isOpen={!!plan} onClose={onClose} title={`${isUpgrade ? 'Upgrade to' : 'Switch to'} ${plan.name}`} size="md">
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200">
          <p className="text-sm text-gray-600">{isUpgrade ? 'You\'ll be charged today.' : 'Plan switch takes effect immediately.'}</p>
          <div className="flex items-end gap-2 mt-2">
            <p className="text-3xl font-bold text-gray-900">{formatINR(plan.price)}</p>
            <p className="text-sm text-gray-500 mb-1">/month</p>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
            {plan.features.highlights.slice(0, 4).map((h) => (
              <li key={h} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-cyan-600" />{h}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-gray-500">
          We'll attempt the charge through your default payment method. If that fails, the change is rolled back.
        </p>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={onConfirm} className="h-10 px-5 rounded-lg text-sm font-semibold bg-cyan-500 text-gray-900 hover:bg-cyan-400">Confirm</button>
        </div>
      </div>
    </Modal>
  );
}

function CancelSubscriptionModal({
  isOpen, renewal, onClose, onConfirm,
}: { isOpen: boolean; renewal?: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cancel subscription?" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Your plan will stay active until <span className="font-semibold">{renewal ? formatDateShort(renewal) : 'the end of this period'}</span>,
          then automatically downgrade to the Free plan. You won't be charged again unless you re-activate.
        </p>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Keep plan</button>
          <button onClick={onConfirm} className="h-10 px-5 rounded-lg text-sm font-semibold bg-rose-600 text-gray-900 hover:bg-rose-500">Yes, cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function ModelsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const models = [
    { type: 'STT', items: ['Deepgram Nova-2', 'Sarvam Saarika v2.5', 'Azure Speech', 'OpenAI Whisper'] },
    { type: 'TTS', items: ['Deepgram Aura', 'Sarvam Bulbul v2', 'ElevenLabs', 'Cartesia'] },
    { type: 'LLM', items: ['Google Gemini 2.5', 'Anthropic Claude Opus 4.7', 'OpenAI GPT', 'Sarvam-M'] },
  ];
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Available Voice AI Models" size="lg">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {models.map((g) => (
          <div key={g.type}>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">{g.type}</p>
            <ul className="space-y-1.5">
              {g.items.map((m) => (
                <li key={m} className="flex items-center gap-2 text-sm text-gray-700">
                  <Check className="h-3.5 w-3.5 text-cyan-600" />{m}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-4">
        Mix and match per-agent in <NavLink to="/agents" className="text-cyan-600 underline">Voice Agents</NavLink>.
      </p>
    </Modal>
  );
}

function InvoiceModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  if (!invoice) return null;

  function printInvoice() {
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) return;
    const rows = invoice!.line_items.map((li) =>
      `<tr><td>${escapeHtml(li.description)}</td><td style="text-align:right">₹${(li.amount).toFixed(2)}</td></tr>`
    ).join('');
    w.document.write(`<!doctype html><html><head><title>${invoice!.invoice_no}</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:48px;color:#111}
        h1{margin:0 0 4px;font-size:24px}.muted{color:#666;font-size:13px}
        table{width:100%;border-collapse:collapse;margin:24px 0}
        th,td{padding:10px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
        .totals{margin-left:auto;width:280px}.totals td{border:none;padding:6px 10px}
        .total-row td{border-top:2px solid #000;font-weight:700;padding-top:10px}
        .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;text-transform:uppercase}
        .ok{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}
      </style></head><body>
      <h1>Invoice ${escapeHtml(invoice!.invoice_no)}</h1>
      <p class="muted">Issued ${escapeHtml(formatDate(invoice!.created_at))}
      <span class="badge ${invoice!.status === 'paid' ? 'ok' : 'fail'}">${escapeHtml(invoice!.status)}</span></p>
      <p class="muted">${escapeHtml(invoice!.reason)}</p>
      <table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <table class="totals">
        <tr><td>Subtotal</td><td style="text-align:right">₹${invoice!.subtotal.toFixed(2)}</td></tr>
        <tr><td>GST (${invoice!.tax_rate}%)</td><td style="text-align:right">₹${invoice!.tax.toFixed(2)}</td></tr>
        <tr class="total-row"><td>Total</td><td style="text-align:right">₹${invoice!.total_amount.toFixed(2)}</td></tr>
      </table>
      <p class="muted" style="margin-top:48px">Thank you for your business.</p>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Modal isOpen={!!invoice} onClose={onClose} title={`Invoice ${invoice.invoice_no}`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{invoice.reason}</p>
            <p className="text-xs text-gray-400 mt-0.5">Issued {formatDate(invoice.created_at)}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            invoice.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          }`}>{invoice.status}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.line_items.map((li, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2.5 text-gray-700">{li.description}</td>
                <td className="py-2.5 text-right font-semibold text-gray-900">{formatINR(li.amount)}</td>
              </tr>
            ))}
            <tr><td className="pt-3 text-gray-500">Subtotal</td><td className="pt-3 text-right text-gray-700">{formatINR(invoice.subtotal)}</td></tr>
            <tr><td className="text-gray-500">GST ({invoice.tax_rate}%)</td><td className="text-right text-gray-700">{formatINR(invoice.tax)}</td></tr>
            <tr className="font-bold text-gray-900 border-t-2 border-gray-300">
              <td className="pt-2">Total</td><td className="pt-2 text-right">{formatINR(invoice.total_amount)}</td>
            </tr>
          </tbody>
        </table>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Close</button>
          <button onClick={printInvoice} className="h-10 px-5 rounded-lg text-sm font-semibold bg-cyan-500 text-gray-900 hover:bg-cyan-400 inline-flex items-center gap-2">
            <Printer className="h-4 w-4" />Print / Save as PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
