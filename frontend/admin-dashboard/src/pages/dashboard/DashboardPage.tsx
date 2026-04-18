import { Phone, Bot, Users, TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { StatCard, Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { formatDuration, formatDate, timeAgo } from '@/utils/formatters';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const chartData = [
  { date: 'Mon', calls: 120 },
  { date: 'Tue', calls: 185 },
  { date: 'Wed', calls: 165 },
  { date: 'Thu', calls: 210 },
  { date: 'Fri', calls: 195 },
  { date: 'Sat', calls: 80 },
  { date: 'Sun', calls: 55 },
];

const recentCalls = [
  { id: '1', caller: 'Sarah Johnson', agentName: 'Sales Bot', duration: 245, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-18T10:30:00Z' },
  { id: '2', caller: 'Mike Chen', agentName: 'Support Agent', duration: 180, outcome: 'transferred' as const, sentiment: 'neutral' as const, createdAt: '2026-04-18T09:45:00Z' },
  { id: '3', caller: 'Emily Davis', agentName: 'Sales Bot', duration: 320, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-18T09:15:00Z' },
  { id: '4', caller: 'Alex Rivera', agentName: 'Booking Agent', duration: 95, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-18T08:50:00Z' },
  { id: '5', caller: 'Jordan Smith', agentName: 'Support Agent', duration: 420, outcome: 'dropped' as const, sentiment: 'negative' as const, createdAt: '2026-04-18T08:30:00Z' },
];

const callColumns = [
  { key: 'caller', label: 'Caller', sortable: true },
  { key: 'agentName', label: 'Agent', sortable: true },
  {
    key: 'duration',
    label: 'Duration',
    sortable: true,
    render: (item: typeof recentCalls[0]) => formatDuration(item.duration),
  },
  {
    key: 'outcome',
    label: 'Outcome',
    render: (item: typeof recentCalls[0]) => <StatusBadge status={item.outcome} />,
  },
  {
    key: 'sentiment',
    label: 'Sentiment',
    render: (item: typeof recentCalls[0]) => <StatusBadge status={item.sentiment} />,
  },
  {
    key: 'createdAt',
    label: 'Time',
    render: (item: typeof recentCalls[0]) => (
      <span className="text-gray-500">{timeAgo(item.createdAt)}</span>
    ),
  },
];

export function DashboardPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back. Here is what is happening today.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Calls"
          value="1,284"
          change="+12.5% from last week"
          changeType="positive"
          icon={<Phone className="h-6 w-6" />}
        />
        <StatCard
          title="Active Agents"
          value="8"
          change="2 drafts pending"
          changeType="neutral"
          icon={<Bot className="h-6 w-6" />}
        />
        <StatCard
          title="Leads Generated"
          value="342"
          change="+8.2% from last week"
          changeType="positive"
          icon={<Users className="h-6 w-6" />}
        />
        <StatCard
          title="Conversion Rate"
          value="24.8%"
          change="-2.1% from last week"
          changeType="negative"
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
                <span className="text-sm font-semibold text-gray-900">3:24</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full">
                <div className="h-2 bg-primary-500 rounded-full" style={{ width: '65%' }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">Resolution Rate</span>
                <span className="text-sm font-semibold text-gray-900">87%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full">
                <div className="h-2 bg-success-500 rounded-full" style={{ width: '87%' }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">Transfer Rate</span>
                <span className="text-sm font-semibold text-gray-900">13%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full">
                <div className="h-2 bg-warning-500 rounded-full" style={{ width: '13%' }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">Positive Sentiment</span>
                <span className="text-sm font-semibold text-gray-900">72%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full">
                <div className="h-2 bg-primary-500 rounded-full" style={{ width: '72%' }} />
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Revenue Generated</span>
                <div className="flex items-center gap-1 text-success-600 font-semibold">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  $48,250
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Cost Per Call</span>
                <div className="flex items-center gap-1 text-danger-600 font-semibold">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  $0.42
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
        <Table columns={callColumns} data={recentCalls} />
      </Card>
    </div>
  );
}
