import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, Plus, Search, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { campaignApi, type Campaign } from '@/services/campaign.api';
import { agentApi } from '@/services/agent.api';
import { phoneNumberApi, type PhoneNumberRecord } from '@/services/phoneNumber.api';
import { formatDate } from '@/utils/formatters';

// OmniDim-style status labels mapped to our internal statuses. We display the
// richer OmniDim list in the filter dropdown but only DRAFT / RUNNING / PAUSED /
// COMPLETED ever come back from the backend right now.
const STATUS_OPTIONS = [
  { value: 'all',           label: 'All statuses' },
  { value: 'DRAFT',         label: 'Draft' },
  { value: 'SCHEDULED',     label: 'Scheduled' },
  { value: 'RUNNING',       label: 'In Progress' },
  { value: 'WAITING',       label: 'Waiting' },
  { value: 'PAUSED',        label: 'Paused' },
  { value: 'AUTO_PAUSED',   label: 'Auto Paused' },
  { value: 'COMPLETED',     label: 'Completed' },
  { value: 'FAILED',        label: 'Failed' },
  { value: 'CANCELLED',     label: 'Cancelled' },
  { value: 'RETRY',         label: 'Retry Scheduled' },
];

// Status pill colours that match OmniDim's palette
function statusPill(status: string): { bg: string; fg: string; label: string } {
  const s = (status || 'DRAFT').toUpperCase();
  switch (s) {
    case 'RUNNING':   return { bg: 'bg-blue-500/20',    fg: 'text-blue-300',    label: 'In Progress' };
    case 'WAITING':   return { bg: 'bg-amber-500/20',   fg: 'text-amber-300',   label: 'Waiting' };
    case 'PAUSED':    return { bg: 'bg-amber-500/20',   fg: 'text-amber-300',   label: 'Paused' };
    case 'AUTO_PAUSED': return { bg: 'bg-amber-500/20', fg: 'text-amber-300',   label: 'Auto Paused' };
    case 'COMPLETED': return { bg: 'bg-emerald-500/20', fg: 'text-emerald-300', label: 'Completed' };
    case 'FAILED':    return { bg: 'bg-red-500/20',     fg: 'text-red-300',     label: 'Failed' };
    case 'CANCELLED': return { bg: 'bg-slate-500/20',   fg: 'text-slate-300',   label: 'Cancelled' };
    case 'SCHEDULED': return { bg: 'bg-violet-500/20',  fg: 'text-violet-300',  label: 'Scheduled' };
    case 'RETRY':     return { bg: 'bg-orange-500/20',  fg: 'text-orange-300',  label: 'Retry Scheduled' };
    default:          return { bg: 'bg-slate-500/20',   fg: 'text-slate-300',   label: 'Draft' };
  }
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [botFilter, setBotFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reload = async () => {
    setLoading(true);
    try {
      const [list, agentList] = await Promise.all([
        campaignApi.list(),
        agentApi.list().catch(() => [] as any[]),
      ]);
      setCampaigns(list);
      const arr = Array.isArray(agentList) ? agentList : (agentList as any)?.data || [];
      setAgents(arr.map((a: any) => ({ id: a.id, name: a.name })));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || '—';

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (botFilter !== 'all' && c.agent_id !== botFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !(c.from_number || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, statusFilter, botFilter, search]);

  const allChecked = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const someChecked = filtered.some((c) => selected.has(c.id)) && !allChecked;
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        filtered.forEach((c) => next.delete(c.id));
      } else {
        filtered.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Total concurrent limit (sum of all RUNNING campaign concurrencies — simple proxy)
  const totalConcurrent = campaigns
    .filter((c) => c.status === 'RUNNING')
    .reduce((sum, c) => sum + (c.concurrency || 1), 0);
  const concurrentLimit = Math.max(1, totalConcurrent);

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bulk Call Campaigns</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and monitor your bulk call campaigns.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700">
            Total Concurrent Limit: {concurrentLimit}
          </span>
          <Button variant="gradient" onClick={() => navigate('/campaigns/new')} className="rounded-xl">
            <Plus className="h-4 w-4" /> Create New Campaign
          </Button>
        </div>
      </div>

      {/* ─── Filters ─── */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Filter by</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={botFilter}
            onChange={(e) => setBotFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="all">All bots</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ─── Table ─── */}
      <Card padding={false} className="shadow-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  className="accent-primary-600 cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Bot</th>
              <th className="text-left px-4 py-3 font-medium">From Number</th>
              <th className="text-left px-4 py-3 font-medium">Progress</th>
              <th className="text-left px-4 py-3 font-medium">Concurrent Calls</th>
              <th className="text-left px-4 py-3 font-medium">Created Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600 mx-auto" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <Inbox className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700">No bulk call campaigns found.</p>
                  <p className="text-xs text-gray-400 mt-1">Try creating a new campaign to get started.</p>
                </td>
              </tr>
            ) : filtered.map((c) => {
              const total = c.target_count || 0;
              const done = c.completed_count || 0;
              const failed = c.failed_count || 0;
              const inProgress = c.in_progress_count || 0;
              const completedPct = total > 0 ? Math.round((done / total) * 100) : 0;
              const pill = statusPill(c.status);
              return (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer transition-colors" onClick={() => navigate(`/campaigns/${c.id}`)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      className="accent-primary-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.description && <div className="text-xs text-gray-500 line-clamp-1">{c.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium ${pill.bg} ${pill.fg}`}>
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{agentName(c.agent_id)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.from_number}</td>
                  <td className="px-4 py-3 min-w-[180px]">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-600">{done + failed} / {total}</span>
                      <span className="text-gray-400">{completedPct}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-success-500 h-1.5 transition-all" style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="font-mono">{inProgress}</span>
                    <span className="text-xs text-gray-400"> / {c.concurrency}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(c.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

    </div>
  );
}

/* ---------- Create modal ---------- */

function CreateCampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Campaign) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberRecord[]>([]);
  const [fromNumber, setFromNumber] = useState('');
  const [provider, setProvider] = useState<'plivo' | 'twilio' | 'exotel'>('plivo');
  const [concurrency, setConcurrency] = useState(1);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [retryDelay, setRetryDelay] = useState(900);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    agentApi.list().then((a: any) => {
      const list = (Array.isArray(a) ? a : a?.data || []).map((x: any) => ({ id: x.id, name: x.name }));
      setAgents(list);
      if (list.length && !agentId) setAgentId(list[0].id);
    }).catch(() => {});
    phoneNumberApi.list().then((nums) => {
      setPhoneNumbers(nums);
      if (nums.length && !fromNumber) setFromNumber(nums[0].phone_number);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!name.trim() || !agentId || !fromNumber.trim()) {
      setErr('Name, agent, and from-number are required.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const c = await campaignApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        agent_id: agentId,
        from_number: fromNumber.trim(),
        provider,
        concurrency,
        max_attempts: maxAttempts,
        retry_delay_seconds: retryDelay,
      } as any);
      onCreated(c);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New Campaign" size="lg">
      <div className="space-y-4">
        {err && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
            <AlertCircle className="h-3.5 w-3.5" /> {err}
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-gray-700">Campaign name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            placeholder="Q2 Outbound — Karnataka leads" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Agent *</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
              <option value="">Select agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as any)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
              <option value="plivo">Plivo</option>
              <option value="twilio">Twilio</option>
              <option value="exotel">Exotel</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">From number *</label>
          {phoneNumbers.length > 0 ? (
            <select value={fromNumber} onChange={(e) => setFromNumber(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono">
              <option value="">Select number…</option>
              {phoneNumbers.map((n) => <option key={n.id} value={n.phone_number}>{n.phone_number} ({n.provider})</option>)}
            </select>
          ) : (
            <input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono"
              placeholder="+912264236763" />
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Concurrency</label>
            <input type="number" min={1} max={10} value={concurrency}
              onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            <p className="text-[11px] text-gray-400 mt-1">Calls in parallel</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Max attempts</label>
            <input type="number" min={1} max={5} value={maxAttempts}
              onChange={(e) => setMaxAttempts(parseInt(e.target.value) || 1)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            <p className="text-[11px] text-gray-400 mt-1">Per target</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Retry delay (s)</label>
            <input type="number" min={60} max={86400} value={retryDelay}
              onChange={(e) => setRetryDelay(parseInt(e.target.value) || 900)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
            <p className="text-[11px] text-gray-400 mt-1">Wait between attempts</p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {submitting ? 'Creating…' : 'Create Campaign'}
        </Button>
      </div>
    </Modal>
  );
}
