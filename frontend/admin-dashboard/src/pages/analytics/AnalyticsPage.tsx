import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, Clock, Activity, Users, Calendar, AlertCircle, Loader2,
  BarChart3, LineChart as LineIcon, AreaChart as AreaIcon, PieChart as PieIcon,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import {
  analyticsApi,
  type AnalyticsSummary,
  type TimeseriesPoint,
  type OutcomePoint,
  type AgentRow,
  type AnalyticsFilter,
} from '@/services/analytics.api';
import { agentApi } from '@/services/agent.api';

type ChannelTab = 'phone' | 'web';
type ChartTab = 'volume' | 'duration';
type ChartKind = 'bar' | 'line' | 'area';

// Pie palette for outcomes — soft, distinguishable, accessible.
const PIE_COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899', '#64748b'];

const DAY_PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function fmtShortDate(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function fmtMin(sec: number): string {
  return (sec / 60).toFixed(2);
}

export function AnalyticsPage() {
  // Filters
  const [days, setDays] = useState(7);
  const [agentId, setAgentId] = useState<string>('');
  const [channelTab, setChannelTab] = useState<ChannelTab>('phone');
  const [chartTab, setChartTab] = useState<ChartTab>('volume');
  const [chartKind, setChartKind] = useState<ChartKind>('bar');

  // Data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomePoint[]>([]);
  const [agentStats, setAgentStats] = useState<AgentRow[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);

  // Load agents once — used for the Assistant selector + total count KPI
  useEffect(() => {
    agentApi.list().then((a: any) => {
      const arr = Array.isArray(a) ? a : a?.data || [];
      setAgents(arr.map((x: any) => ({ id: x.id, name: x.name })));
    }).catch(() => {});
  }, []);

  // Load metrics when filters change
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
    ]).then((rs) => {
      if (cancelled) return;
      if (rs[0].status === 'fulfilled') setSummary(rs[0].value);
      if (rs[1].status === 'fulfilled') setTimeseries(rs[1].value);
      if (rs[2].status === 'fulfilled') setOutcomes(rs[2].value);
      if (rs[3].status === 'fulfilled') setAgentStats(rs[3].value);
      const rejected = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (rejected) setError(rejected.reason?.response?.data?.message || rejected.reason?.message || 'Analytics API error');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, agentId, channelTab]);

  // Human-readable date range for the "📅 Apr 15, 2026 - Apr 22, 2026" pill
  const dateRangeLabel = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    const fmt = (d: Date) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${fmt(start)} — ${fmt(end)}`;
  }, [days]);

  // Totals for KPI cards
  const totalCalls = summary?.total_calls ?? 0;
  const totalDurationMin = summary?.total_duration_minutes ?? 0;
  const avgDurationSec = summary?.avg_duration_seconds ?? 0;
  const totalAssistants = agents.length;

  const chartData = timeseries.map((p) => ({
    date: fmtShortDate(p.date),
    calls: p.calls,
    duration: +(p.avg_duration / 60).toFixed(2),
  }));

  // Top agents (sorted desc by calls), capped to top 6 for readable bars.
  const topAgents = useMemo(
    () => [...agentStats]
      .sort((a, b) => b.total_calls - a.total_calls)
      .slice(0, 6)
      .map((a) => ({
        name: a.agent_name && a.agent_name.length > 18 ? a.agent_name.slice(0, 18) + '…' : a.agent_name || 'Agent',
        calls: a.total_calls,
        success_pct: Math.round((a.success_rate || 0) * 100),
      })),
    [agentStats],
  );

  const dataKey = chartTab === 'volume' ? 'calls' : 'duration';
  const dataName = chartTab === 'volume' ? 'calls' : 'minutes';

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">View and analyze your call and chat performance metrics</p>
      </div>

      {/* ─── Top filter row ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {DAY_PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                days === p.days
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          <CustomDatePicker days={days} setDays={setDays} dateRangeLabel={dateRangeLabel} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="text-xs font-medium text-gray-600">Select Assistant</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="min-w-[200px] text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">All Assistants</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {/* ─── Channel tabs (Phone vs Chatbot) ─── */}
      <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
        <button
          onClick={() => setChannelTab('phone')}
          className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
            channelTab === 'phone' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Phone Call Analytics
        </button>
        <button
          onClick={() => setChannelTab('web')}
          className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
            channelTab === 'web' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Website Chatbot Analytics
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Calls Count"
          value={loading ? '…' : totalCalls.toLocaleString()}
          icon={<Phone className="h-5 w-5 text-primary-500" />}
        />
        <KpiCard
          label="Total call duration"
          value={loading ? '…' : `${totalDurationMin.toFixed(2)} min`}
          icon={<Clock className="h-5 w-5 text-primary-500" />}
        />
        <KpiCard
          label="Avg. Duration"
          value={loading ? '…' : `${fmtMin(avgDurationSec)} min`}
          icon={<Activity className="h-5 w-5 text-primary-500" />}
        />
        <KpiCard
          label="Total Assistants"
          value={String(totalAssistants)}
          icon={<Users className="h-5 w-5 text-primary-500" />}
        />
      </div>

      {/* ─── Chart tabs (metric + chart kind) ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => setChartTab('volume')}
            className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
              chartTab === 'volume' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Call Volume
          </button>
          <button
            onClick={() => setChartTab('duration')}
            className={`text-sm font-medium px-4 py-1.5 rounded-lg transition-colors ${
              chartTab === 'duration' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Call Duration
          </button>
        </div>
        <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
          {([
            { id: 'bar' as ChartKind, label: 'Bar', Icon: BarChart3 },
            { id: 'line' as ChartKind, label: 'Line', Icon: LineIcon },
            { id: 'area' as ChartKind, label: 'Area', Icon: AreaIcon },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setChartKind(id)}
              title={label}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
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
      <Card>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900">
            {chartTab === 'volume' ? 'Call Volume Over Time' : 'Call Duration Over Time'}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {chartTab === 'volume'
              ? 'Number of calls per day in the selected period'
              : 'Average call duration per day in the selected period (minutes)'}
          </p>
        </div>
        <div className="h-[360px]">
          {loading && chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              No calls in this period.
            </div>
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
                    type="monotone"
                    dataKey={dataKey}
                    name={dataName}
                    stroke="#0d9488"
                    strokeWidth={2}
                    fill="url(#callsArea)"
                    fillOpacity={1}
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
                    type="monotone"
                    dataKey={dataKey}
                    name={dataName}
                    stroke="#0d9488"
                    strokeWidth={3}
                    dot={{ r: 5, fill: '#fff', stroke: '#0d9488', strokeWidth: 2.5 }}
                    activeDot={{ r: 7, fill: '#0d9488', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* ─── Secondary charts: Outcomes pie + Top agents bar ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outcomes pie/donut */}
        <Card>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900 inline-flex items-center gap-1.5">
                <PieIcon className="h-4 w-4 text-primary-500" /> Call Outcomes
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">Breakdown of how calls ended in this period</p>
            </div>
          </div>
          {loading && outcomes.length === 0 ? (
            <div className="flex items-center justify-center h-[320px] text-sm text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : outcomes.length === 0 ? (
            <div className="flex items-center justify-center h-[320px] text-sm text-gray-400">No outcome data yet.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              {/* Donut — no slice labels, the legend has the data */}
              <div className="relative h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Pie
                      data={outcomes}
                      dataKey="count"
                      nameKey="outcome"
                      cx="50%"
                      cy="50%"
                      innerRadius="50%"
                      outerRadius="85%"
                      paddingAngle={3}
                      stroke="#fff"
                      strokeWidth={2}
                      labelLine={false}
                      isAnimationActive
                    >
                      {outcomes.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
                      formatter={(value: any, name: any) => [value, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center total */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900 tabular-nums">
                      {outcomes.reduce((s, o) => s + o.count, 0)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">total calls</p>
                  </div>
                </div>
              </div>
              {/* Legend list — full names + count + % */}
              <div className="max-h-[280px] overflow-y-auto pr-1">
                <ul className="divide-y divide-gray-100">
                  {(() => {
                    const total = outcomes.reduce((s, o) => s + o.count, 0);
                    return outcomes.map((o, i) => {
                      const pct = total ? Math.round((o.count / total) * 100) : 0;
                      return (
                        <li key={o.outcome} className="flex items-center gap-2.5 py-2">
                          <span
                            className="h-3 w-3 rounded-sm flex-shrink-0"
                            style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="flex-1 text-sm text-gray-700 truncate">{o.outcome}</span>
                          <span className="text-sm font-semibold text-gray-900 tabular-nums">{o.count}</span>
                          <span className="text-xs text-gray-400 w-9 text-right tabular-nums">{pct}%</span>
                        </li>
                      );
                    });
                  })()}
                </ul>
              </div>
            </div>
          )}
        </Card>

        {/* Top agents — horizontal bar */}
        <Card>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900 inline-flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4 text-primary-500" /> Top Agents by Calls
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">Top 6 agents — call count + success rate</p>
            </div>
          </div>
          <div className="h-[320px]">
            {loading && topAgents.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : topAgents.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">No agent data yet.</div>
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
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Custom date-range picker — sets `days` based on the chosen start date
// (end is always "today"). Lightweight popover; no extra dependency.
// ----------------------------------------------------------------------------

function CustomDatePicker({
  days, setDays, dateRangeLabel,
}: { days: number; setDays: (n: number) => void; dateRangeLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Default the picker fields to whatever range is currently active.
  const today = new Date();
  const startDefault = new Date(today);
  startDefault.setDate(today.getDate() - days + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [start, setStart] = useState<string>(fmt(startDefault));
  const [end, setEnd] = useState<string>(fmt(today));

  // Keep the inputs in sync when the preset changes elsewhere.
  useEffect(() => {
    const t = new Date();
    const s = new Date(t);
    s.setDate(t.getDate() - days + 1);
    setStart(fmt(s));
    setEnd(fmt(t));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // Close on outside click.
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
    // The API uses `days` count from today. We compute the number of days
    // covered by the chosen range and pass that through.
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
        className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition-colors"
      >
        <Calendar className="h-3.5 w-3.5" /> {dateRangeLabel}
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-72 z-30 rounded-xl border border-gray-200 bg-white shadow-xl p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">Start date</label>
            <input
              type="date"
              value={start}
              max={end || fmt(today)}
              onChange={(e) => setStart(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">End date</label>
            <input
              type="date"
              value={end}
              min={start}
              max={fmt(today)}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            <p className="text-[10px] text-gray-400 mt-1">End is always relative to today (the API uses Last N days).</p>
          </div>
          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
            <button
              onClick={() => setOpen(false)}
              className="text-xs px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={!start || !end || start > end}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-primary-200 bg-white p-5 shadow-card hover:shadow-stat transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
        <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center">{icon}</div>
      </div>
      <p className="text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
    </div>
  );
}
