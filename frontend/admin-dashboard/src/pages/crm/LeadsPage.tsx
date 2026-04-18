import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Download, Trash2, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { formatDate, formatCurrency } from '@/utils/formatters';
import { crmApi } from '@/services/crm.api';
import type { Lead } from '@/types';

const mockLeads: Lead[] = [
  { id: '1', name: 'Sarah Johnson', email: 'sarah@healthclinics.com', phone: '+14155551234', company: 'Health Clinics Inc.', status: 'qualified', source: 'inbound-call', score: 92, value: 45000, notes: '', tags: ['healthcare', 'enterprise'], createdAt: '2026-04-18T10:30:00Z', updatedAt: '2026-04-18T10:30:00Z' },
  { id: '2', name: 'Mike Chen', email: 'mike@techstart.io', phone: '+14155555678', company: 'TechStart', status: 'contacted', source: 'website', score: 75, value: 12000, notes: '', tags: ['tech', 'startup'], createdAt: '2026-04-17T14:20:00Z', updatedAt: '2026-04-17T14:20:00Z' },
  { id: '3', name: 'Emily Davis', email: 'emily@retailco.com', phone: '+14155559012', company: 'RetailCo', status: 'proposal', source: 'referral', score: 88, value: 32000, notes: '', tags: ['retail'], createdAt: '2026-04-16T09:00:00Z', updatedAt: '2026-04-17T11:00:00Z' },
  { id: '4', name: 'Alex Rivera', email: 'alex@edufirst.org', phone: '+14155553456', company: 'EduFirst', status: 'new', source: 'inbound-call', score: 60, value: 0, notes: '', tags: ['education'], createdAt: '2026-04-18T08:50:00Z', updatedAt: '2026-04-18T08:50:00Z' },
  { id: '5', name: 'Jordan Smith', email: 'jordan@bigcorp.com', phone: '+14155557890', company: 'BigCorp', status: 'won', source: 'outbound', score: 95, value: 78000, notes: '', tags: ['enterprise'], createdAt: '2026-04-10T12:00:00Z', updatedAt: '2026-04-15T16:00:00Z' },
  { id: '6', name: 'Lisa Wang', email: 'lisa@finserve.com', phone: '+14155552345', company: 'FinServe', status: 'qualified', source: 'campaign', score: 82, value: 25000, notes: '', tags: ['finance'], createdAt: '2026-04-15T10:30:00Z', updatedAt: '2026-04-16T09:00:00Z' },
  { id: '7', name: 'Tom Harris', email: 'tom@lawgroup.com', phone: '+14155556789', company: 'Harris Law Group', status: 'lost', source: 'referral', score: 45, value: 15000, notes: '', tags: ['legal'], createdAt: '2026-04-12T08:00:00Z', updatedAt: '2026-04-14T17:00:00Z' },
  { id: '8', name: 'Rachel Green', email: 'rachel@greendesign.co', phone: '+14155554567', company: 'Green Design Co.', status: 'contacted', source: 'website', score: 68, value: 8000, notes: '', tags: ['design', 'agency'], createdAt: '2026-04-17T13:40:00Z', updatedAt: '2026-04-17T13:40:00Z' },
];

const sourceLabels: Record<string, string> = {
  'inbound-call': 'Inbound Call', website: 'Website', referral: 'Referral', outbound: 'Outbound', campaign: 'Campaign',
};

export function LeadsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, any> = { page, limit };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (sourceFilter !== 'all') params.source = sourceFilter;
      if (search) params.search = search;
      const result = await crmApi.listLeads(params);
      setLeads(result.data);
      setTotal(result.total);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Failed to load leads';
      setError(message);
      setLeads(mockLeads);
      setTotal(mockLeads.length);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, sourceFilter, search]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { setPage(1); }, [statusFilter, sourceFilter, search]);

  const displayed = error
    ? leads.filter((l) => {
        const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) ||
          l.company.toLowerCase().includes(search.toLowerCase()) ||
          l.email.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === 'all' || l.status === statusFilter;
        const matchSource = sourceFilter === 'all' || l.source === sourceFilter;
        return matchSearch && matchStatus && matchSource;
      })
    : leads;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selectedIds.length} lead(s)?`)) return;
    try {
      await Promise.all(selectedIds.map((id) => crmApi.deleteLead(id)));
      setSelectedIds([]);
      fetchLeads();
    } catch { /* ignore */ }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns = [
    {
      key: 'select', label: '', className: 'w-10',
      render: (item: Lead) => (
        <input type="checkbox" checked={selectedIds.includes(item.id)}
          onChange={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
          className="rounded border-gray-300 text-primary-600" />
      ),
    },
    {
      key: 'name', label: 'Lead', sortable: true,
      render: (item: Lead) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-600 flex items-center justify-center text-xs font-semibold">
            {item.name[0]}
          </div>
          <div>
            <p className="font-medium text-gray-900">{item.name}</p>
            <p className="text-xs text-gray-400">{item.company}</p>
          </div>
        </div>
      ),
    },
    { key: 'email', label: 'Email', sortable: true },
    { key: 'status', label: 'Status', render: (item: Lead) => <StatusBadge status={item.status} /> },
    { key: 'source', label: 'Source', render: (item: Lead) => <Badge variant="outline">{sourceLabels[item.source] || item.source}</Badge> },
    {
      key: 'score', label: 'Score', sortable: true,
      render: (item: Lead) => {
        const color = item.score >= 80 ? 'text-success-600' : item.score >= 50 ? 'text-warning-600' : 'text-gray-400';
        return (
          <div className="flex items-center gap-2">
            <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${item.score >= 80 ? 'bg-success-500' : item.score >= 50 ? 'bg-warning-500' : 'bg-gray-300'}`} style={{ width: `${item.score}%` }} />
            </div>
            <span className={`text-sm font-semibold ${color}`}>{item.score}</span>
          </div>
        );
      },
    },
    { key: 'value', label: 'Value', sortable: true, render: (item: Lead) => <span className="text-sm font-medium">{item.value > 0 ? formatCurrency(item.value) : '--'}</span> },
    { key: 'createdAt', label: 'Created', sortable: true, render: (item: Lead) => <span className="text-sm text-gray-500">{formatDate(item.createdAt)}</span> },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and track your sales leads</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="rounded-xl"><Download className="h-4 w-4" />Export</Button>
          <Button variant="gradient" className="rounded-xl"><Plus className="h-4 w-4" />Add Lead</Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-warning-50 border border-warning-200 text-sm text-warning-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Service unavailable: showing demo data. ({error})</span>
          <button onClick={fetchLeads} className="ml-auto text-warning-800 underline text-xs font-medium">Retry</button>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder="Search leads..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100">
          <option value="all">All Status</option>
          <option value="new">New</option><option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option><option value="proposal">Proposal</option>
          <option value="won">Won</option><option value="lost">Lost</option>
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100">
          <option value="all">All Sources</option>
          <option value="inbound-call">Inbound Call</option><option value="website">Website</option>
          <option value="referral">Referral</option><option value="outbound">Outbound</option>
          <option value="campaign">Campaign</option>
        </select>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-gray-500">{selectedIds.length} selected</span>
            <Button variant="danger" size="sm" onClick={handleDeleteSelected} className="rounded-lg">
              <Trash2 className="h-3.5 w-3.5" />Delete
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <Card padding={false} className="shadow-card">
          <Table columns={columns} data={displayed} onRowClick={(item) => navigate(`/crm/leads/${item.id}`)} />
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-500">Showing {displayed.length} of {total} leads</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm text-gray-700 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
