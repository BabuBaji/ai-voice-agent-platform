import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, Clock, Activity, Users, Calendar, AlertCircle, Loader2,
  BarChart3, LineChart as LineIcon, AreaChart as AreaIcon, PieChart as PieIcon,
  TrendingUp, TrendingDown, DollarSign, CheckCircle2, Smile, Frown, Meh,
  Zap, Target, Timer, ArrowUpRight, ArrowDownRight, Minus, Download,
  Sun, Moon, Sunrise, Sunset,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import {
  analyticsApi,
  type AnalyticsSummary,
  type TimeseriesPoint,
  type OutcomePoint,
  type AgentRow,
  type AnalyticsFilter,
  type SentimentPoint,
  type HourlyPoint,
  type DurationBucket,
  type PerformanceData,
} from '@/services/analytics.api';
import { agentApi } from '@/services/agent.api';

type ChannelTab = 'phone' | 'web';
type ChartTab = 'volume' | 'duration';
type ChartKind = 'bar' | 'line' | 'area';

const PIE_COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899', '#64748b'];
const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10b981', NEGATIVE: '#ef4444', NEUTRAL: '#f59e0b', UNKNOWN: '#94a3b8',
};
const DURATION_COLORS = ['#06b6d4', '#0d9488', '#6366f1', '#a855f7', '#ec4899'];

const DAY_PRESETS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function fmtShortDate(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function fmtMin(sec: number): string {
  return (sec / 60).toFixed(1);
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function AnimatedNumber({ value, suffix = '', prefix = '', decimals = 0 }: {
  value: number; suffix?: string; prefix?: string; decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    const duration = 800;
    const startTime = performance.now();
    let raf: number;

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) raf = requestAnimationFrame(animate);
    }

    raf = requestAnimationFrame(animate);
    prevRef.current = end;
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className="tabular-nums">
      {prefix}{decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString()}{suffix}
    </span>
  );
}

function SectionHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-glow">
        {icon}
      </div>
      <div>
        <h2 className="font-display text-lg font-bold text-gray-900 tracking-tight">{title}</h2>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

function HourLabel({ hour }: { hour: number }) {
  if (hour === 0) return <span className="inline-flex items-center gap-0.5"><Moon className="h-3 w-3" />12a</span>;
  if (hour === 6) return <span className="inline-flex items-center gap-0.5"><Sunrise className="h-3 w-3" />6a</span>;
  if (hour === 12) return <span className="inline-flex items-center gap-0.5"><Sun className="h-3 w-3" />12p</span>;
  if (hour === 18) return <span className="inline-flex items-center gap-0.5"><Sunset className="h-3 w-3" />6p</span>;
  return <span>{hour > 12 ? `${hour - 12}p` : hour === 0 ? '12a' : `${hour}a`}</span>;
}

export function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const [agentId, setAgentId] = useState<string>('');
  const [channelTab, setChannelTab] = useState<ChannelTab>('phone');
  const [chartTab, setChartTab] = useState<ChartTab>('volume');
  const [chartKind, setChartKind] = useState<ChartKind>('bar');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomePoint[]>([]);
  const [agentStats, setAgentStats] = useState<AgentRow[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [sentimentData, setSentimentData] = useState<SentimentPoint[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyPoint[]>([]);
  const [durationData, setDurationData] = useState<DurationBucket[]>([]);
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);

  useEffect(() => {
    agentApi.list().then((a: any) => {
      const arr = Array.isArray(a) ? a : a?.data || [];
      setAgents(arr.map((x: any) => ({ id: x.id, name: x.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const filter: AnalyticsFilter = {
      days,
      agent_id: agentId || undefined,
      channel: channelTab === 'phone' ? 'PHONE' : 'WEB',
    };
    Promise.allSettled([
      analyticsApi.summary(filter),
      analyticsApi.timeseries(filter),
      analyticsApi.outcomes(filter),
      analyticsApi.agents(),
      analyticsApi.sentiment(filter),
      analyticsApi.hourlyDistribution(filter),
      analyticsApi.durationDistribution(filter),
      analyticsApi.performance(filter),
    ]).then((rs) => {
      if (cancelled) return;
      if (rs[0].status === 'fulfilled') setSummary(rs[0].value);
      if (rs[1].status === 'fulfilled') setTimeseries(rs[1].value);
      if (rs[2].status === 'fulfilled') setOutcomes(rs[2].value);
      if (rs[3].status === 'fulfilled') setAgentStats(rs[3].value);
      if (rs[4].status === 'fulfilled') setSentimentData(rs[4].value);
      if (rs[5].status === 'fulfilled') setHourlyData(rs[5].value);
      if (rs[6].status === 'fulfilled') setDurationData(rs[6].value);
      if (rs[7].status === 'fulfilled') setPerfData(rs[7].value);
      const rejected = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (rejected) setError(rejected.reason?.response?.data?.message || rejected.reason?.message || 'Analytics API error');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, agentId, channelTab]);

  const dateRangeLabel = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    const fmt = (d: Date) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${fmt(start)} — ${fmt(end)}`;
  }, [days]);

  const totalCalls = summary?.total_calls ?? 0;
  const totalDurationMin = summary?.total_duration_minutes ?? 0;
  const avgDurationSec = summary?.avg_duration_seconds ?? 0;
  const totalAssistants = agents.length;
  const resolutionRate = summary?.resolution_rate_pct ?? 0;
  const costPerCall = summary?.cost_per_call ?? 0;
  const callsPerDay = perfData?.calls_per_day ?? 0;
  const sentimentScore = perfData?.sentiment_score ?? 0;

  const chartData = timeseries.map((p) => ({
    date: fmtShortDate(p.date),
    calls: p.calls,
    duration: +(p.avg_duration / 60).toFixed(2),
  }));

  const topAgents = useMemo(
    () => [...agentStats]
      .sort((a, b) => b.total_calls - a.total_calls)
      .slice(0, 6)
      .map((a) => ({
        name: a.agent_name && a.agent_name.length > 18 ? a.agent_name.slice(0, 18) + '…' : a.agent_name || 'Agent',
        calls: a.total_calls,
        success_pct: Math.round((a.success_rate || 0) * 100),
        avg_duration: a.average_duration_seconds,
      })),
    [agentStats],
  );

  const agentRadarData = useMemo(() => {
    if (agentStats.length === 0) return [];
    return agentStats.slice(0, 5).map((a) => ({
      agent: a.agent_name?.slice(0, 12) || 'Agent',
      calls: a.total_calls,
      success: Math.round((a.success_rate || 0) * 100),
      duration: Math.round(a.average_duration_seconds / 60),
    }));
  }, [agentStats]);

  const peakHour = useMemo(() => {
    if (hourlyData.length === 0) return null;
    return hourlyData.reduce((max, h) => h.calls > max.calls ? h : max, hourlyData[0]);
  }, [hourlyData]);

  const dataKey = chartTab === 'volume' ? 'calls' : 'duration';
  const dataName = chartTab === 'volume' ? 'calls' : 'minutes';

  const sentimentTotal = sentimentData.reduce((s, d) => s + d.count, 0);

  const radialSentiment = useMemo(() => {
    if (!perfData) return [];
    return [
      { name: 'Resolution', value: perfData.resolution_rate, fill: '#6366f1' },
      { name: 'Sentiment', value: perfData.sentiment_score, fill: '#10b981' },
    ];
  }, [perfData]);

  return (
    <div className="max-w-[1440px] mx-auto space-y-8 pb-12">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-gray-900 tracking-tight">
            Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-lg">
            Deep-dive into call performance, agent efficiency, sentiment trends, and conversation quality.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-primary-50 text-primary-700 font-medium border border-primary-100">
            <Calendar className="h-3.5 w-3.5" /> {dateRangeLabel}
          </span>
        </div>
      </div>

      {/* ─── Filter bar ─── */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-white/80 backdrop-blur border border-gray-100 shadow-card">
        <div className="flex items-center gap-1 p-1 bg-gray-50 rounded-xl">
          {DAY_PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`text-xs px-3.5 py-1.5 rounded-lg font-semibold transition-all duration-200 ${
                days === p.days
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              {p.label}
            </button>
          ))}
          <CustomDatePicker days={days} setDays={setDays} dateRangeLabel={dateRangeLabel} />
        </div>

        <div className="h-6 w-px bg-gray-200 hidden sm:block" />

        <div className="inline-flex items-center gap-1 p-1 bg-gray-50 rounded-xl">
          <button
            onClick={() => setChannelTab('phone')}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all duration-200 ${
              channelTab === 'phone' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Phone className="h-3.5 w-3.5" /> Phone
          </button>
          <button
            onClick={() => setChannelTab('web')}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all duration-200 ${
              channelTab === 'web' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Activity className="h-3.5 w-3.5" /> Web Chat
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="min-w-[180px] text-xs font-medium border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 transition-shadow"
          >
            <option value="">All Assistants</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ─── KPI cards — 2 rows ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          label="Total Calls"
          value={loading ? null : totalCalls}
          icon={<Phone className="h-4 w-4" />}
          color="primary"
        />
        <KpiCard
          label="Calls / Day"
          value={loading ? null : callsPerDay}
          decimals={1}
          icon={<Zap className="h-4 w-4" />}
          color="cyan"
        />
        <KpiCard
          label="Total Duration"
          value={loading ? null : totalDurationMin}
          suffix=" min"
          decimals={1}
          icon={<Clock className="h-4 w-4" />}
          color="teal"
        />
        <KpiCard
          label="Avg Duration"
          value={loading ? null : parseFloat(fmtMin(avgDurationSec))}
          suffix=" min"
          decimals={1}
          icon={<Timer className="h-4 w-4" />}
          color="indigo"
        />
        <KpiCard
          label="Resolution"
          value={loading ? null : resolutionRate}
          suffix="%"
          decimals={1}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="success"
        />
        <KpiCard
          label="Sentiment"
          value={loading ? null : sentimentScore}
          suffix="%"
          decimals={1}
          icon={<Smile className="h-4 w-4" />}
          color="emerald"
        />
        <KpiCard
          label="Cost / Call"
          value={loading ? null : costPerCall}
          prefix="$"
          decimals={3}
          icon={<DollarSign className="h-4 w-4" />}
          color="amber"
        />
        <KpiCard
          label="Assistants"
          value={loading ? null : totalAssistants}
          icon={<Users className="h-4 w-4" />}
          color="purple"
        />
      </div>

      {/* ─── Performance gauge ring ─── */}
      {perfData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <h3 className="font-display text-sm font-bold text-gray-900 mb-4">Performance Score</h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  cx="50%" cy="50%" innerRadius="60%" outerRadius="90%"
                  startAngle={180} endAngle={0}
                  data={radialSentiment}
                  barSize={14}
                >
                  <RadialBar
                    dataKey="value"
                    cornerRadius={10}
                    background={{ fill: '#f1f5f9' }}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 -mt-4">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                <span className="text-xs text-gray-600">Resolution {perfData.resolution_rate}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success-500" />
                <span className="text-xs text-gray-600">Sentiment {perfData.sentiment_score}%</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <h3 className="font-display text-sm font-bold text-gray-900 mb-3">Duration Stats</h3>
            <div className="space-y-4 mt-2">
              <StatRow label="Average" value={fmtDuration(perfData.avg_duration)} icon={<Activity className="h-4 w-4 text-primary-500" />} />
              <StatRow label="Longest" value={fmtDuration(perfData.max_duration)} icon={<ArrowUpRight className="h-4 w-4 text-danger-500" />} />
              <StatRow label="Shortest" value={fmtDuration(perfData.min_duration)} icon={<ArrowDownRight className="h-4 w-4 text-success-500" />} />
              <StatRow label="Active Days" value={String(perfData.active_days)} icon={<Calendar className="h-4 w-4 text-amber-500" />} />
              <StatRow label="Active Agents" value={String(perfData.unique_agents)} icon={<Users className="h-4 w-4 text-purple-500" />} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <h3 className="font-display text-sm font-bold text-gray-900 mb-3">Sentiment Breakdown</h3>
            <div className="space-y-3 mt-2">
              <SentimentBar label="Positive" count={perfData.positive_count} total={perfData.total_calls} color="#10b981" icon={<Smile className="h-4 w-4" />} />
              <SentimentBar label="Neutral" count={perfData.neutral_count} total={perfData.total_calls} color="#f59e0b" icon={<Meh className="h-4 w-4" />} />
              <SentimentBar label="Negative" count={perfData.negative_count} total={perfData.total_calls} color="#ef4444" icon={<Frown className="h-4 w-4" />} />
              <div className="pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Sentiment Score</span>
                  <span className={`text-2xl font-display font-extrabold tabular-nums ${
                    perfData.sentiment_score >= 70 ? 'text-success-600' :
                    perfData.sentiment_score >= 40 ? 'text-amber-600' : 'text-danger-600'
                  }`}>
                    {perfData.sentiment_score}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Chart tabs + kind selector ─── */}
      <SectionHeader
        title="Call Trends"
        subtitle="Volume and duration patterns over time"
        icon={<TrendingUp className="h-5 w-5" />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-gray-50 rounded-xl border border-gray-100">
          <button
            onClick={() => setChartTab('volume')}
            className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition-all duration-200 ${
              chartTab === 'volume' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Call Volume
          </button>
          <button
            onClick={() => setChartTab('duration')}
            className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition-all duration-200 ${
              chartTab === 'duration' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Call Duration
          </button>
        </div>
        <div className="inline-flex items-center gap-1 p-1 bg-gray-50 rounded-xl border border-gray-100">
          {([
            { id: 'bar' as ChartKind, label: 'Bar', Icon: BarChart3 },
            { id: 'line' as ChartKind, label: 'Line', Icon: LineIcon },
            { id: 'area' as ChartKind, label: 'Area', Icon: AreaIcon },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setChartKind(id)}
              title={label}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 ${
                chartKind === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Main timeseries chart ─── */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
        <div className="mb-4">
          <h3 className="font-display text-base font-bold text-gray-900">
            {chartTab === 'volume' ? 'Call Volume Over Time' : 'Call Duration Over Time'}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {chartTab === 'volume'
              ? 'Number of calls per day in the selected period'
              : 'Average call duration per day (minutes)'}
          </p>
        </div>
        <div className="h-[380px]">
          {loading && chartData.length === 0 ? (
            <LoadingPlaceholder />
          ) : chartData.length === 0 ? (
            <EmptyPlaceholder message="No calls in this period." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {chartKind === 'bar' ? (
                <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 10, left: 0 }} barCategoryGap="25%">
                  <defs>
                    <linearGradient id="callsBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={1} />
                      <stop offset="60%" stopColor="#14b8a6" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0.85} />
                    </linearGradient>
                    <filter id="callsBarShadow" x="-10%" y="-10%" width="120%" height="120%">
                      <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0d9488" floodOpacity="0.18" />
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={false} />
                  <Tooltip cursor={false} contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                  <Bar dataKey={dataKey} name={dataName} fill="url(#callsBar)" radius={[8, 8, 0, 0]} maxBarSize={42} filter="url(#callsBarShadow)" />
                </BarChart>
              ) : chartKind === 'area' ? (
                <AreaChart data={chartData} margin={{ top: 20, right: 20, bottom: 10, left: 0 }}>
                  <defs>
                    <linearGradient id="callsArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.8} />
                      <stop offset="50%" stopColor="#0d9488" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ stroke: '#0d9488', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                  <Area
                    type="monotone" dataKey={dataKey} name={dataName}
                    stroke="#0d9488" strokeWidth={2} fill="url(#callsArea)" fillOpacity={1}
                    activeDot={{ r: 5, fill: '#0d9488', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 20, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="4 6" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ stroke: '#0d9488', strokeWidth: 1, strokeDasharray: '4 4' }} contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                  <Line
                    type="monotone" dataKey={dataKey} name={dataName}
                    stroke="#0d9488" strokeWidth={3}
                    dot={{ r: 5, fill: '#fff', stroke: '#0d9488', strokeWidth: 2.5 }}
                    activeDot={{ r: 7, fill: '#0d9488', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Outcomes + Top agents (existing) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outcomes pie/donut */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900 inline-flex items-center gap-1.5">
                <PieIcon className="h-4 w-4 text-primary-500" /> Call Outcomes
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">How calls ended in this period</p>
            </div>
          </div>
          {loading && outcomes.length === 0 ? (
            <LoadingPlaceholder height={320} />
          ) : outcomes.length === 0 ? (
            <EmptyPlaceholder message="No outcome data yet." height={320} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="relative h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Pie
                      data={outcomes} dataKey="count" nameKey="outcome"
                      cx="50%" cy="50%" innerRadius="50%" outerRadius="85%"
                      paddingAngle={3} stroke="#fff" strokeWidth={2}
                      labelLine={false} isAnimationActive
                    >
                      {outcomes.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} formatter={(value: any, name: any) => [value, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-2xl font-display font-extrabold text-gray-900 tabular-nums">
                      {outcomes.reduce((s, o) => s + o.count, 0)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">total calls</p>
                  </div>
                </div>
              </div>
              <div className="max-h-[280px] overflow-y-auto pr-1">
                <ul className="divide-y divide-gray-50">
                  {(() => {
                    const total = outcomes.reduce((s, o) => s + o.count, 0);
                    return outcomes.map((o, i) => {
                      const pct = total ? Math.round((o.count / total) * 100) : 0;
                      return (
                        <li key={o.outcome} className="flex items-center gap-2.5 py-2.5">
                          <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="flex-1 text-xs text-gray-700 truncate font-medium">{o.outcome}</span>
                          <span className="text-xs font-bold text-gray-900 tabular-nums">{o.count}</span>
                          <span className="text-[11px] text-gray-400 w-9 text-right tabular-nums">{pct}%</span>
                        </li>
                      );
                    });
                  })()}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Top agents — horizontal bar */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base font-bold text-gray-900 inline-flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-primary-500" /> Top Agents by Calls
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Top 6 agents — call count + success rate</p>
          </div>
          <div className="h-[320px]">
            {loading && topAgents.length === 0 ? (
              <LoadingPlaceholder height={320} />
            ) : topAgents.length === 0 ? (
              <EmptyPlaceholder message="No agent data yet." height={320} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={topAgents} margin={{ top: 10, right: 30, bottom: 10, left: 10 }} barCategoryGap="30%">
                  <defs>
                    <linearGradient id="agentBar" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity={0.95} />
                      <stop offset="60%" stopColor="#6366f1" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.95} />
                    </linearGradient>
                    <filter id="agentBarShadow" x="-5%" y="-10%" width="110%" height="120%">
                      <feDropShadow dx="2" dy="0" stdDeviation="3" floodColor="#6366f1" floodOpacity="0.18" />
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={false} />
                  <Tooltip cursor={false} contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                  <Bar dataKey="calls" name="calls" fill="url(#agentBar)" radius={[0, 8, 8, 0]} maxBarSize={26} filter="url(#agentBarShadow)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ─── NEW: Hourly Distribution + Duration Distribution ─── */}
      <SectionHeader
        title="Distribution Analysis"
        subtitle="When calls happen and how long they last"
        icon={<Target className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly distribution */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900 inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-cyan-500" /> Peak Hours
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Call volume by hour of day
                {peakHour && peakHour.calls > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-cyan-600 font-semibold">
                    Peak: {peakHour.hour > 12 ? `${peakHour.hour - 12}PM` : peakHour.hour === 0 ? '12AM' : `${peakHour.hour}AM`}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="h-[280px]">
            {loading && hourlyData.length === 0 ? (
              <LoadingPlaceholder height={280} />
            ) : hourlyData.every((h) => h.calls === 0) ? (
              <EmptyPlaceholder message="No hourly data yet." height={280} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyData} margin={{ top: 10, right: 10, bottom: 10, left: 0 }} barCategoryGap="15%">
                  <defs>
                    <linearGradient id="hourlyBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                      <stop offset="100%" stopColor="#0891b2" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    stroke="#e5e7eb" tickLine={false}
                    interval={2}
                    tickFormatter={(h: number) => h > 12 ? `${h-12}p` : h === 0 ? '12a' : h === 12 ? '12p' : `${h}a`}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
                    labelFormatter={(h: number) => `${h > 12 ? h - 12 : h === 0 ? 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`}
                  />
                  <Bar dataKey="calls" name="calls" fill="url(#hourlyBar)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Duration distribution */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base font-bold text-gray-900 inline-flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-purple-500" /> Duration Distribution
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">How long calls typically last</p>
          </div>
          <div className="h-[280px]">
            {loading && durationData.length === 0 ? (
              <LoadingPlaceholder height={280} />
            ) : durationData.every((d) => d.count === 0) ? (
              <EmptyPlaceholder message="No duration data yet." height={280} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={durationData} margin={{ top: 10, right: 10, bottom: 10, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="4 6" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#e5e7eb" tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                  <Bar dataKey="count" name="calls" radius={[8, 8, 0, 0]} maxBarSize={52}>
                    {durationData.map((_, i) => (
                      <Cell key={i} fill={DURATION_COLORS[i % DURATION_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ─── NEW: Sentiment donut + Agent radar ─── */}
      <SectionHeader
        title="Sentiment & Agent Intelligence"
        subtitle="Conversation quality and agent performance comparison"
        icon={<Smile className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sentiment donut */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base font-bold text-gray-900 inline-flex items-center gap-1.5">
              <PieIcon className="h-4 w-4 text-success-500" /> Sentiment Analysis
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Customer sentiment distribution</p>
          </div>
          {loading && sentimentData.length === 0 ? (
            <LoadingPlaceholder height={300} />
          ) : sentimentData.length === 0 || sentimentTotal === 0 ? (
            <EmptyPlaceholder message="No sentiment data yet." height={300} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="relative h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sentimentData} dataKey="count" nameKey="sentiment"
                      cx="50%" cy="50%" innerRadius="55%" outerRadius="88%"
                      paddingAngle={4} stroke="#fff" strokeWidth={3}
                      isAnimationActive
                    >
                      {sentimentData.map((d) => (
                        <Cell key={d.sentiment} fill={SENTIMENT_COLORS[d.sentiment] || SENTIMENT_COLORS.UNKNOWN} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-2xl font-display font-extrabold text-gray-900 tabular-nums">{sentimentTotal}</p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">rated</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {sentimentData.map((d) => {
                  const pct = sentimentTotal ? Math.round((d.count / sentimentTotal) * 100) : 0;
                  const color = SENTIMENT_COLORS[d.sentiment] || SENTIMENT_COLORS.UNKNOWN;
                  const Icon = d.sentiment === 'POSITIVE' ? Smile : d.sentiment === 'NEGATIVE' ? Frown : Meh;
                  return (
                    <div key={d.sentiment} className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '18' }}>
                        <Icon className="h-4 w-4" style={{ color }} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-gray-700 capitalize">{d.sentiment.toLowerCase()}</span>
                          <span className="text-xs font-bold tabular-nums text-gray-900">{d.count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Agent radar chart */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card">
          <div className="mb-4">
            <h3 className="font-display text-base font-bold text-gray-900 inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-accent-500" /> Agent Comparison
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Multi-dimensional agent performance (top 5)</p>
          </div>
          {loading && agentRadarData.length === 0 ? (
            <LoadingPlaceholder height={300} />
          ) : agentRadarData.length === 0 ? (
            <EmptyPlaceholder message="No agent data yet." height={300} />
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={agentRadarData} cx="50%" cy="50%" outerRadius="75%">
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="agent" tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <PolarRadiusAxis tick={{ fontSize: 9, fill: '#9ca3af' }} />
                  <Radar name="Calls" dataKey="calls" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
                  <Radar name="Success %" dataKey="success" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ─── NEW: Agent performance table ─── */}
      {agentStats.length > 0 && (
        <>
          <SectionHeader
            title="Agent Leaderboard"
            subtitle="Detailed performance metrics for all agents"
            icon={<BarChart3 className="h-5 w-5" />}
          />

          <div className="rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">#</th>
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Agent</th>
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Calls</th>
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Success Rate</th>
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Avg Duration</th>
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Performance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...agentStats]
                    .sort((a, b) => b.total_calls - a.total_calls)
                    .map((agent, idx) => {
                      const successPct = Math.round((agent.success_rate || 0) * 100);
                      return (
                        <tr key={agent.agent_id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold ${
                              idx === 0 ? 'bg-amber-100 text-amber-700' :
                              idx === 1 ? 'bg-gray-100 text-gray-600' :
                              idx === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-50 text-gray-400'
                            }`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center text-white text-xs font-bold">
                                {(agent.agent_name || 'A').charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm font-semibold text-gray-900">{agent.agent_name || 'Agent'}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <span className="text-sm font-bold text-gray-900 tabular-nums">{agent.total_calls}</span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                              successPct >= 70 ? 'bg-success-50 text-success-700' :
                              successPct >= 40 ? 'bg-warning-50 text-warning-700' :
                              'bg-danger-50 text-danger-700'
                            }`}>
                              {successPct >= 70 ? <TrendingUp className="h-3 w-3" /> :
                               successPct >= 40 ? <Minus className="h-3 w-3" /> :
                               <TrendingDown className="h-3 w-3" />}
                              {successPct}%
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <span className="text-sm text-gray-600 tabular-nums">{fmtDuration(agent.average_duration_seconds)}</span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="w-20 ml-auto">
                              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${Math.min(successPct, 100)}%`,
                                    background: successPct >= 70 ? '#10b981' : successPct >= 40 ? '#f59e0b' : '#ef4444',
                                  }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───

function CustomDatePicker({
  days, setDays, dateRangeLabel,
}: { days: number; setDays: (n: number) => void; dateRangeLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const today = new Date();
  const startDefault = new Date(today);
  startDefault.setDate(today.getDate() - days + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const [start, setStart] = useState<string>(fmt(startDefault));
  const [end, setEnd] = useState<string>(fmt(today));

  useEffect(() => {
    const t = new Date();
    const s = new Date(t);
    s.setDate(t.getDate() - days + 1);
    setStart(fmt(s));
    setEnd(fmt(t));
  }, [days]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function apply() {
    if (!start || !end) return;
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return;
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    s.setHours(0, 0, 0, 0);
    const diffDays = Math.max(1, Math.ceil((todayMidnight.getTime() - s.getTime()) / 86400000) + 1);
    setDays(diffDays);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors font-medium"
      >
        <Calendar className="h-3.5 w-3.5" /> Custom
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-72 z-30 rounded-xl border border-gray-200 bg-white shadow-xl p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Start date</label>
            <input
              type="date" value={start} max={end || fmt(today)}
              onChange={(e) => setStart(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">End date</label>
            <input
              type="date" value={end} min={start} max={fmt(today)}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
            <button onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 font-medium">
              Cancel
            </button>
            <button
              onClick={apply} disabled={!start || !end || start > end}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const KPI_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  primary: { bg: 'bg-primary-50', text: 'text-primary-600', icon: 'text-primary-500' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', icon: 'text-cyan-500' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', icon: 'text-teal-500' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', icon: 'text-indigo-500' },
  success: { bg: 'bg-success-50', text: 'text-success-600', icon: 'text-success-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: 'text-emerald-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', icon: 'text-amber-500' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', icon: 'text-purple-500' },
};

function KpiCard({ label, value, icon, color = 'primary', suffix = '', prefix = '', decimals = 0 }: {
  label: string; value: number | null; icon: React.ReactNode; color?: string;
  suffix?: string; prefix?: string; decimals?: number;
}) {
  const c = KPI_COLORS[color] || KPI_COLORS.primary;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card hover:shadow-stat transition-all duration-200 group">
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-7 w-7 rounded-lg ${c.bg} flex items-center justify-center ${c.icon} group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider leading-tight">{label}</p>
      </div>
      <p className={`text-xl font-display font-extrabold ${c.text} tracking-tight`}>
        {value === null ? (
          <span className="inline-block w-12 h-5 bg-gray-100 rounded animate-pulse" />
        ) : (
          <AnimatedNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
        )}
      </p>
    </div>
  );
}

function StatRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-xs font-medium text-gray-600">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

function SentimentBar({ label, count, total, color, icon }: {
  label: string; count: number; total: number; color: string; icon: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2" style={{ color }}>
          {icon}
          <span className="text-xs font-semibold text-gray-700">{label}</span>
        </div>
        <span className="text-xs font-bold text-gray-900 tabular-nums">{count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function LoadingPlaceholder({ height = 360 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function EmptyPlaceholder({ message, height = 360 }: { message: string; height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center text-sm text-gray-400" style={{ height }}>
      <BarChart3 className="h-8 w-8 mb-2 text-gray-200" />
      {message}
    </div>
  );
}
