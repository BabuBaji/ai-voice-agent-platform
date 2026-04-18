import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { formatDuration, formatDate } from '@/utils/formatters';

const mockCalls = [
  { id: '1', caller: 'Sarah Johnson', callerPhone: '+14155551234', agentName: 'Sales Bot', duration: 245, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-18T10:30:00Z' },
  { id: '2', caller: 'Mike Chen', callerPhone: '+14155555678', agentName: 'Support Agent', duration: 180, outcome: 'transferred' as const, sentiment: 'neutral' as const, createdAt: '2026-04-18T09:45:00Z' },
  { id: '3', caller: 'Emily Davis', callerPhone: '+14155559012', agentName: 'Sales Bot', duration: 320, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-18T09:15:00Z' },
  { id: '4', caller: 'Alex Rivera', callerPhone: '+14155553456', agentName: 'Booking Agent', duration: 95, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-18T08:50:00Z' },
  { id: '5', caller: 'Jordan Smith', callerPhone: '+14155557890', agentName: 'Support Agent', duration: 420, outcome: 'dropped' as const, sentiment: 'negative' as const, createdAt: '2026-04-18T08:30:00Z' },
  { id: '6', caller: 'Lisa Wang', callerPhone: '+14155552345', agentName: 'Sales Bot', duration: 198, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-17T16:20:00Z' },
  { id: '7', caller: 'Tom Harris', callerPhone: '+14155556789', agentName: 'Booking Agent', duration: 145, outcome: 'completed' as const, sentiment: 'neutral' as const, createdAt: '2026-04-17T15:10:00Z' },
  { id: '8', caller: 'Unknown Caller', callerPhone: '+14155550123', agentName: 'Sales Bot', duration: 30, outcome: 'no-answer' as const, sentiment: 'neutral' as const, createdAt: '2026-04-17T14:55:00Z' },
  { id: '9', caller: 'Rachel Green', callerPhone: '+14155554567', agentName: 'Support Agent', duration: 280, outcome: 'completed' as const, sentiment: 'positive' as const, createdAt: '2026-04-17T13:40:00Z' },
  { id: '10', caller: 'David Kim', callerPhone: '+14155558901', agentName: 'Sales Bot', duration: 350, outcome: 'voicemail' as const, sentiment: 'neutral' as const, createdAt: '2026-04-17T12:30:00Z' },
];

export function CallLogPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const perPage = 10;

  const filtered = mockCalls.filter((c) => {
    const matchSearch = c.caller.toLowerCase().includes(search.toLowerCase()) ||
      c.agentName.toLowerCase().includes(search.toLowerCase());
    const matchOutcome = outcomeFilter === 'all' || c.outcome === outcomeFilter;
    return matchSearch && matchOutcome;
  });

  const columns = [
    {
      key: 'caller',
      label: 'Caller',
      sortable: true,
      render: (item: typeof mockCalls[0]) => (
        <div>
          <p className="font-medium text-gray-900">{item.caller}</p>
          <p className="text-xs text-gray-400">{item.callerPhone}</p>
        </div>
      ),
    },
    { key: 'agentName', label: 'Agent', sortable: true },
    {
      key: 'duration',
      label: 'Duration',
      sortable: true,
      render: (item: typeof mockCalls[0]) => formatDuration(item.duration),
    },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (item: typeof mockCalls[0]) => <StatusBadge status={item.outcome} />,
    },
    {
      key: 'sentiment',
      label: 'Sentiment',
      render: (item: typeof mockCalls[0]) => <StatusBadge status={item.sentiment} />,
    },
    {
      key: 'createdAt',
      label: 'Date',
      sortable: true,
      render: (item: typeof mockCalls[0]) => (
        <span className="text-gray-500 text-sm">{formatDate(item.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Log</h1>
          <p className="text-sm text-gray-500 mt-1">View and analyze all call history</p>
        </div>
        <Button variant="outline">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by caller or agent..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          />
        </div>
        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
        >
          <option value="all">All Outcomes</option>
          <option value="completed">Completed</option>
          <option value="transferred">Transferred</option>
          <option value="voicemail">Voicemail</option>
          <option value="dropped">Dropped</option>
          <option value="no-answer">No Answer</option>
        </select>
      </div>

      {/* Table */}
      <Card padding={false}>
        <Table
          columns={columns}
          data={filtered}
          onRowClick={(item) => navigate(`/calls/${item.id}`)}
        />

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {filtered.length} of {mockCalls.length} calls
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-700 px-2">Page {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
