import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Download, Trash2, Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Phone, Eye, Send, Mail, Building2, FileText, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { Input } from '@/components/ui/Input';
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and track your sales leads</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="rounded-xl"><Download className="h-4 w-4" />Export</Button>
          <Button variant="gradient" className="rounded-xl" onClick={() => { setAddError(''); setShowAdd(true); }}>
            <Plus className="h-4 w-4" />Add Lead
          </Button>
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
          <input type="text" placeholder="Search by name, email, phone, company..." value={search} onChange={(e) => setSearch(e.target.value)}
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
          <Table columns={columns} data={displayed} onRowClick={(item) => navigate(`/crm/leads/${item.id}`)} />{showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !adding && setShowAdd(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Lead</h2>
              <button onClick={() => setShowAdd(false)} disabled={adding} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Input label="Full name *" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Priya Sharma" />
            <Input label="Email" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="name@example.com" />
            <Input label="Phone" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="+91 98xxxxxx21" />
            <Input label="Company" value={addForm.company} onChange={(e) => setAddForm({ ...addForm, company: e.target.value })} placeholder="(optional)" />
            {addError && (
              <div className="text-sm text-error-600 bg-error-50 border border-error-100 rounded-lg px-3 py-2">{addError}</div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)} disabled={adding} className="rounded-xl">Cancel</Button>
              <Button variant="gradient" onClick={handleAddLead} disabled={adding} className="rounded-xl">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {adding ? 'Saving...' : 'Save Lead'}
              </Button>
            </div>
          </div>
        </div>
      )}
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

      {viewLead && (
        <ViewLeadModal
          lead={viewLead}
          onClose={() => setViewLead(null)}
          onSendBrochure={() => setShowBrochure(true)}
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

function ViewLeadModal({ lead, onClose, onSendBrochure }: {
  lead: Lead;
  onClose: () => void;
  onSendBrochure: () => void;
}) {
  const cf = (lead as any).customFields || {};
  const notInterested = lead.status === 'lost' || (lead.tags || []).includes('not_interested');
  const followUpDue = !!cf.recommended_follow_up_time || (lead.tags || []).includes('callback_requested');

  const rows: Array<{ label: string; value: React.ReactNode; icon?: React.ReactNode }> = [
    { label: 'Name', value: lead.name },
    { label: 'Mobile', icon: <Phone className="h-3.5 w-3.5 text-gray-400" />, value: lead.phone ? (
      <a href={`tel:${lead.phone}`} className="font-mono text-gray-800 hover:text-primary-600">{lead.phone}</a>
    ) : <span className="text-gray-400 italic">not provided</span> },
    { label: 'Email', icon: <Mail className="h-3.5 w-3.5 text-gray-400" />, value: lead.email ? (
      <a href={`mailto:${lead.email}`} className="text-gray-800 hover:text-primary-600">{lead.email}</a>
    ) : <span className="text-gray-400 italic">not provided</span> },
    { label: 'Interested University',
      value: cf.interested_university
        ? <span className="font-medium text-primary-700">{cf.interested_university}</span>
        : <span className="text-gray-400 italic">not captured</span>,
    },
    { label: 'Company', icon: <Building2 className="h-3.5 w-3.5 text-gray-400" />, value: lead.company || <span className="text-gray-400 italic">—</span> },
    { label: 'Status', value: (
      <span className="inline-flex items-center gap-2">
        <StatusBadge status={lead.status} />
        {notInterested && <Badge variant="outline">not interested</Badge>}
        {followUpDue && <Badge variant="info">follow-up pending</Badge>}
      </span>
    ) },
    { label: 'Call outcome', value: cf.call_outcome || <span className="text-gray-400 italic">—</span> },
    { label: 'Follow-up time', value: cf.recommended_follow_up_time || <span className="text-gray-400 italic">—</span> },
    { label: 'Follow-up reason', value: cf.follow_up_reason || <span className="text-gray-400 italic">—</span> },
    { label: 'City', value: cf.city || <span className="text-gray-400 italic">—</span> },
    { label: 'Source', value: <Badge variant="outline">{lead.source}</Badge> },
    { label: 'Score', value: <span className="font-semibold text-gray-900">{lead.score}/100</span> },
    { label: 'Value', value: lead.value > 0 ? formatCurrency(lead.value) : <span className="text-gray-400 italic">—</span> },
    { label: 'Tags', value: lead.tags && lead.tags.length > 0 ? (
      <div className="flex flex-wrap gap-1">{lead.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
    ) : <span className="text-gray-400 italic">—</span> },
    { label: 'Notes', value: lead.notes || <span className="text-gray-400 italic">—</span> },
    { label: 'Created', value: <span className="text-gray-700">{formatDate(lead.createdAt)}</span> },
    { label: 'Updated', value: <span className="text-gray-700">{formatDate(lead.updatedAt)}</span> },
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
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-3 gap-3 py-1.5 border-b border-gray-50 last:border-0">
              <div className="col-span-1 inline-flex items-center gap-1.5 text-xs uppercase font-medium text-gray-500">
                {r.icon}{r.label}
              </div>
              <div className="col-span-2 text-sm text-gray-800">{r.value}</div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Close</Button>
          <Button variant="gradient" onClick={onSendBrochure} className="rounded-xl" disabled={!lead.email && !lead.phone}>
            <Send className="h-4 w-4" /> Send Brochure
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
  const [sendResult, setSendResult] = useState<'success' | 'pending' | null>(null);

  const save = () => {
    try { localStorage.setItem(BROCHURE_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const channelAvailable = cfg.channel === 'email' ? !!lead.email : !!lead.phone;

  const send = async () => {
    save();
    setSending(true);
    setSendResult(null);
    // Placeholder send — when the user wires the real brochure delivery
    // (SendGrid / Twilio WhatsApp / Plivo SMS), this is where the API call
    // goes. For now we simulate and surface a "pending — settings saved"
    // confirmation so the flow is wired end-to-end in the UI.
    await new Promise((r) => setTimeout(r, 700));
    setSending(false);
    setSendResult('pending');
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

        {sendResult === 'pending' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-50 border border-warning-200 text-xs text-warning-800">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Settings saved. Brochure delivery isn't wired yet — provide the SendGrid/WhatsApp/SMS credentials and the send-handler will fire automatically.
            </span>
          </div>
        )}
        {saved && sendResult !== 'pending' && (
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
