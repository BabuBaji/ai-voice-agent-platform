import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone, Bot, Users, TrendingUp, ArrowUpRight, ArrowDownRight,
  Loader2, AlertCircle, Plus, Upload, BarChart3, Sparkles,
} from 'lucide-react';
import { StatCard, Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { formatDuration, formatDate, timeAgo } from '@/utils/formatters';
import { useAuthStore } from '@/stores/auth.store';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '@/services/api';
import { conversationApi } from '@/services/conversation.api';
import { agentApi } from '@/services/agent.api';

const defaultChartData = [
  { date: 'Mon', calls: 0 },
  { date: 'Tue', calls: 0 },
  { date: 'Wed', calls: 0 },
  { date: 'Thu', calls: 0 },
  { date: 'Fri', calls: 0 },
  { date: 'Sat', calls: 0 },
  { date: 'Sun', calls: 0 },
];

const defaultStats = {
  totalCalls: 0,
  totalCallsChange: '',
  activeAgents: 0,
  activeAgentsNote: '',
  leadsGenerated: 0,
  leadsChange: '',
  conversionRate: 0,
  conversionChange: '',
  avgDuration: '0:00',
  avgDurationPct: 0,
  resolutionRate: 0,
  transferRate: 0,
  positiveSentiment: 0,
  revenueGenerated: 0,
  costPerCall: 0,
};

interface DashboardStats {
  totalCalls: number;
  totalCallsChange: string;
  activeAgents: number;
  activeAgentsNote: string;
  leadsGenerated: number;
  leadsChange: string;
  conversionRate: number;
  conversionChange: string;
  avgDuration: string;
  avgDurationPct: number;
  resolutionRate: number;
  transferRate: number;
  positiveSentiment: number;
  revenueGenerated: number;
  costPerCall: number;
}

interface RecentCall {
  id: string;
  caller: string;
  agentName: string;
  channel: string;
  duration: number;
  outcome: string;
  sentiment: string;
  createdAt: string;
}

function sentimentToKey(s?: string | null): string {
  const v = (s || '').toLowerCase();
  if (v === 'positive') return 'positive';
  if (v === 'negative') return 'negative';
  if (v === 'mixed') return 'neutral';
  if (v === 'neutral') return 'neutral';
  return '';
}

function outcomeToStatus(o?: string | null, status?: string | null): string {
  const v = (o || '').toLowerCase();
  if (v) return v.replace(/\s+/g, '-');
  const s = (status || '').toLowerCase();
  if (s === 'ended') return 'completed';
  if (s === 'active') return 'processing';
  return s;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const quickActions = [
  { label: 'Create Agent', icon: Plus, path: '/agents/new', color: 'from-primary-600 to-primary-700' },
  { label: 'Import Leads', icon: Upload, path: '/crm/leads', color: 'from-accent-600 to-accent-700' },
  { label: 'View Analytics', icon: BarChart3, path: '/analytics', color: 'from-success-600 to-success-700' },
];

const callColumns = [
  { key: 'caller', label: 'Caller', sortable: true },
  { key: 'agentName', label: 'Agent', sortable: true },
  {
    key: 'channel',
    label: 'Channel',
    render: (item: RecentCall) => (
      <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">
        {item.channel}
      </span>
    ),
  },
  {
    key: 'duration',
    label: 'Duration',
    sortable: true,
    render: (item: RecentCall) => (
      <span className="font-mono text-sm">{formatDuration(item.duration)}</span>
    ),
  },
  {
    key: 'outcome',
    label: 'Outcome',
    render: (item: RecentCall) => <StatusBadge status={item.outcome} />,
  },
  {
    key: 'sentiment',
    label: 'Sentiment',
    render: (item: RecentCall) => <StatusBadge status={item.sentiment} />,
  },
  {
    key: 'createdAt',
    label: 'Time',
    render: (item: RecentCall) => (
      <span className="text-gray-500 text-sm">{timeAgo(item.createdAt)}</span>
    ),
  },
];

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [chartData, setChartData] = useState(defaultChartData);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError('');

    const results = await Promise.allSettled([
      api.get('/analytics/dashboard').then((r) => r.data),
      conversationApi.list({ page: 1, limit: 100 }), // pull more so we can compute local stats
      agentApi.list(),
    ]);

    const [analyticsResult, callsResult, agentsResult] = results;
    const agentMap = new Map<string, string>();
    if (agentsResult.status === 'fulfilled') {
      (agentsResult.value as any[]).forEach((a: any) => agentMap.set(a.id, a.name));
    }

    // Compute local stats from conversations (overrides analytics service if empty)
    let localStats: Partial<DashboardStats> = {};
    let localChart: typeof defaultChartData | null = null;
    if (callsResult.status === 'fulfilled') {
      const all = (callsResult.value.data || []) as any[];
      const total = callsResult.value.total ?? all.length;
      const completed = all.filter((c) => c.status === 'ENDED');
      const totalDuration = completed.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
      const avgSec = completed.length ? Math.round(totalDuration / completed.length) : 0;
      const positive = completed.filter((c) => (c.sentiment || '').toUpperCase() === 'POSITIVE').length;
      const activeAgents = new Set(all.map((c) => c.agent_id)).size;

      localStats = {
        totalCalls: total,
        activeAgents,
        avgDuration: `${Math.floor(avgSec / 60)}:${(avgSec % 60).toString().padStart(2, '0')}`,
        avgDurationPct: Math.min(100, Math.round((avgSec / 300) * 100)),
        resolutionRate: completed.length && total ? Math.round((completed.length / total) * 100) : 0,
        positiveSentiment: completed.length ? Math.round((positive / completed.length) * 100) : 0,
      };

      // Build last-7-days chart from started_at timestamps
      const byDay = new Map<string, number>();
      const dayLabel = (d: Date) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
      const now = new Date();
      const week: { date: string; calls: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        const key = d.toDateString();
        byDay.set(key, 0);
        week.push({ date: dayLabel(d), calls: 0 });
      }
      all.forEach((c) => {
        const d = new Date(c.started_at || c.created_at);
        if (isNaN(d.getTime())) return;
        const key = d.toDateString();
        if (byDay.has(key)) byDay.set(key, (byDay.get(key) || 0) + 1);
      });
      let idx = 0;
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        week[idx].calls = byDay.get(d.toDateString()) || 0;
        idx++;
      }
      localChart = week as typeof defaultChartData;
    }

    // Start from analytics-service response (may be empty), then overlay locally computed stats
    const fromAnalytics = analyticsResult.status === 'fulfilled'
      ? (analyticsResult.value.data ?? analyticsResult.value)
      : {};
    setStats({
      totalCalls: localStats.totalCalls ?? fromAnalytics.totalCalls ?? 0,
      totalCallsChange: fromAnalytics.totalCallsChange ?? '',
      activeAgents: localStats.activeAgents ?? fromAnalytics.activeAgents ?? 0,
      activeAgentsNote: fromAnalytics.activeAgentsNote ?? '',
      leadsGenerated: fromAnalytics.leadsGenerated ?? 0,
      leadsChange: fromAnalytics.leadsChange ?? '',
      conversionRate: fromAnalytics.conversionRate ?? 0,
      conversionChange: fromAnalytics.conversionChange ?? '',
      avgDuration: localStats.avgDuration ?? fromAnalytics.avgDuration ?? '0:00',
      avgDurationPct: localStats.avgDurationPct ?? fromAnalytics.avgDurationPct ?? 0,
      resolutionRate: localStats.resolutionRate ?? fromAnalytics.resolutionRate ?? 0,
      transferRate: fromAnalytics.transferRate ?? 0,
      positiveSentiment: localStats.positiveSentiment ?? fromAnalytics.positiveSentiment ?? 0,
      revenueGenerated: fromAnalytics.revenueGenerated ?? 0,
      costPerCall: fromAnalytics.costPerCall ?? 0,
    });
    if (fromAnalytics.chartData && Array.isArray(fromAnalytics.chartData)) {
      setChartData(fromAnalytics.chartData);
    } else if (localChart) {
      setChartData(localChart);
    }
    if (analyticsResult.status === 'rejected' && !localChart) {
      setError('Analytics service unavailable - showing default values.');
    }

    if (callsResult.status === 'fulfilled') {
      const rows = (callsResult.value.data || []).slice(0, 5).map((c: any) => ({
        id: c.id,
        caller: c.caller_number || (c.channel === 'WEB' ? 'Web Caller' : 'Unknown'),
        agentName: agentMap.get(c.agent_id) || 'Agent',
        channel: c.channel || 'PHONE',
        duration: c.duration_seconds ?? 0,
        outcome: outcomeToStatus(c.outcome, c.status),
        sentiment: sentimentToKey(c.sentiment),
        createdAt: c.started_at || c.created_at || '',
      })) as RecentCall[];
      setRecentCalls(rows);
    }

    setLoading(false);
  };

  const formatStatValue = (val: number) => val.toLocaleString();
  const firstName = user?.name?.split(' ')[0] || 'there';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Welcome header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}, {firstName}!
          </h1>
          <p className="text-sm text-gray-500 mt-1">Here is what is happening with your voice agents today.</p>
        </div>
        <div className="flex items-center gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              onClick={() => navigate(action.path)}
              className="hidden md:inline-flex"
            >
              <action.icon className="h-4 w-4" />
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={fetchDashboardData} className="ml-auto text-warning-800 underline text-xs font-medium">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600 mx-auto" />
            <p className="text-sm text-gray-400 mt-3">Loading dashboard...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Calls"
              value={formatStatValue(stats.totalCalls)}
              change={stats.totalCallsChange || 'No data yet'}
              changeType={stats.totalCallsChange?.startsWith('+') ? 'positive' : stats.totalCallsChange?.startsWith('-') ? 'negative' : 'neutral'}
              icon={<Phone className="h-6 w-6" />}
            />
            <StatCard
              title="Active Agents"
              value={formatStatValue(stats.activeAgents)}
              change={stats.activeAgentsNote || 'No data yet'}
              changeType="neutral"
              icon={<Bot className="h-6 w-6" />}
            />
            <StatCard
              title="Leads Generated"
              value={formatStatValue(stats.leadsGenerated)}
              change={stats.leadsChange || 'No data yet'}
              changeType={stats.leadsChange?.startsWith('+') ? 'positive' : stats.leadsChange?.startsWith('-') ? 'negative' : 'neutral'}
              icon={<Users className="h-6 w-6" />}
            />
            <StatCard
              title="Conversion Rate"
              value={`${stats.conversionRate}%`}
              change={stats.conversionChange || 'No data yet'}
              changeType={stats.conversionChange?.startsWith('+') ? 'positive' : stats.conversionChange?.startsWith('-') ? 'negative' : 'neutral'}
              icon={<TrendingUp className="h-6 w-6" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart */}
            <Card className="lg:col-span-2">
              <CardHeader title="Calls This Week" subtitle="Daily call volume" />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <defs>
                      <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
                        padding: '8px 12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="calls"
                      stroke="#4f46e5"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }}
                      fill="url(#callsGradient)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Performance */}
            <Card>
              <CardHeader title="Performance" subtitle="This month" />
              <div className="space-y-5">
                {[
                  { label: 'Avg. Call Duration', value: stats.avgDuration, pct: stats.avgDurationPct, color: 'bg-primary-500' },
                  { label: 'Resolution Rate', value: `${stats.resolutionRate}%`, pct: stats.resolutionRate, color: 'bg-success-500' },
                  { label: 'Transfer Rate', value: `${stats.transferRate}%`, pct: stats.transferRate, color: 'bg-warning-500' },
                  { label: 'Positive Sentiment', value: `${stats.positiveSentiment}%`, pct: stats.positiveSentiment, color: 'bg-accent-500' },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-600">{metric.label}</span>
                      <span className="text-sm font-semibold text-gray-900">{metric.value}</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-2 ${metric.color} rounded-full transition-all duration-1000`}
                        style={{ width: `${Math.min(metric.pct, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}

                <div className="pt-3 border-t border-gray-100 space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Revenue Generated</span>
                    <div className="flex items-center gap-1 text-success-600 font-semibold">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      ${stats.revenueGenerated.toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Cost Per Call</span>
                    <div className="flex items-center gap-1 text-danger-600 font-semibold">
                      <ArrowDownRight className="h-3.5 w-3.5" />
                      ${stats.costPerCall.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Recent calls */}
          <Card padding={false}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <CardHeader title="Recent Calls" subtitle="Latest incoming and outgoing calls" className="mb-0" />
              <Button variant="ghost" size="sm" onClick={() => navigate('/calls')}>
                View All
              </Button>
            </div>
            {recentCalls.length > 0 ? (
              <Table columns={callColumns} data={recentCalls} onRowClick={(item) => navigate(`/calls/${item.id}`)} />
            ) : (
              <div className="px-6 py-16 text-center">
                <Phone className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 font-medium">No recent calls</p>
                <p className="text-xs text-gray-400 mt-1">Calls will appear here once your agents start handling them.</p>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
