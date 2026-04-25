import { useEffect, useMemo, useState } from 'react';
import {
  Phone, Clock, Activity, Users, Calendar, AlertCircle, Loader2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card } from '@/components/ui/Card';
import {
  analyticsApi,
  type AnalyticsSummary,
  type TimeseriesPoint,
  type AnalyticsFilter,
} from '@/services/analytics.api';
import { agentApi } from '@/services/agent.api';

type ChannelTab = 'phone' | 'web';
type ChartTab = 'volume' | 'duration';

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

  // Data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
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
    ]).then((rs) => {
      if (cancelled) return;
      if (rs[0].status === 'fulfilled') setSummary(rs[0].value);
      if (rs[1].status === 'fulfilled') setTimeseries(rs[1].value);
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
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200">
            <Calendar className="h-3.5 w-3.5" /> {dateRangeLabel}
          </div>
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

      {/* ─── Chart tabs ─── */}
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

      {/* ─── Chart card ─── */}
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
        <div className="h-[420px]">
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
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#9ca3af" />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey={chartTab === 'volume' ? 'calls' : 'duration'}
                  name={chartTab === 'volume' ? 'calls' : 'minutes'}
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#0d9488', stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
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
