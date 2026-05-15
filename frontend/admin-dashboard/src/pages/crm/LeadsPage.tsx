import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Download, Trash2, Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Phone, Eye, Send, Mail, Building2, FileText, MessageSquare, CheckCircle2, Pencil, Check, Users, Sparkles, Trophy, UserCheck, Inbox, Filter, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { formatDate, formatCurrency } from '@/utils/formatters';
import { crmApi } from '@/services/crm.api';
import api from '@/services/api';
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
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', company: '' });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewLead, setViewLead] = useState<Lead | null>(null);
  const [showBrochure, setShowBrochure] = useState(false);

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
        const q = search.toLowerCase();
        const matchSearch = !search || l.name.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          (l.phone || '').toLowerCase().includes(q);
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

  const handleAddLead = async () => {
    setAddError('');
    if (!addForm.name.trim()) { setAddError('Name is required'); return; }
    if (!addForm.email.trim() && !addForm.phone.trim()) {
      setAddError('Provide at least one of email or phone');
      return;
    }
    setAdding(true);
    try {
      await crmApi.createLead({
        name: addForm.name.trim(),
        email: addForm.email.trim() || undefined,
        phone: addForm.phone.trim() || undefined,
        company: addForm.company.trim() || undefined,
        source: 'manual',
      } as any);
      setShowAdd(false);
      setAddForm({ name: '', email: '', phone: '', company: '' });
      fetchLeads();
    } catch (err: any) {
      const details = err?.response?.data?.details;
      const msg = Array.isArray(details) && details[0]?.message
        ? details[0].message
        : (err?.response?.data?.error || err?.message || 'Failed to create lead');
      setAddError(msg);
    } finally {
      setAdding(false);
    }
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
      key: 'view', label: '', className: 'w-20',
      render: (item: Lead) => (
        <button
          onClick={(e) => { e.stopPropagation(); setViewLead(item); }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 text-[11px] font-medium whitespace-nowrap"
          title="View all details"
        >
          <Eye className="h-3 w-3" /> View
        </button>
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
    {
      key: 'phone', label: 'Mobile', sortable: true,
      render: (item: Lead) => item.phone ? (
        <a
          href={`tel:${item.phone}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-sm font-mono text-gray-700 hover:text-primary-600"
          title="Click to dial"
        >
          <Phone className="h-3 w-3 text-gray-400" />
          {item.phone}
        </a>
      ) : <span className="text-xs text-gray-300">—</span>,
    },
    {
      key: 'email', label: 'Email', sortable: true,
      render: (item: Lead) => item.email
        ? <span className="text-sm text-gray-700">{item.email}</span>
        : <span className="text-xs text-gray-300">—</span>,
    },
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

  // KPI rollup. Counts come from the visible result set — for the full
  // pagination universe these would ideally be a separate API rollup, but
  // showing local counts is good enough for a top-of-page glance.
  const kpis = {
    total,
    new: displayed.filter((l) => l.status === 'new').length,
    qualified: displayed.filter((l) => l.status === 'qualified').length,
    won: displayed.filter((l) => l.status === 'won').length,
  };

  const STATUS_PILLS = [
    { value: 'all',       label: 'All' },
    { value: 'new',       label: 'New' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'proposal',  label: 'Proposal' },
    { value: 'won',       label: 'Won' },
    { value: 'lost',      label: 'Lost' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-2">
      {/* Compact header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-1">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary-600" />
          <h1 className="text-base font-semibold text-gray-900 leading-tight">Leads</h1>
          <span className="text-[11px] text-gray-400">· auto-scored · brochures + follow-ups automated</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" className="rounded-md h-7 text-xs"><Download className="h-3 w-3" />Export</Button>
          <Button variant="gradient" size="sm" className="rounded-md h-7 text-xs" onClick={() => { setAddError(''); setShowAdd(true); }}>
            <Plus className="h-3 w-3" />Add Lead
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Service unavailable: showing demo data. ({error})</span>
          <button onClick={fetchLeads} className="ml-auto text-amber-900 underline text-xs font-medium">Retry</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total', value: kpis.total,     icon: Users,     accent: 'text-blue-600 bg-blue-50' },
          { label: 'New',   value: kpis.new,       icon: Sparkles,  accent: 'text-amber-600 bg-amber-50' },
          { label: 'Qual.', value: kpis.qualified, icon: UserCheck, accent: 'text-purple-600 bg-purple-50' },
          { label: 'Won',   value: kpis.won,       icon: Trophy,    accent: 'text-emerald-600 bg-emerald-50' },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-white rounded-md border border-gray-100 shadow-sm px-2.5 py-1.5 flex items-center justify-between">
              <div className="leading-tight">
                <p className="text-[10px] uppercase tracking-wider font-medium text-gray-500">{k.label}</p>
                <p className="text-base font-semibold text-gray-900">{k.value}</p>
              </div>
              <div className={`p-1 rounded ${k.accent}`}><Icon className="h-3.5 w-3.5" /></div>
            </div>
          );
        })}
      </div>

      {/* Toolbar — single row, no card chrome */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
          <input type="text" placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs border border-gray-200 rounded-md bg-white focus:border-primary-300 focus:ring-1 focus:ring-primary-100 focus:outline-none" />
        </div>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary-100 cursor-pointer">
          <option value="all">All sources</option>
          <option value="inbound-call">Inbound Call</option>
          <option value="website">Website</option>
          <option value="referral">Referral</option>
          <option value="outbound">Outbound</option>
          <option value="campaign">Campaign</option>
        </select>
        <Filter className="h-3 w-3 text-gray-400 ml-1" />
        {STATUS_PILLS.map((s) => {
          const isActive = statusFilter === s.value;
          return (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                isActive
                  ? 'border-primary-400 bg-primary-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </button>
          );
        })}
        {(statusFilter !== 'all' || sourceFilter !== 'all' || search) && (
          <button onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setSearch(''); }}
            className="text-[11px] text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline">Clear</button>
        )}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[11px] text-gray-600 font-medium">{selectedIds.length} selected</span>
            <Button variant="danger" size="sm" onClick={handleDeleteSelected} className="rounded-md h-6 text-[11px]">
              <Trash2 className="h-3 w-3" />Delete
            </Button>
          </div>
        )}
      </div>

      {/* Premium table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-10 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="w-9 px-2 py-1.5 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.length > 0 && selectedIds.length === displayed.length}
                      onChange={(e) => setSelectedIds(e.target.checked ? displayed.map((l) => l.id) : [])}
                      className="rounded border-gray-300 text-primary-600"
                    />
                  </th>
                  <th className="w-14 px-2 py-1.5"></th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Lead</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Mobile</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Email</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Status</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Source</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Score</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Value</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center">
                      <div className="inline-flex flex-col items-center gap-1.5">
                        <Inbox className="h-10 w-10 text-gray-300" />
                        <p className="text-sm font-medium text-gray-600">No leads match your filters</p>
                        <p className="text-xs text-gray-400 max-w-sm">Adjust the search or add a new lead.</p>
                      </div>
                    </td>
                  </tr>
                )}
                {displayed.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  const scoreColor = item.score >= 80 ? 'text-emerald-600' : item.score >= 50 ? 'text-amber-600' : 'text-gray-400';
                  const scoreBar = item.score >= 80 ? 'bg-emerald-500' : item.score >= 50 ? 'bg-amber-500' : 'bg-gray-300';
                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/crm/leads/${item.id}`)}
                      className={`group border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary-50/20' : ''
                      }`}
                    >
                      <td className="px-2 py-0.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded border-gray-300 text-primary-600 h-3 w-3"
                        />
                      </td>
                      <td className="px-2 py-0.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setViewLead(item)}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary-50 hover:bg-primary-100 text-primary-700 text-[10px] font-medium transition-colors"
                          title="View all details"
                        >
                          <Eye className="h-2.5 w-2.5" /> View
                        </button>
                      </td>
                      <td className="px-3 py-0.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-700 flex items-center justify-center text-[10px] font-semibold ring-1 ring-primary-100 flex-shrink-0">
                            {item.name[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0 leading-none">
                            <p className="font-medium text-gray-900 truncate text-xs">{item.name}</p>
                            {item.company && <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.company}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-0.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        {item.phone ? (
                          <a href={`tel:${item.phone}`} className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-700 hover:text-primary-600" title="Click to dial">
                            <Phone className="h-2.5 w-2.5 text-gray-400" />{item.phone}
                          </a>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-0.5 align-middle">
                        {item.email
                          ? <span className="text-[11px] text-gray-700">{item.email}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-0.5 align-middle"><StatusBadge status={item.status} /></td>
                      <td className="px-3 py-0.5 align-middle"><Badge variant="outline">{sourceLabels[item.source] || item.source}</Badge></td>
                      <td className="px-3 py-0.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <div className="w-8 h-0.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBar}`} style={{ width: `${item.score}%` }} />
                          </div>
                          <span className={`text-[11px] font-semibold ${scoreColor}`}>{item.score}</span>
                        </div>
                      </td>
                      <td className="px-3 py-0.5 align-middle">
                        <span className="text-[11px] font-medium text-gray-800">{item.value > 0 ? formatCurrency(item.value) : <span className="text-gray-300">—</span>}</span>
                      </td>
                      <td className="px-3 py-0.5 align-middle"><span className="text-[11px] text-gray-500">{formatDate(item.createdAt)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
            <p className="text-xs text-gray-500">Showing <span className="font-medium text-gray-800">{displayed.length}</span> of <span className="font-medium text-gray-800">{total}</span></p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md"><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="text-xs text-gray-700 px-1">Page <span className="font-medium">{page}</span> / <span className="font-medium">{totalPages}</span></span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-md"><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead modal — unchanged behavior, slight visual polish */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !adding && setShowAdd(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary-600" /> Add Lead
              </h2>
              <button onClick={() => setShowAdd(false)} disabled={adding} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Input label="Full name *" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Priya Sharma" />
            <Input label="Email" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="name@example.com" />
            <Input label="Phone" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="+91 98xxxxxx21" />
            <Input label="Company" value={addForm.company} onChange={(e) => setAddForm({ ...addForm, company: e.target.value })} placeholder="(optional)" />
            {addError && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{addError}</div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)} disabled={adding} className="rounded-xl">Cancel</Button>
              <Button variant="gradient" onClick={handleAddLead} disabled={adding} className="rounded-xl">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {adding ? 'Saving…' : 'Save Lead'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {viewLead && (
        <ViewLeadModal
          lead={viewLead}
          onClose={() => setViewLead(null)}
          onSendBrochure={() => setShowBrochure(true)}
          onLeadUpdated={(updated) => {
            setViewLead(updated);
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
          }}
        />
      )}

      {showBrochure && viewLead && (
        <BrochureSettingsModal
          lead={viewLead}
          onClose={() => setShowBrochure(false)}
        />
      )}
    </div>
  );
}

/* ---------- View Lead modal: all stored fields in one place ---------- */

function ViewLeadModal({ lead, onClose, onSendBrochure, onLeadUpdated }: {
  lead: Lead;
  onClose: () => void;
  onSendBrochure: () => void;
  onLeadUpdated?: (updated: Lead) => void;
}) {
  const cf = (lead as any).customFields || {};
  const notInterested = lead.status === 'lost' || (lead.tags || []).includes('not_interested');
  const followUpDue = !!cf.recommended_follow_up_time || (lead.tags || []).includes('callback_requested');

  // Inline email edit — lets the user correct/add an address before clicking
  // Send Brochure without leaving this modal.
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(lead.email || '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');

  const startEditEmail = () => {
    setEmailDraft(lead.email || '');
    setEmailError('');
    setEditingEmail(true);
  };
  const cancelEditEmail = () => {
    setEditingEmail(false);
    setEmailError('');
  };
  const saveEmail = async (): Promise<boolean> => {
    const next = emailDraft.trim();
    if (next && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setEmailError('Enter a valid email address');
      return false;
    }
    if (next === (lead.email || '')) { setEditingEmail(false); return true; }
    setSavingEmail(true);
    setEmailError('');
    try {
      const updated = await crmApi.updateLead(lead.id, { email: next } as any);
      onLeadUpdated?.({ ...lead, ...updated, email: next });
      setEditingEmail(false);
      return true;
    } catch (err: any) {
      setEmailError(err?.response?.data?.message || err?.message || 'Save failed');
      return false;
    } finally {
      setSavingEmail(false);
    }
  };

  // If the user clicks Send Brochure while still editing the email, flush
  // the edit first so the brochure goes to the address they just typed —
  // not the stale one stored on the lead.
  const handleSendBrochure = async () => {
    if (editingEmail) {
      const ok = await saveEmail();
      if (!ok) return;
    }
    onSendBrochure();
  };

  // Admissions-specific block — only renders rows when the post-call analyzer
  // actually captured the field. Each row labelled `admission` for visual
  // grouping (the modal renders all rows in order, with a section divider
  // injected when the section name changes).
  type Row = { label: string; value: React.ReactNode; icon?: React.ReactNode; section?: 'contact' | 'admission' | 'meta' };
  const dash = <span className="text-gray-400 italic">—</span>;
  const missing = <span className="text-gray-400 italic">not captured</span>;
  const showVal = (v: any, fallback: React.ReactNode = missing) => (v && String(v).trim() ? <span className="text-gray-800">{String(v)}</span> : fallback);

  const admissionRows: Row[] = [];
  if (cf.interested_university) admissionRows.push({ section: 'admission', label: 'Interested University', value: <span className="font-medium text-primary-700">{cf.interested_university}</span> });
  if (cf.interested_course) admissionRows.push({ section: 'admission', label: 'Course', value: showVal(cf.interested_course) });
  if (cf.interested_branch) admissionRows.push({ section: 'admission', label: 'Branch', value: showVal(cf.interested_branch) });
  if (cf.preferred_location) admissionRows.push({ section: 'admission', label: 'Preferred Location', value: showVal(cf.preferred_location) });
  if (cf.intermediate_percentage) admissionRows.push({ section: 'admission', label: 'Intermediate %', value: <span className="font-mono text-gray-800">{cf.intermediate_percentage}</span> });
  if (cf.intermediate_marks) admissionRows.push({ section: 'admission', label: 'Intermediate Marks', value: showVal(cf.intermediate_marks) });
  if (cf.eamcet_rank) admissionRows.push({ section: 'admission', label: 'EAMCET Rank', value: <span className="font-mono text-gray-800">{cf.eamcet_rank}</span> });
  if (cf.jee_rank) admissionRows.push({ section: 'admission', label: 'JEE Rank', value: <span className="font-mono text-gray-800">{cf.jee_rank}</span> });
  if (cf.diploma_status) admissionRows.push({ section: 'admission', label: 'Diploma Status', value: showVal(cf.diploma_status) });
  if (cf.category) admissionRows.push({ section: 'admission', label: 'Category', value: <Badge variant="outline">{cf.category}</Badge> });
  if (cf.hostel_required) admissionRows.push({ section: 'admission', label: 'Hostel Required', value: showVal(cf.hostel_required) });
  if (cf.parent_name) admissionRows.push({ section: 'admission', label: 'Parent Name', value: showVal(cf.parent_name) });
  if (cf.parent_mobile) admissionRows.push({ section: 'admission', label: 'Parent Mobile', value: <a href={`tel:${cf.parent_mobile}`} className="font-mono text-gray-800 hover:text-primary-600">{cf.parent_mobile}</a> });
  if (cf.budget) admissionRows.push({ section: 'admission', label: 'Budget', value: showVal(cf.budget) });

  // Action signals (booleans the analyzer extracted from the conversation).
  // Only render when ANY is true — empty action block is noise.
  const actionSignals: Array<[string, boolean | undefined]> = [
    ['Callback requested', cf.callback_required],
    ['Counselor meeting requested', cf.counselor_meeting_required],
    ['Brochure requested', cf.brochure_required],
    ['WhatsApp opt-in', cf.whatsapp_required],
    ['Email opt-in', cf.email_required],
  ];
  const activeSignals = actionSignals.filter(([, v]) => v === true);
  if (activeSignals.length > 0) {
    admissionRows.push({
      section: 'admission',
      label: 'Caller Asked For',
      value: <div className="flex flex-wrap gap-1">{activeSignals.map(([k]) => <Badge key={k} variant="info">{k}</Badge>)}</div>,
    });
  }

  // Review reasons surface when the post-call analyzer flagged something
  // (missing email, invalid mobile format, low interest etc.).
  const reviewReasons: string[] = Array.isArray(cf.review_reasons) ? cf.review_reasons : [];
  if (reviewReasons.length > 0) {
    admissionRows.push({
      section: 'admission',
      label: 'Needs review',
      value: <div className="flex flex-wrap gap-1">{reviewReasons.map((r: string) => <Badge key={r} variant="warning">{r.replace(/_/g, ' ')}</Badge>)}</div>,
    });
  }

  const rows: Row[] = [
    { section: 'contact', label: 'Name', value: lead.name },
    { section: 'contact', label: 'Mobile', icon: <Phone className="h-3.5 w-3.5 text-gray-400" />, value: lead.phone ? (
      <a href={`tel:${lead.phone}`} className="font-mono text-gray-800 hover:text-primary-600">{lead.phone}</a>
    ) : <span className="text-gray-400 italic">not provided</span> },
    { section: 'contact', label: 'Email', icon: <Mail className="h-3.5 w-3.5 text-gray-400" />, value: editingEmail ? (
      <div className="flex items-center gap-2">
        <input
          type="email"
          autoFocus
          value={emailDraft}
          onChange={(e) => { setEmailDraft(e.target.value); if (emailError) setEmailError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') saveEmail(); if (e.key === 'Escape') cancelEditEmail(); }}
          disabled={savingEmail}
          placeholder="name@example.com"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-100"
        />
        <button
          onClick={saveEmail}
          disabled={savingEmail}
          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
          title="Save"
        >
          {savingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={cancelEditEmail}
          disabled={savingEmail}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {emailError && <span className="text-[11px] text-danger-600 ml-1">{emailError}</span>}
      </div>
    ) : (
      <div className="flex items-center gap-2 group">
        {lead.email ? (
          <a href={`mailto:${lead.email}`} className="text-gray-800 hover:text-primary-600">{lead.email}</a>
        ) : (
          <span className="text-gray-400 italic">not provided</span>
        )}
        <button
          onClick={startEditEmail}
          className="p-1 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit email"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    ) },
    { section: 'contact', label: 'Company', icon: <Building2 className="h-3.5 w-3.5 text-gray-400" />, value: lead.company || dash },
    { section: 'contact', label: 'City', value: cf.city || dash },
    ...admissionRows,
    { section: 'meta', label: 'Status', value: (
      <span className="inline-flex items-center gap-2">
        <StatusBadge status={lead.status} />
        {cf.extended_lead_status && <Badge variant="info">{String(cf.extended_lead_status).replace(/_/g, ' ').toLowerCase()}</Badge>}
        {notInterested && <Badge variant="outline">not interested</Badge>}
        {followUpDue && <Badge variant="info">follow-up pending</Badge>}
      </span>
    ) },
    { section: 'meta', label: 'Call outcome', value: cf.call_outcome || dash },
    { section: 'meta', label: 'Follow-up time', value: cf.recommended_follow_up_time || dash },
    { section: 'meta', label: 'Follow-up reason', value: cf.follow_up_reason || dash },
    { section: 'meta', label: 'Score', value: <span className="font-semibold text-gray-900">{lead.score}/100</span> },
    ...(typeof cf.confidence_score === 'number' ? [{ section: 'meta' as const, label: 'AI Confidence', value: <span className="font-mono text-gray-800">{(cf.confidence_score * 100).toFixed(0)}%</span> }] : []),
    { section: 'meta', label: 'Source', value: <Badge variant="outline">{lead.source}</Badge> },
    { section: 'meta', label: 'Value', value: lead.value > 0 ? formatCurrency(lead.value) : dash },
    { section: 'meta', label: 'Tags', value: lead.tags && lead.tags.length > 0 ? (
      <div className="flex flex-wrap gap-1">{lead.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
    ) : dash },
    { section: 'meta', label: 'Notes', value: lead.notes || dash },
    { section: 'meta', label: 'Created', value: <span className="text-gray-700">{formatDate(lead.createdAt)}</span> },
    { section: 'meta', label: 'Updated', value: <span className="text-gray-700">{formatDate(lead.updatedAt)}</span> },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-600 flex items-center justify-center text-sm font-semibold">
              {lead.name[0]}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{lead.name}</h2>
              <p className="text-xs text-gray-500">{lead.company || 'No company'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-2">
          {(() => {
            const out: React.ReactNode[] = [];
            let prevSection: string | undefined;
            const SECTION_TITLES: Record<string, string> = {
              contact: 'Contact',
              admission: 'Admissions Details',
              meta: 'Lead Meta',
            };
            for (const r of rows) {
              if (r.section && r.section !== prevSection) {
                out.push(
                  <div key={`__section_${r.section}`} className="pt-3 first:pt-0 mt-1 first:mt-0">
                    <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">{SECTION_TITLES[r.section]}</h3>
                  </div>
                );
                prevSection = r.section;
              }
              out.push(
                <div key={r.label} className="grid grid-cols-3 gap-3 py-1.5 border-b border-gray-50 last:border-0">
                  <div className="col-span-1 inline-flex items-center gap-1.5 text-xs uppercase font-medium text-gray-500">
                    {r.icon}{r.label}
                  </div>
                  <div className="col-span-2 text-sm text-gray-800">{r.value}</div>
                </div>
              );
            }
            return out;
          })()}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Close</Button>
          <Button
            variant="gradient"
            onClick={handleSendBrochure}
            className="rounded-xl"
            disabled={savingEmail || (!lead.email && !lead.phone && !emailDraft.trim())}
          >
            {savingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Brochure
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Brochure send-settings (placeholder; user will configure later) ---------- */

interface BrochureConfig {
  channel: 'email' | 'whatsapp' | 'sms';
  brochure_url: string;
  message_template: string;
  subject: string;
}

const BROCHURE_CONFIG_KEY = 'crm.brochure.config';

function loadBrochureConfig(): BrochureConfig {
  try {
    const raw = localStorage.getItem(BROCHURE_CONFIG_KEY);
    if (raw) return { ...defaultBrochureConfig(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultBrochureConfig();
}

function defaultBrochureConfig(): BrochureConfig {
  return {
    channel: 'email',
    brochure_url: '',
    subject: 'Information you requested',
    message_template:
      "Hi {{name}},\n\nThanks for your interest. Please find the brochure attached: {{brochure_url}}.\n\nFeel free to reply with any questions.\n\nBest regards",
  };
}

function BrochureSettingsModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [cfg, setCfg] = useState<BrochureConfig>(loadBrochureConfig);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'success' | 'pending' | 'error' | null>(null);
  const [sendError, setSendError] = useState<string>('');

  const save = () => {
    try { localStorage.setItem(BROCHURE_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const channelAvailable = cfg.channel === 'email' ? !!lead.email : !!lead.phone;

  const renderTemplate = (tpl: string) =>
    tpl
      .replace(/\{\{\s*name\s*\}\}/g, lead.name || 'there')
      .replace(/\{\{\s*brochure_url\s*\}\}/g, cfg.brochure_url || '');

  const send = async () => {
    save();
    setSending(true);
    setSendResult(null);
    setSendError('');
    try {
      const body = renderTemplate(cfg.message_template);
      if (cfg.channel === 'email') {
        if (!lead.email) throw new Error('Lead has no email address');
        const { data } = await api.post('/communications/email/brochure', {
          lead_id: lead.id,
          recipient: lead.email,
          subject: cfg.subject || 'Information you requested',
          body,
          attachments: cfg.brochure_url ? [{ name: 'Brochure', url: cfg.brochure_url }] : [],
        });
        setSendResult(data?.ok ? 'success' : 'error');
        if (!data?.ok) setSendError('Email provider rejected the send. Check SMTP credentials.');
      } else if (cfg.channel === 'whatsapp') {
        if (!lead.phone) throw new Error('Lead has no phone number');
        const { data } = await api.post('/communications/whatsapp/send', {
          lead_id: lead.id,
          recipient: lead.phone,
          message: body,
          attachments: cfg.brochure_url ? [{ name: 'Brochure', url: cfg.brochure_url }] : [],
        });
        setSendResult(data?.ok ? 'success' : 'error');
        if (!data?.ok) {
          const raw = String(data?.error || '');
          if (/channel.*from address/i.test(raw)) {
            setSendError(`Twilio WhatsApp sandbox isn't enabled on this account. Open Twilio Console → Messaging → Try it out → Send a WhatsApp message, click "Confirm" to activate the sandbox, then have the recipient send the 2-word "join …" code to +1 415 523 8886 from their WhatsApp. Raw: ${raw}`);
          } else if (/63007|24h|session|opt[- ]?in/i.test(raw)) {
            setSendError(`Recipient hasn't sent the Twilio sandbox join code yet (or 24h session expired). Ask them to WhatsApp the "join …" code to +1 415 523 8886. Raw: ${raw}`);
          } else {
            setSendError(`WhatsApp send rejected by Twilio: ${raw || 'unknown error'}`);
          }
        }
      } else {
        // SMS
        if (!lead.phone) throw new Error('Lead has no phone number');
        const { data } = await api.post('/communications/sms/send', {
          lead_id: lead.id,
          recipient: lead.phone,
          message: body,
        });
        setSendResult(data?.ok ? 'success' : 'error');
        if (!data?.ok) {
          const raw = String(data?.error || '');
          if (/dlt|160/i.test(raw)) {
            setSendError(`Plivo can't deliver to Indian numbers without DLT registration. Register the sender + template on console.plivo.com → Messaging → DLT. Raw: ${raw}`);
          } else {
            setSendError(`SMS send rejected: ${raw || 'unknown error'}`);
          }
        }
      }
    } catch (err: any) {
      setSendResult('error');
      setSendError(err?.response?.data?.message || err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
              <Send className="h-4 w-4 text-primary-600" /> Send Brochure
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">To {lead.name} ({lead.phone || lead.email || 'no contact'})</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Channel</label>
          <div className="grid grid-cols-3 gap-2">
            {(['email', 'whatsapp', 'sms'] as const).map((ch) => {
              const Icon = ch === 'email' ? Mail : ch === 'whatsapp' ? MessageSquare : Phone;
              const active = cfg.channel === ch;
              return (
                <button
                  key={ch}
                  onClick={() => setCfg({ ...cfg, channel: ch })}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    active
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />{ch}
                </button>
              );
            })}
          </div>
          {!channelAvailable && (
            <p className="text-[11px] text-warning-600 mt-1.5 inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {cfg.channel === 'email' ? 'Lead has no email address' : 'Lead has no phone number'}
            </p>
          )}
        </div>

        <Input
          label="Brochure URL or file link"
          value={cfg.brochure_url}
          onChange={(e) => setCfg({ ...cfg, brochure_url: e.target.value })}
          placeholder="https://example.com/brochure.pdf"
        />

        {cfg.channel === 'email' && (
          <Input
            label="Subject line"
            value={cfg.subject}
            onChange={(e) => setCfg({ ...cfg, subject: e.target.value })}
            placeholder="Information you requested"
          />
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Message template</label>
          <textarea
            value={cfg.message_template}
            onChange={(e) => setCfg({ ...cfg, message_template: e.target.value })}
            rows={5}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="Use {{name}} and {{brochure_url}} placeholders"
          />
          <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Placeholders <code className="px-1 py-0.5 rounded bg-gray-100 text-gray-700">{'{{name}}'}</code> and <code className="px-1 py-0.5 rounded bg-gray-100 text-gray-700">{'{{brochure_url}}'}</code> are auto-filled per lead.
          </p>
        </div>

        {sendResult === 'success' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>Brochure sent to {cfg.channel === 'email' ? lead.email : lead.phone} via {cfg.channel}.</span>
          </div>
        )}
        {sendResult === 'pending' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-50 border border-warning-200 text-xs text-warning-800">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              {cfg.channel === 'email'
                ? "Settings saved. Brochure delivery isn't wired yet — provide the SendGrid/WhatsApp/SMS credentials and the send-handler will fire automatically."
                : `${cfg.channel.toUpperCase()} provider not configured — message queued, no real send happened. Wire a provider to enable delivery.`}
            </span>
          </div>
        )}
        {sendResult === 'error' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-800">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{sendError || 'Send failed.'}</span>
          </div>
        )}
        {saved && !sendResult && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Settings saved.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" onClick={save} className="rounded-xl">Save Settings</Button>
          <Button variant="gradient" onClick={send} disabled={sending || !channelAvailable || !cfg.brochure_url.trim()} className="rounded-xl">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending…' : 'Send Now'}
          </Button>
        </div>
      </div>
    </div>
  );
}
