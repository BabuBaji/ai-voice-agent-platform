import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Download, Trash2, Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Phone, Eye, Send, Mail, Building2, FileText, MessageSquare, CheckCircle2, Pencil, Check, Users, Sparkles, Trophy, UserCheck, Inbox, Filter, ListFilter, TrendingUp, Target, PhoneIncoming, Globe, Megaphone, UserPlus, ArrowUpRight } from 'lucide-react';
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
      const params: Record<string, any> = { page, limit, sort: 'created_at', order: 'desc' };
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
        const matchStatus = statusFilter === 'all' || (l.status || '').toUpperCase() === statusFilter.toUpperCase();
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
    new: displayed.filter((l) => (l.status || '').toUpperCase() === 'NEW').length,
    contacted: displayed.filter((l) => (l.status || '').toUpperCase() === 'CONTACTED').length,
    qualified: displayed.filter((l) => (l.status || '').toUpperCase() === 'QUALIFIED').length,
    interested: displayed.filter((l) => (l.status || '').toUpperCase() === 'INTERESTED').length,
    needs_review: displayed.filter((l) => (l.status || '').toUpperCase() === 'NEEDS_REVIEW').length,
    lost: displayed.filter((l) => ['UNQUALIFIED', 'LOST'].includes((l.status || '').toUpperCase())).length,
    avgScore: displayed.length > 0 ? Math.round(displayed.reduce((s, l) => s + (l.score || 0), 0) / displayed.length) : 0,
    totalValue: displayed.reduce((s, l) => s + (l.value || 0), 0),
  };

  const STATUS_PILLS = [
    { value: 'all',          label: 'All' },
    { value: 'NEW',          label: 'New' },
    { value: 'CONTACTED',    label: 'Contacted' },
    { value: 'INTERESTED',   label: 'Interested' },
    { value: 'QUALIFIED',    label: 'Qualified' },
    { value: 'NEEDS_REVIEW', label: 'Review' },
    { value: 'UNQUALIFIED',  label: 'Lost' },
  ];

  // Source icon mapping
  const SOURCE_ICONS: Record<string, { icon: typeof Phone; color: string }> = {
    'inbound-call': { icon: PhoneIncoming, color: 'text-teal-600 bg-teal-50' },
    website: { icon: Globe, color: 'text-blue-600 bg-blue-50' },
    referral: { icon: Users, color: 'text-purple-600 bg-purple-50' },
    outbound: { icon: Phone, color: 'text-indigo-600 bg-indigo-50' },
    campaign: { icon: Megaphone, color: 'text-amber-600 bg-amber-50' },
    manual: { icon: UserPlus, color: 'text-gray-600 bg-gray-50' },
  };

  // Funnel data for mini pipeline
  const funnelStages = [
    { key: 'new', label: 'New', count: kpis.new, color: 'bg-blue-500' },
    { key: 'contacted', label: 'Contacted', count: kpis.contacted, color: 'bg-cyan-500' },
    { key: 'qualified', label: 'Qualified', count: kpis.qualified, color: 'bg-purple-500' },
    { key: 'proposal', label: 'Proposal', count: kpis.proposal, color: 'bg-amber-500' },
    { key: 'won', label: 'Won', count: kpis.won, color: 'bg-emerald-500' },
    { key: 'lost', label: 'Lost', count: kpis.lost, color: 'bg-gray-400' },
  ];
  const funnelMax = Math.max(1, ...funnelStages.map((s) => s.count));

  return (
    <div className="max-w-[1440px] mx-auto space-y-5">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-gray-900 tracking-tight">Leads</h1>
          <p className="text-xs text-gray-500 mt-0.5">Auto-scored from calls, campaigns, and web forms — brochures + follow-ups automated</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs"><Download className="h-3.5 w-3.5" />Export</Button>
          <Button variant="gradient" size="sm" className="rounded-lg h-8 text-xs" onClick={() => { setAddError(''); setShowAdd(true); }}>
            <Plus className="h-3.5 w-3.5" />Add Lead
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

      {/* ─── KPI strip ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Leads', value: kpis.total,     icon: Users,      color: 'text-primary-600 bg-primary-50' },
          { label: 'New',         value: kpis.new,        icon: Sparkles,   color: 'text-blue-600 bg-blue-50' },
          { label: 'Qualified',   value: kpis.qualified,  icon: UserCheck,  color: 'text-purple-600 bg-purple-50' },
          { label: 'Won',         value: kpis.won,        icon: Trophy,     color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Avg Score',   value: kpis.avgScore,   icon: Target,     color: 'text-amber-600 bg-amber-50' },
          { label: 'Pipeline',    value: kpis.totalValue > 0 ? formatCurrency(kpis.totalValue) : '$0', icon: TrendingUp, color: 'text-teal-600 bg-teal-50' },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-gray-100 bg-white px-3.5 py-2.5 shadow-card flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${k.color}`}><Icon className="h-4 w-4" /></div>
              <div>
                <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{k.label}</p>
                <p className="text-base font-display font-extrabold text-gray-900 tabular-nums">{k.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Mini pipeline funnel ─── */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-card">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Lead Pipeline</p>
        <div className="flex items-end gap-1.5 h-12">
          {funnelStages.map((s) => {
            const pct = Math.max(6, (s.count / funnelMax) * 100);
            return (
              <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-gray-700 tabular-nums">{s.count}</span>
                <div className="w-full rounded-t-sm overflow-hidden bg-gray-100" style={{ height: '32px' }}>
                  <div className={`w-full ${s.color} rounded-t-sm transition-all duration-500`} style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }} />
                </div>
                <span className="text-[9px] text-gray-500 font-medium truncate w-full text-center">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Filter bar ─── */}
      <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-white/80 backdrop-blur border border-gray-100 shadow-card">
        <div className="relative flex-1 max-w-xs min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input type="text" placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
        </div>

        <div className="h-5 w-px bg-gray-200 hidden sm:block" />

        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 cursor-pointer font-medium">
          <option value="all">All sources</option>
          <option value="inbound-call">Inbound Call</option>
          <option value="outbound-call">Outbound Call</option>
          <option value="web-call">Web Call</option>
          <option value="website">Website</option>
          <option value="referral">Referral</option>
          <option value="campaign">Campaign</option>
        </select>

        <div className="h-5 w-px bg-gray-200 hidden sm:block" />

        <div className="inline-flex items-center gap-1 p-0.5 bg-gray-50 rounded-lg">
          {STATUS_PILLS.map((s) => {
            const isActive = statusFilter === s.value;
            return (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {(statusFilter !== 'all' || sourceFilter !== 'all' || search) && (
          <button onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setSearch(''); }}
            className="text-[11px] text-gray-500 hover:text-gray-800 font-medium ml-1">Clear all</button>
        )}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[11px] text-gray-600 font-semibold">{selectedIds.length} selected</span>
            <Button variant="danger" size="sm" onClick={handleDeleteSelected} className="rounded-lg h-7 text-[11px]">
              <Trash2 className="h-3 w-3" />Delete
            </Button>
          </div>
        )}
      </div>

      {/* ─── Table ─── */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card py-16 flex items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary-600" />
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="w-9 px-2 py-2.5 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.length > 0 && selectedIds.length === displayed.length}
                      onChange={(e) => setSelectedIds(e.target.checked ? displayed.map((l) => l.id) : [])}
                      className="rounded border-gray-300 text-primary-600"
                    />
                  </th>
                  <th className="w-14 px-2 py-2.5"></th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Lead</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Mobile</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Email</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Status</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Source</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Score</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Value</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-16 text-center">
                      <Inbox className="h-10 w-10 text-gray-200 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-gray-600">No leads match your filters</p>
                      <p className="text-xs text-gray-400 mt-1">Adjust the search or add a new lead.</p>
                    </td>
                  </tr>
                )}
                {displayed.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  const scoreColor = item.score >= 80 ? 'text-emerald-600' : item.score >= 50 ? 'text-amber-600' : 'text-gray-400';
                  const scoreBar = item.score >= 80 ? 'bg-emerald-500' : item.score >= 50 ? 'bg-amber-500' : 'bg-gray-300';
                  const srcCfg = SOURCE_ICONS[item.source] || SOURCE_ICONS.manual;
                  const SrcIcon = srcCfg.icon;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/crm/leads/${item.id}`)}
                      className={`group border-b border-gray-50 last:border-0 hover:bg-primary-50/30 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary-50/20' : ''
                      }`}
                    >
                      <td className="px-2 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded border-gray-300 text-primary-600 h-3.5 w-3.5"
                        />
                      </td>
                      <td className="px-2 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setViewLead(item)}
                          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-primary-50 hover:bg-primary-100 text-primary-700 text-[10px] font-semibold transition-colors"
                          title="View all details"
                        >
                          <Eye className="h-2.5 w-2.5" /> View
                        </button>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-400 to-accent-400 text-white flex items-center justify-center text-[11px] font-bold shadow-sm flex-shrink-0">
                            {item.name[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0 leading-none">
                            <p className="font-semibold text-gray-900 truncate text-xs">{item.name}</p>
                            {item.company && <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.company}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                        {item.phone ? (
                          <a href={`tel:${item.phone}`} className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-700 hover:text-primary-600" title="Click to dial">
                            <Phone className="h-2.5 w-2.5 text-gray-400" />{item.phone}
                          </a>
                        ) : <span className="text-[10px] text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {item.email
                          ? <span className="text-[11px] text-gray-700 truncate block max-w-[160px]">{item.email}</span>
                          : <span className="text-[10px] text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 align-middle"><StatusBadge status={item.status} /></td>
                      <td className="px-3 py-2 align-middle">
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${srcCfg.color}`}>
                          <SrcIcon className="h-2.5 w-2.5" />
                          {sourceLabels[item.source] || item.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-1.5">
                          <div className="w-10 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBar} transition-all`} style={{ width: `${item.score}%` }} />
                          </div>
                          <span className={`text-[11px] font-bold tabular-nums ${scoreColor}`}>{item.score}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="text-[11px] font-semibold text-gray-800">{item.value > 0 ? formatCurrency(item.value) : <span className="text-gray-300">—</span>}</span>
                      </td>
                      <td className="px-3 py-2 align-middle"><span className="text-[11px] text-gray-500">{formatDate(item.createdAt)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between bg-gray-50/30">
            <p className="text-[11px] text-gray-500">Showing <span className="font-semibold text-gray-800">{displayed.length}</span> of <span className="font-semibold text-gray-800">{total}</span></p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg h-7 w-7 p-0"><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="text-[11px] text-gray-600 px-2 font-medium">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg h-7 w-7 p-0"><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead modal */}
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
    ...((cf.alt_phone || cf.dialed_number) ? [{ section: 'contact' as const, label: 'Dialed Number', icon: <PhoneIncoming className="h-3.5 w-3.5 text-gray-400" />, value: (
      <a href={`tel:${cf.alt_phone || cf.dialed_number}`} className="font-mono text-gray-500 hover:text-primary-600">{(cf.alt_phone || cf.dialed_number || '').replace(/^\+91/, '')}</a>
    ) }] : []),
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
  /** When channel='whatsapp', the operator picks one of the tenant's
   *  synced Meta templates. Free-text sends are only allowed in the 24h
   *  window after the recipient has messaged us; otherwise the empty
   *  value here means "no template" → Meta returns RE_ENGAGEMENT_WINDOW_CLOSED. */
  whatsapp_template_id?: string;
}

/** One row from /whatsapp/templates. We only need the fields shown in the
 *  picker dropdown + the variable_mapping (for the optional preview). */
interface WaTemplateOption {
  id: string;
  name: string;
  language: string;
  status: string;
  variable_count: number;
}

// Bump the version suffix when changing defaultBrochureConfig() — old
// browser-saved configs under the previous key get ignored, so all users
// pick up the new default without manually clicking Reset.
const BROCHURE_CONFIG_KEY = 'crm.brochure.config.v2';

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
    // Default body weaves the lead's admissions context in conversationally.
    // Every {{*_clause}} placeholder is a smart fragment: if the underlying
    // field is empty, the clause (and any surrounding punctuation it owns)
    // vanishes — so a sparse lead doesn't produce orphan commas or "at ."
    message_template:
      "Hi {{name}},\n\n" +
      "Thanks for your interest in B.Tech admissions{{college_clause}}.\n" +
      "Here's the official brochure: {{brochure_url}}\n\n" +
      "Our counselor will reach out tomorrow to walk you through the admission process. " +
      "Reply here if you have any quick questions.\n\n" +
      "Best regards",
  };
}

interface LeadContext {
  name: string | null;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  location: string | null;
  city: string | null;
  parent_name: string | null;
  parent_mobile: string | null;
  next_call_time: string | null;
  next_call_time_iso: string | null;
  next_call_source: 'recall_queue' | 'follow_up_task' | 'agent_promise' | null;
  callback_requested: boolean;
  agent_name: string | null;
  lead_status: string | null;
}

function BrochureSettingsModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [cfg, setCfg] = useState<BrochureConfig>(loadBrochureConfig);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'success' | 'pending' | 'error' | null>(null);
  const [sendError, setSendError] = useState<string>('');
  const [ctx, setCtx] = useState<LeadContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);
  // `liveMessage` is the WYSIWYG textarea content — what the user sees and
  // what gets sent. The saved template in `cfg.message_template` keeps its
  // {{placeholders}} so it stays reusable across leads; we resolve them into
  // `liveMessage` once ctx arrives. User edits go straight into liveMessage.
  const [liveMessage, setLiveMessage] = useState<string>('');
  const [liveMessageDirty, setLiveMessageDirty] = useState(false);
  // WhatsApp template catalogue for the picker. Loaded lazily — only when
  // channel === 'whatsapp' to avoid an unnecessary fetch on the email path.
  const [waTemplates, setWaTemplates] = useState<WaTemplateOption[]>([]);
  useEffect(() => {
    if (cfg.channel !== 'whatsapp') return;
    api.get<{ templates: WaTemplateOption[] }>('/whatsapp/templates')
      .then((r) => setWaTemplates(r.data.templates || []))
      .catch(() => setWaTemplates([]));
  }, [cfg.channel]);

  // Fetch the merged lead context (CRM custom_fields + recall queue + agent)
  // on open so the message template has real values to interpolate.
  useEffect(() => {
    let cancelled = false;
    setCtxLoading(true);
    api.get(`/communications/lead-context/${lead.id}`)
      .then((r: any) => { if (!cancelled) setCtx(r.data as LeadContext); })
      .catch(() => { if (!cancelled) setCtx(null); })
      .finally(() => { if (!cancelled) setCtxLoading(false); });
    return () => { cancelled = true; };
  }, [lead.id]);

  const save = () => {
    try { localStorage.setItem(BROCHURE_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  // As soon as ctx lands (or the saved template changes via "Reset"), bake
  // the lead-specific placeholders into the textarea content. `{{brochure_url}}`
  // stays a placeholder so it tracks edits to the URL input live.
  // We do NOT clobber user edits — the moment they type, `liveMessageDirty`
  // flips true and this effect stops overwriting their work.
  useEffect(() => {
    if (liveMessageDirty) return;
    if (ctxLoading) return;
    setLiveMessage(renderTemplate(cfg.message_template, { skipBrochureUrl: true }));
    // renderTemplate depends on ctx + cfg.brochure_url + cfg.message_template;
    // we re-run when any of those change so the textarea keeps reflecting the
    // current lead's data (until the user starts editing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ctxLoading, cfg.message_template, liveMessageDirty]);

  const channelAvailable = cfg.channel === 'email' ? !!lead.email : !!lead.phone;

  /**
   * Resolve every supported placeholder. `*_clause` variants are smart fragments
   * that gracefully omit themselves (and any surrounding punctuation) when the
   * underlying value is missing — so a lead with no scheduled callback doesn't
   * end up with "I'll call you back at ." in their inbox.
   *
   * `skipBrochureUrl` keeps `{{brochure_url}}` as-is so the textarea can render
   * with the lead's name + admissions data baked in while the brochure URL
   * input above stays the live source for the URL itself.
   */
  const renderTemplate = (tpl: string, opts: { skipBrochureUrl?: boolean } = {}): string => {
    const name = ctx?.name || lead.name || 'there';
    const college = ctx?.college || '';
    const course = ctx?.course || (cfg.channel === 'email' ? 'our program' : 'the course');
    const branch = ctx?.branch || '';
    const location = ctx?.location || '';
    const city = ctx?.city || '';
    const phone = ctx?.phone || lead.phone || '';
    const email = ctx?.email || lead.email || '';
    const nextCall = ctx?.next_call_time || '';
    const agentName = ctx?.agent_name || 'the Admissions team';

    const collegeClause = college ? ` at ${college}` : '';
    const branchClause = branch ? ` (${branch})` : '';
    const cityClause = city ? ` in ${city}` : '';
    // The next-call value can be either a scheduled timestamp ("Wednesday,
    // 20 May at 4:23 pm") or a free-text agent promise ("within 24h",
    // "tomorrow morning"). For timestamps we prefix "on"; for phrases we
    // leave it standalone so we don't get "on within 24h".
    const looksLikeTimestamp = /^[A-Z][a-z]+day,?\s|at\s\d{1,2}[:.]/.test(nextCall);
    const nextCallClause = nextCall
      ? looksLikeTimestamp
        ? `I'll personally follow up with you on ${nextCall}.\n\n`
        : `I'll personally follow up with you ${nextCall}.\n\n`
      : '';

    let out = tpl.replace(/\{\{\s*name\s*\}\}/g, name);
    if (!opts.skipBrochureUrl) {
      out = out.replace(/\{\{\s*brochure_url\s*\}\}/g, cfg.brochure_url || '');
    }
    return out
      .replace(/\{\{\s*college\s*\}\}/g, college || 'your preferred college')
      .replace(/\{\{\s*college_clause\s*\}\}/g, collegeClause)
      .replace(/\{\{\s*course\s*\}\}/g, course)
      .replace(/\{\{\s*branch\s*\}\}/g, branch || '')
      .replace(/\{\{\s*branch_clause\s*\}\}/g, branchClause)
      .replace(/\{\{\s*location\s*\}\}/g, location || '')
      .replace(/\{\{\s*city\s*\}\}/g, city || '')
      .replace(/\{\{\s*city_clause\s*\}\}/g, cityClause)
      .replace(/\{\{\s*phone\s*\}\}/g, phone)
      .replace(/\{\{\s*email\s*\}\}/g, email)
      .replace(/\{\{\s*next_call_time\s*\}\}/g, nextCall || 'soon')
      .replace(/\{\{\s*next_call_clause\s*\}\}/g, nextCallClause)
      .replace(/\{\{\s*agent_name\s*\}\}/g, agentName);
  };

  const send = async () => {
    save();
    setSending(true);
    setSendResult(null);
    setSendError('');
    try {
      // liveMessage has all lead-specific placeholders already baked in (it's
      // what the user sees in the textarea). Final pass only resolves
      // {{brochure_url}} which is tied live to the URL input above.
      const body = renderTemplate(liveMessage);
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
        // When the user picked a template, also pass the resolution context
        // so the server can fill {{1}}, {{2}}, ... per the template's
        // variable_mapping. Lead context mirrors the dotted paths the
        // resolveTemplateVariables helper understands (lead.name, brochure_url).
        const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
        const { data } = await api.post('/communications/whatsapp/send', {
          lead_id: lead.id,
          recipient: lead.phone,
          message: body,
          template_id: cfg.whatsapp_template_id || undefined,
          context: cfg.whatsapp_template_id ? {
            lead: { name: leadName, first_name: lead.first_name, email: lead.email, phone: lead.phone },
            brochure_url: cfg.brochure_url || '',
          } : undefined,
          attachments: cfg.brochure_url ? [{ name: 'Brochure', url: cfg.brochure_url }] : [],
        });
        setSendResult(data?.ok ? 'success' : 'error');
        if (!data?.ok) {
          const raw = String(data?.error || '');
          if (/131030|not in allowed list|allowed recipients/i.test(raw)) {
            setSendError(`Meta test number can only message allow-listed recipients. Go to Meta Business → WhatsApp Manager → API Setup → "To" → Manage phone number list → add this recipient (max 5 on test numbers). Raw: ${raw}`);
          } else if (/131047|RE_ENGAGEMENT|24h.*window|template_required/i.test(raw)) {
            setSendError(`Outside 24h session window. First-contact messages must use an approved Meta template (set META_WA_TEMPLATE_NAME). Raw: ${raw}`);
          } else if (/AUTH_FAILED|190|token.*expired/i.test(raw)) {
            setSendError(`Meta access token invalid or expired. Generate a System User token (Meta Business Settings → System Users) and update META_WA_ACCESS_TOKEN. Raw: ${raw}`);
          } else if (/channel.*from address/i.test(raw)) {
            setSendError(`Twilio WhatsApp sandbox isn't enabled. Open Twilio Console → Messaging → Try it out → Send a WhatsApp message, click "Confirm", then have the recipient send the 2-word "join …" code to +1 415 523 8886. Raw: ${raw}`);
          } else if (/63007|sandbox.*not.*joined/i.test(raw)) {
            setSendError(`Recipient hasn't joined the Twilio sandbox. Ask them to WhatsApp the "join …" code to +1 415 523 8886. Raw: ${raw}`);
          } else {
            setSendError(`WhatsApp send rejected: ${raw || 'unknown error'}`);
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

        {cfg.channel === 'whatsapp' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              WhatsApp template <span className="text-gray-400">(required for first contact)</span>
            </label>
            <select
              value={cfg.whatsapp_template_id || ''}
              onChange={(e) => setCfg({ ...cfg, whatsapp_template_id: e.target.value || undefined })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— free text (24h window only) —</option>
              {waTemplates.map((t) => (
                <option
                  key={t.id}
                  value={t.name}
                  disabled={t.status === 'REJECTED' || t.status === 'DISABLED'}
                >
                  {t.name} · {t.language} · {t.status}
                  {t.variable_count > 0 ? ` · ${t.variable_count} vars` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              For first-contact or outside-24h sends Meta requires an approved template.
              The lead's name and brochure URL are passed automatically; the template's
              variable_mapping decides which slot they fill.
              {waTemplates.length === 0 && (
                <> No templates synced yet — open <strong>WA Templates</strong> in the sidebar and click <em>Sync from Meta</em>.</>
              )}
            </p>
          </div>
        )}

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
            value={liveMessage}
            onChange={(e) => { setLiveMessage(e.target.value); setLiveMessageDirty(true); }}
            rows={5}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="Loading message…"
          />
          <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {ctxLoading
              ? <>Loading <strong>{lead.name}</strong>'s details…</>
              : <>Personalised for <strong>{ctx?.name || lead.name}</strong>. <code className="px-1 py-0.5 rounded bg-gray-100 text-gray-700">{'{{brochure_url}}'}</code> auto-fills from the URL above on send.</>}
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
