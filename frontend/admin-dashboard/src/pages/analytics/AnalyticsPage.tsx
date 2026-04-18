import { Card, CardHeader } from '@/components/ui/Card';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const callsOverTime = [
  { date: 'Apr 1', calls: 85 },
  { date: 'Apr 3', calls: 120 },
  { date: 'Apr 5', calls: 105 },
  { date: 'Apr 7', calls: 140 },
  { date: 'Apr 9', calls: 165 },
  { date: 'Apr 11', calls: 130 },
  { date: 'Apr 13', calls: 155 },
  { date: 'Apr 15', calls: 180 },
  { date: 'Apr 17', calls: 195 },
  { date: 'Apr 18', calls: 210 },
];

const callOutcomes = [
  { name: 'Completed', value: 68, color: '#22c55e' },
  { name: 'Transferred', value: 15, color: '#3b82f6' },
  { name: 'Voicemail', value: 10, color: '#f59e0b' },
  { name: 'Dropped', value: 5, color: '#ef4444' },
  { name: 'No Answer', value: 2, color: '#94a3b8' },
];

const agentPerformance = [
  { name: 'Sales Bot', calls: 420, success: 87, satisfaction: 92 },
  { name: 'Support Agent', calls: 380, success: 92, satisfaction: 88 },
  { name: 'Booking Agent', calls: 290, success: 95, satisfaction: 96 },
  { name: 'Lead Qualifier', calls: 190, success: 78, satisfaction: 82 },
];

const leadSources = [
  { source: 'Inbound Calls', leads: 145 },
  { source: 'Website', leads: 98 },
  { source: 'Referrals', leads: 56 },
  { source: 'Outbound', leads: 42 },
  { source: 'Campaigns', leads: 35 },
];

export function AnalyticsPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Insights and performance metrics</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Calls (Month)', value: '4,285', change: '+18%' },
          { label: 'Avg. Duration', value: '3:42', change: '-0:12' },
          { label: 'Resolution Rate', value: '87.3%', change: '+2.1%' },
          { label: 'Cost per Call', value: '$0.42', change: '-$0.03' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{stat.value}</p>
            <p className="text-xs text-success-600 mt-1">{stat.change}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calls Over Time */}
        <Card>
          <CardHeader title="Calls Over Time" subtitle="Daily call volume this month" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={callsOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Line type="monotone" dataKey="calls" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Call Outcomes */}
        <Card>
          <CardHeader title="Call Outcomes" subtitle="Distribution by outcome type" />
          <div className="h-72 flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={callOutcomes}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {callOutcomes.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Agent Performance */}
        <Card>
          <CardHeader title="Agent Performance" subtitle="Success rate by agent" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agentPerformance} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Legend
                  formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
                />
                <Bar dataKey="success" name="Success %" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="satisfaction" name="Satisfaction %" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Lead Sources */}
        <Card>
          <CardHeader title="Lead Sources" subtitle="Where leads are coming from" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={leadSources} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis dataKey="source" type="category" tick={{ fontSize: 11 }} stroke="#94a3b8" width={100} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Bar dataKey="leads" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
