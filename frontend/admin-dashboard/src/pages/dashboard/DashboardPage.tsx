import { useState, useEffect } from 'react';
import { Phone, Bot, Users, TrendingUp, ArrowUpRight, ArrowDownRight, Loader2, AlertCircle } from 'lucide-react';
import { StatCard, Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { formatDuration, formatDate, timeAgo } from '@/utils/formatters';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '@/services/api';
import { callApi } from '@/services/call.api';

// Mock/fallback data
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
  duration: number;
  outcome: 'completed' | 'transferred' | 'voicemail' | 'dropped' | 'no-answer';
  sentiment: 'positive' | 'neutral' | 'negative';
  createdAt: string;
}

const callColumns = [
  { key: 'caller', label: 'Caller', sortable: true },
  { key: 'agentName', label: 'Agent', sortable: true },
  {
    key: 'duration',
    label: 'Duration',
    sortable: true,
    render: (item: RecentCall) => formatDuration(item.duration),
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
      <span className="text-gray-500">{timeAgo(item.createdAt)}</span>
    ),
  },
];

export function DashboardPage() {
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

    // Fetch analytics and recent calls in parallel, gracefully handle failures
    const results = await Promise.allSettled([
      api.get('/analytics/dashboard').then((r) => r.data),
      callApi.list({ page: 1, limit: 5 }),
    ]);

    const [analyticsResult, callsResult] = results;

    if (analyticsResult.status === 'fulfilled') {
      const data = analyticsResult.value.data ?? analyticsResult.value;
      setStats({
        totalCalls: data.totalCalls ?? 0,
        totalCallsChange: data.totalCallsChange ?? '',
        activeAgents: data.activeAgents ?? 0,
        activeAgentsNote: data.activeAgentsNote ?? '',
        leadsGenerated: data.leadsGenerated ?? 0,
        leadsChange: data.leadsChange ?? '',
        conversionRate: data.conversionRate ?? 0,
        conversionChange: data.conversionChange ?? '',
        avgDuration: data.avgDuration ?? '0:00',
        avgDurationPct: data.avgDurationPct ?? 0,
        resolutionRate: data.resolutionRate ?? 0,
        transferRate: data.transferRate ?? 0,
        positiveSentiment: data.positiveSentiment ?? 0,
        revenueGenerated: data.revenueGenerated ?? 0,
        costPerCall: data.costPerCall ?? 0,
      });
      if (data.chartData && Array.isArray(data.chartData)) {
        setChartData(data.chartData);
      }
    } else {
      setError('Analytics service unavailable - showing default values.');
    }

    if (callsResult.status === 'fulfilled') {
      setRecentCalls(callsResult.value.data as RecentCall[]);
    }

    setLoading(false);
  };

  const formatStatValue = (val: number) => val.toLocaleString();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back. Here is what is happening today.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={fetchDashboardData} className="ml-auto text-warning-800 underline text-xs">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="calls"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#2563eb' }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Quick stats */}
            <Card>
              <CardHeader title="Performance" subtitle="This month" />
              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Avg. Call Duration</span>
                    <span className="text-sm font-semibold text-gray-900">{stats.avgDuration}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full">
                    <div className="h-2 bg-primary-500 rounded-full" style={{ width: `${stats.avgDurationPct}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Resolution Rate</span>
                    <span className="text-sm font-semibold text-gray-900">{stats.resolutionRate}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full">
                    <div className="h-2 bg-success-500 rounded-full" style={{ width: `${stats.resolutionRate}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Transfer Rate</span>
                    <span className="text-sm font-semibold text-gray-900">{stats.transferRate}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full">
                    <div className="h-2 bg-warning-500 rounded-full" style={{ width: `${stats.transferRate}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Positive Sentiment</span>
                    <span className="text-sm font-semibold text-gray-900">{stats.positiveSentiment}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full">
                    <div className="h-2 bg-primary-500 rounded-full" style={{ width: `${stats.positiveSentiment}%` }} />
                  </div>
                </div>
                <div className="pt-3 border-t border-gray-100 space-y-2">
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

          {/* Recent calls table */}
          <Card padding={false}>
            <div className="px-6 py-4 border-b border-gray-200">
              <CardHeader title="Recent Calls" subtitle="Latest incoming and outgoing calls" />
            </div>
            {recentCalls.length > 0 ? (
              <Table columns={callColumns} data={recentCalls} />
            ) : (
              <div className="px-6 py-12 text-center text-sm text-gray-500">
                No recent calls to display.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
