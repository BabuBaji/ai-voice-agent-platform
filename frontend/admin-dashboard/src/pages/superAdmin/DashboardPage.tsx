import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, PhoneCall, Bot, Wallet, AlertTriangle, TrendingUp, Loader2,
  Activity, ArrowRight, RefreshCcw, IndianRupee, Sparkles, Zap, Heart,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, PieChart, Pie, Cell, BarChart, ScatterChart, Scatter,
  ZAxis, RadialBarChart, RadialBar, AreaChart, Area,
} from 'recharts';
import {
  superAdminApi,
  type DashboardSummary, type DashboardTimeseries,
} from '@/services/superAdmin.api';
import { kindMeta, relativeTime, collapseRepeats } from '@/utils/activityFormat';

// Advanced analytics dashboard. Uses Promise.allSettled so any missing
// endpoint hides its panel instead of breaking the page. Auto-refreshes
// every 60s; user can also bump the manual refresh tick.

type Range = 7 | 14 | 30;

const COLORS = {
  amber: '#f59e0b',
  orange: '#f97316',
  sky: '#0ea5e9',
  cyan: '#06b6d4',
  emerald: '#10b981',
  teal: '#14b8a6',
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  rose: '#f43f5e',
  slate: '#64748b',
};

const PIE_PALETTE = [
  COLORS.amber, COLORS.sky, COLORS.emerald, COLORS.violet,
  COLORS.rose, COLORS.cyan, COLORS.fuchsia, COLORS.teal,
];

type Accent = 'amber' | 'sky' | 'emerald' | 'rose' | 'violet';
const accentMap: Record<Accent, string> = {
  amber:   'from-amber-500 to-orange-500',
  sky:     'from-sky-500 to-cyan-500',
  emerald: 'from-emerald-500 to-teal-500',
  rose:    'from-rose-500 to-pink-500',
  violet:  'from-violet-500 to-purple-500',
};

function StatLink({
  to, icon: Icon, label, value, sub, accent = 'amber', spark,
}: {
  to: string; icon: any; label: string; value: string | number; sub?: string;
  accent?: Accent; spark?: number[];
}) {
  const sparkData = spark?.map((v, i) => ({ i, v })) ?? null;
  return (
    <Link to={to} className="group bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-slate-900 mt-1 truncate">{value}</p>
          {sub && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</p>}
        </div>
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${accentMap[accent]} flex items-center justify-center shadow-md flex-shrink-0`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </div>
      {sparkData && sparkData.length > 1 && (
        <div className="h-7 -mx-1 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData}>
              <defs>
                <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS[accent === 'amber' ? 'amber' : accent === 'sky' ? 'sky' : accent === 'emerald' ? 'emerald' : accent === 'rose' ? 'rose' : 'violet']} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS[accent === 'amber' ? 'amber' : accent === 'sky' ? 'sky' : accent === 'emerald' ? 'emerald' : accent === 'rose' ? 'rose' : 'violet']} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={COLORS[accent === 'amber' ? 'amber' : accent === 'sky' ? 'sky' : accent === 'emerald' ? 'emerald' : accent === 'rose' ? 'rose' : 'violet']} fill={`url(#spark-${accent})`} strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[10px] text-slate-400 mt-1 inline-flex items-center gap-1 group-hover:text-amber-700">
        Drill in <ArrowRight className="h-3 w-3" />
      </p>
    </Link>
  );
}

function Panel({ title, sub, right, children, className = '' }: {
  title: string; sub?: string; right?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-3 shadow-sm ${className}`}>
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{title}</h3>
          {sub && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function PanelEmpty({ msg = 'No data yet' }: { msg?: string }) {
  return <div className="h-32 flex items-center justify-center text-xs text-slate-400">{msg}</div>;
}

const tooltipStyle = {
  contentStyle: { background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 12, padding: 10 },
  itemStyle: { color: '#334155' },
  labelStyle: { color: '#64748b', fontWeight: 600, marginBottom: 4 },
};

export function SuperAdminDashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [series, setSeries] = useState<DashboardTimeseries | null>(null);
  const [recent, setRecent] = useState<any[] | null>(null);
  const [callsStats, setCallsStats] = useState<any | null>(null);
  const [tenantsStats, setTenantsStats] = useState<any | null>(null);
  const [agentsStats, setAgentsStats] = useState<any | null>(null);
  const [subs, setSubs] = useState<any | null>(null);
  const [health, setHealth] = useState<any | null>(null);
  const [cost, setCost] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(14);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [s, t, a, cs, ts, ags, sb, h, co] = await Promise.allSettled([
        superAdminApi.dashboard(),
        superAdminApi.timeseries(),
        superAdminApi.globalActivityFeed({ hours: 24, limit: 12 }),
        superAdminApi.callsStats(),
        superAdminApi.tenantsStats(),
        superAdminApi.agentsStats(),
        superAdminApi.subscriptions(),
        superAdminApi.healthScores(),
        superAdminApi.costAnalysis(),
      ]);
      if (s.status === 'fulfilled') setSummary(s.value);
      else if (!silent) setError(s.reason?.response?.data?.error || s.reason?.message || 'Failed to load dashboard');
      if (t.status === 'fulfilled') setSeries(t.value);
      if (a.status === 'fulfilled') setRecent(a.value.events);
      if (cs.status === 'fulfilled') setCallsStats(cs.value);
      if (ts.status === 'fulfilled') setTenantsStats(ts.value);
      if (ags.status === 'fulfilled') setAgentsStats(ags.value);
      if (sb.status === 'fulfilled') setSubs(sb.value);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (co.status === 'fulfilled') setCost(co.value);
      setLastRefreshed(new Date());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const callsSeries = useMemo(() => {
    const days = series?.days || [];
    return days.slice(-range).map((d) => ({
      day: d.day.slice(5, 10),
      fullDay: d.day.slice(0, 10),
      calls: d.calls,
      minutes: d.minutes,
    }));
  }, [series, range]);

  const callsSpark = useMemo(() => callsSeries.map((d) => d.calls), [callsSeries]);

  const statusData = useMemo(() => {
    return (callsStats?.by_status || []).map((r: any) => ({ name: r.status || 'unknown', value: Number(r.n) || 0 }));
  }, [callsStats]);

  const channelData = useMemo(() => {
    return (callsStats?.by_channel || []).map((r: any) => ({ name: r.channel || 'unknown', value: Number(r.n) || 0 }));
  }, [callsStats]);

  const planDistribution = useMemo(() => {
    const dist = subs?.plan_distribution || tenantsStats?.plan_distribution || [];
    return dist.map((r: any) => ({
      plan: r.plan_name || r.plan || 'unknown',
      tenants: Number(r.tenant_count ?? r.n ?? 0),
      mrr: Number(r.mrr_contribution ?? 0),
    }));
  }, [subs, tenantsStats]);

  const providerData = useMemo(() => {
    return (agentsStats?.by_provider || []).map((r: any) => ({
      provider: r.llm_provider || 'unknown',
      agents: Number(r.n) || 0,
    }));
  }, [agentsStats]);

  const topTenantsCalls = useMemo(() => {
    return (callsStats?.top_tenants_7d || []).slice(0, 7).map((r: any) => ({
      id: r.tenant_id,
      name: r.tenant_name || (r.tenant_id ? r.tenant_id.slice(0, 8) : 'unknown'),
      calls: Number(r.n) || 0,
    }));
  }, [callsStats]);

  const healthScatter = useMemo(() => {
    const rows = health?.data || [];
    return rows.map((r: any) => ({
      tenant_id: r.tenant_id,
      tenant_name: r.tenant_name,
      x: Number(r.calls_7d) || 0,
      y: Number(r.balance) || 0,
      z: Math.max(40, (Number(r.score) || 0) * 6),
      flag: r.flag,
      score: r.score,
    }));
  }, [health]);

  const costRows = useMemo(() => {
    const rows = cost?.data || [];
    return rows
      .filter((r: any) => (r.calls || 0) > 0)
      .sort((a: any, b: any) => (b.revenue_inr || 0) - (a.revenue_inr || 0))
      .slice(0, 8)
      .map((r: any) => ({
        name: r.tenant_name || (r.tenant_id ? r.tenant_id.slice(0, 8) : 'unknown'),
        cost: Math.round(r.cost_inr || 0),
        revenue: Math.round(r.revenue_inr || 0),
        margin: Math.round(r.margin_inr || 0),
      }));
  }, [cost]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>;
  if (error || !summary) return <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">{error}</div>;

  const today = new Date().toISOString().slice(0, 10);
  const mrr = subs?.totals?.mrr ?? 0;
  const arr = subs?.totals?.arr ?? 0;
  const paidCount = subs?.totals?.paid_count ?? 0;
  const greenN = (health?.data || []).filter((r: any) => r.flag === 'green').length;
  const yellowN = (health?.data || []).filter((r: any) => r.flag === 'yellow').length;
  const redN = (health?.data || []).filter((r: any) => r.flag === 'red').length;
  const healthRadial = [
    { name: 'Healthy', value: greenN, fill: COLORS.emerald },
    { name: 'Watch', value: yellowN, fill: COLORS.amber },
    { name: 'At Risk', value: redN, fill: COLORS.rose },
  ];

  return (
    <div className="space-y-3">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Platform analytics
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Live overview · auto-refreshes every 60s · click anything to drill in</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>updated {relativeTime(lastRefreshed.toISOString())}</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 hover:border-amber-400 hover:text-amber-700 text-slate-600 transition disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCcw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatLink to="/super-admin/tenants" icon={Building2} label="Total Tenants" value={summary.tenants.total}
          sub={`${summary.tenants.active} active · +${summary.tenants.new_today} today`} accent="amber" />
        <StatLink to={`/super-admin/calls?since=${today}`} icon={PhoneCall} label="Calls Today" value={summary.calls.today}
          sub={`${summary.calls.minutes_today}m talk time`} accent="sky" spark={callsSpark} />
        <StatLink to="/super-admin/agents?status=ACTIVE" icon={Bot} label="Active Agents" value={summary.agents.active}
          sub={`${summary.agents.total} total`} accent="emerald" />
        <StatLink to="/super-admin/billing" icon={Wallet} label="Wallet Float" value={`₹${summary.revenue.total_wallet_balance_inr.toLocaleString()}`}
          sub={`${summary.revenue.wallet_count} wallets`} accent="violet" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatLink to="/super-admin/subscriptions" icon={IndianRupee} label="MRR" value={`₹${Number(mrr).toLocaleString()}`}
          sub={`${paidCount} paid plans`} accent="emerald" />
        <StatLink to="/super-admin/subscriptions" icon={TrendingUp} label="ARR (projected)" value={`₹${Number(arr).toLocaleString()}`}
          sub="MRR × 12" accent="violet" />
        <StatLink to={`/super-admin/calls?status=FAILED&since=${today}`} icon={AlertTriangle} label="Failed Today" value={summary.calls.failed_today}
          sub={summary.calls.failed_today === 0 ? 'no failures' : 'investigate'} accent="rose" />
        <StatLink to="/super-admin/tenants?status=active" icon={Zap} label="New This Month" value={summary.tenants.new_month}
          sub="signups" accent="amber" />
      </div>

      {/* ── Calls/day composed chart ───────────────────────────── */}
      <Panel
        title="Calls & talk-time"
        sub={`Last ${range} days · click a bar to filter the call list`}
        right={
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5 text-[11px] font-medium">
            {[7, 14, 30].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r as Range)}
                className={`px-2.5 py-1 rounded-md transition ${range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >{r}d</button>
            ))}
          </div>
        }
      >
        {callsSeries.length === 0 ? <PanelEmpty msg="No call data yet" /> : (
          <div className="h-56">
            <ResponsiveContainer>
              <ComposedChart data={callsSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                onClick={(e: any) => e?.activePayload?.[0]?.payload?.fullDay && navigate(`/super-admin/calls?since=${e.activePayload[0].payload.fullDay}`)}
              >
                <defs>
                  <linearGradient id="callsBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.amber} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={COLORS.orange} stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} />
                <Tooltip {...tooltipStyle} cursor={{ fill: '#fef3c7', opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="calls" name="Calls" fill="url(#callsBar)" radius={[6, 6, 0, 0]} cursor="pointer" />
                <Line yAxisId="right" type="monotone" dataKey="minutes" name="Minutes" stroke={COLORS.sky} strokeWidth={2.5} dot={{ r: 3, fill: COLORS.sky }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {/* ── Status / Channel / Provider ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Panel title="Calls by status" sub="Lifetime distribution">
          {statusData.length === 0 ? <PanelEmpty /> : (
            <div className="h-44">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {statusData.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} stroke="white" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Calls by channel" sub="Voice · Web · Chat">
          {channelData.length === 0 ? <PanelEmpty /> : (
            <div className="h-44">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={channelData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(e: any) => `${e.name}`} labelLine={false}>
                    {channelData.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_PALETTE[(i + 2) % PIE_PALETTE.length]} stroke="white" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Tenant health" sub={`${greenN} healthy · ${yellowN} watch · ${redN} at risk`}
          right={<Heart className="h-4 w-4 text-rose-400" />}>
          {(greenN + yellowN + redN) === 0 ? <PanelEmpty /> : (
            <div className="h-44">
              <ResponsiveContainer>
                <RadialBarChart innerRadius="30%" outerRadius="100%" data={healthRadial} startAngle={90} endAngle={-270}>
                  <RadialBar background dataKey="value" cornerRadius={8} />
                  <Tooltip {...tooltipStyle} />
                  <Legend iconSize={10} layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: 11 }} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Plans + LLM provider + Top tenants ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Panel title="Plan distribution" sub="Tenants per plan">
          {planDistribution.length === 0 ? <PanelEmpty /> : (
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={planDistribution} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                  onClick={(e: any) => e?.activePayload && navigate('/super-admin/subscriptions')}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="plan" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="tenants" radius={[6, 6, 0, 0]} cursor="pointer">
                    {planDistribution.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="LLM provider mix" sub="Agents per provider">
          {providerData.length === 0 ? <PanelEmpty /> : (
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={providerData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                  <YAxis type="category" dataKey="provider" stroke="#94a3b8" fontSize={11} width={70} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="agents" radius={[0, 6, 6, 0]}>
                    {providerData.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_PALETTE[(i + 1) % PIE_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Top tenants · last 7d" sub="By call volume">
          {topTenantsCalls.length === 0 ? <PanelEmpty /> : (
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={topTenantsCalls} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
                  onClick={(e: any) => e?.activePayload?.[0]?.payload?.id && navigate(`/super-admin/tenants/${e.activePayload[0].payload.id}`)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={90} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#fef3c7', opacity: 0.4 }} />
                  <Bar dataKey="calls" fill={COLORS.amber} radius={[0, 6, 6, 0]} cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Health scatter + Cost vs Revenue ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="Tenant engagement vs wallet" sub="Bubble size = health score · click to inspect">
          {healthScatter.length === 0 ? <PanelEmpty /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 5, left: 0 }}
                  onClick={(e: any) => e?.activePayload?.[0]?.payload?.tenant_id && navigate(`/super-admin/tenants/${e.activePayload[0].payload.tenant_id}`)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" dataKey="x" name="Calls 7d" stroke="#94a3b8" fontSize={11} />
                  <YAxis type="number" dataKey="y" name="Wallet ₹" stroke="#94a3b8" fontSize={11} />
                  <ZAxis type="number" dataKey="z" range={[40, 400]} />
                  <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3' }}
                    formatter={(v: any, name: string, p: any) => {
                      if (name === 'Calls 7d') return [v, 'Calls (7d)'];
                      if (name === 'Wallet ₹') return [`₹${Number(v).toLocaleString()}`, 'Balance'];
                      return [v, name];
                    }}
                    labelFormatter={(_: any, p: any) => p?.[0]?.payload?.tenant_name || ''}
                  />
                  <Scatter data={healthScatter.filter((d: any) => d.flag === 'green')} fill={COLORS.emerald} fillOpacity={0.7} name="Healthy" cursor="pointer" />
                  <Scatter data={healthScatter.filter((d: any) => d.flag === 'yellow')} fill={COLORS.amber} fillOpacity={0.7} name="Watch" cursor="pointer" />
                  <Scatter data={healthScatter.filter((d: any) => d.flag === 'red')} fill={COLORS.rose} fillOpacity={0.8} name="At risk" cursor="pointer" />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Cost vs revenue · top earners" sub="Margin shown as overlay">
          {costRows.length === 0 ? <PanelEmpty /> : (
            <div className="h-56">
              <ResponsiveContainer>
                <ComposedChart data={costRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => `₹${Number(v).toLocaleString()}`} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
                  <Bar dataKey="revenue" name="Revenue" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cost" name="Cost" fill={COLORS.rose} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="margin" name="Margin" stroke={COLORS.violet} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Recent activity ────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900">Recent platform activity</h3>
            <span className="text-[10px] text-slate-400">last 24h</span>
          </div>
          <Link to="/super-admin/activity" className="text-xs text-amber-700 hover:underline inline-flex items-center gap-1">
            See full feed <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {!recent || recent.length === 0 ? (
          <p className="text-sm text-slate-400 py-5 text-center">No activity in the last 24 hours.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {collapseRepeats(recent).slice(0, 8).map((e, i) => {
              const meta = kindMeta(e.kind);
              return (
                <li key={i} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-slate-50/50">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                    <meta.icon className={`h-3.5 w-3.5 ${meta.fg}`} />
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                    <p className="col-span-7 text-sm text-slate-800 truncate">
                      <span className="font-medium">{e.actor || e.summary}</span>
                      <span className="text-slate-500 font-normal">{e.action ? ` ${e.action}` : ''}</span>
                      {e.count > 1 && (
                        <span className="ml-2 text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          ×{e.count}
                        </span>
                      )}
                    </p>
                    <div className="col-span-3 text-xs text-slate-500 truncate">
                      {e.tenant_id ? (
                        <Link to={`/super-admin/tenants/${e.tenant_id}`} className="text-amber-700 hover:underline truncate">
                          {e.tenant_name || e.tenant_id.slice(0, 8)}
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </div>
                    <p className="col-span-2 text-right text-[11px] text-slate-500 font-mono whitespace-nowrap" title={new Date(e.ts).toLocaleString()}>
                      {relativeTime(e.ts)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ── Quick links ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Link to="/super-admin/tenants" className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-slate-700">Manage tenants →</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Suspend, impersonate, adjust wallet</p>
        </Link>
        <Link to="/super-admin/audit-logs" className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-slate-700">Audit log →</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Every super-admin action</p>
        </Link>
        <Link to="/super-admin/integrations" className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow">
          <p className="text-sm font-medium text-slate-700">Integrations →</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Provider keys + tenant installs</p>
        </Link>
      </div>
    </div>
  );
}
