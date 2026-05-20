import { useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, Mail, Phone, Search, Filter, ChevronLeft, ChevronRight, X,
  CheckCircle2, AlertCircle, Clock, Eye, RefreshCw, Loader2, Send, Inbox, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

interface CommLogRow {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  channel: 'email' | 'sms' | 'whatsapp' | 'whatsapp_inbound' | string;
  provider: string | null;
  recipient: string;
  subject: string | null;
  message: string | null;
  template_id: string | null;
  attachments: Array<{ name: string; url: string }> | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received' | string;
  last_error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  provider_response?: any;
  created_at: string;
}

interface ListResponse {
  data: CommLogRow[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
}

interface StatsResponse {
  by_status: Record<string, number>;
  by_channel: Record<string, number>;
  windows: Record<string, { total: number; delivered: number; failed: number }>;
}

const CHANNELS: Array<{ value: string; label: string; icon: any }> = [
  { value: '',                 label: 'All',      icon: Inbox },
  { value: 'whatsapp',         label: 'WhatsApp', icon: MessageSquare },
  { value: 'sms',              label: 'SMS',      icon: Phone },
  { value: 'email',            label: 'Email',    icon: Mail },
  { value: 'whatsapp_inbound', label: 'Replies',  icon: MessageSquare },
];

const STATUSES = ['', 'queued', 'sent', 'delivered', 'read', 'failed', 'received'];

const STATUS_BADGE: Record<string, { label: string; classes: string; icon: any }> = {
  queued:    { label: 'Queued',    classes: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200',         icon: Clock },
  sent:      { label: 'Sent',      classes: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',           icon: Send },
  delivered: { label: 'Delivered', classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',  icon: CheckCircle2 },
  read:      { label: 'Read',      classes: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',           icon: Eye },
  failed:    { label: 'Failed',    classes: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',           icon: AlertCircle },
  received:  { label: 'Received',  classes: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',     icon: Inbox },
};

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_BADGE[status] || { label: status, classes: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200', icon: Clock };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${meta.classes}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

function ChannelIcon({ channel, className = 'h-4 w-4' }: { channel: string; className?: string }) {
  if (channel === 'whatsapp' || channel === 'whatsapp_inbound') return <MessageSquare className={className + ' text-emerald-600'} />;
  if (channel === 'sms') return <Phone className={className + ' text-blue-600'} />;
  if (channel === 'email') return <Mail className={className + ' text-amber-600'} />;
  return <Inbox className={className + ' text-gray-400'} />;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function CommunicationsPage() {
  const [rows, setRows] = useState<CommLogRow[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [total, setTotal] = useState(0);

  const [detail, setDetail] = useState<CommLogRow | null>(null);

  const fetchLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        limit: String(pageSize),
        offset: String(page * pageSize),
      };
      if (channel) params.channel = channel;
      if (status) params.status = status;
      if (search.trim()) params.search = search.trim();

      const [list, stats] = await Promise.all([
        api.get<ListResponse>('/communication-logs', { params }),
        api.get<StatsResponse>('/communication-logs/stats'),
      ]);
      setRows(list.data.data);
      setTotal(list.data.pagination?.total ?? list.data.data.length);
      setStats(stats.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load communication logs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [channel, status, page, search]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchLogs(true);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const w24 = stats?.windows?.['24h']  || { total: 0, delivered: 0, failed: 0 };
  const w7  = stats?.windows?.['7d']   || { total: 0, delivered: 0, failed: 0 };
  const w30 = stats?.windows?.['30d']  || { total: 0, delivered: 0, failed: 0 };
  const failureRate = (w: typeof w24) => w.total ? ((w.failed / w.total) * 100).toFixed(1) : '0.0';

  const channelCounts = stats?.by_channel || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Communications</h1>
          <p className="text-sm text-gray-500 mt-1">Every SMS, WhatsApp and email this tenant has sent or received.</p>
        </div>
        <Button variant="secondary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Last 24 hours</div>
          <div className="mt-1 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-gray-900">{w24.total}</div>
            <div className="text-[11px] text-gray-500">{w24.delivered} delivered</div>
          </div>
          <div className="mt-2 text-[11px] text-rose-600">{failureRate(w24)}% failure</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Last 7 days</div>
          <div className="mt-1 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-gray-900">{w7.total}</div>
            <div className="text-[11px] text-gray-500">{w7.delivered} delivered</div>
          </div>
          <div className="mt-2 text-[11px] text-rose-600">{failureRate(w7)}% failure</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Last 30 days</div>
          <div className="mt-1 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-gray-900">{w30.total}</div>
            <div className="text-[11px] text-gray-500">{w30.delivered} delivered</div>
          </div>
          <div className="mt-2 text-[11px] text-rose-600">{failureRate(w30)}% failure</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">By channel (all time)</div>
          <div className="mt-2 space-y-1">
            {['whatsapp','sms','email','whatsapp_inbound'].map((c) => (
              <div key={c} className="flex items-center justify-between text-[12px]">
                <span className="inline-flex items-center gap-1 text-gray-600">
                  <ChannelIcon channel={c} className="h-3 w-3" /> {c === 'whatsapp_inbound' ? 'Replies' : c.charAt(0).toUpperCase() + c.slice(1)}
                </span>
                <span className="font-medium text-gray-900">{channelCounts[c] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Filter bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const active = channel === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => { setPage(0); setChannel(c.value); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {c.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          <select
            value={status}
            onChange={(e) => { setPage(0); setStatus(e.target.value); }}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-400"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === '' ? 'All statuses' : (STATUS_BADGE[s]?.label || s)}</option>
            ))}
          </select>

          <form onSubmit={submitSearch} className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search recipient or message…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-64 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-400"
            />
          </form>
        </div>
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 border-b border-rose-200 text-rose-800 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {loading ? (
          <div className="py-16 text-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin inline" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No communications match these filters.</p>
            <p className="text-[12px] mt-1">Send your first test from <a href="/settings/plivo" className="text-primary-600 hover:underline">Settings → Plivo</a>.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Channel</th>
                <th className="px-4 py-2 text-left">Recipient</th>
                <th className="px-4 py-2 text-left">Message</th>
                <th className="px-4 py-2 text-left">Provider</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetail(row)}>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <ChannelIcon channel={row.channel} />
                      <span className="text-gray-700 text-xs uppercase">{row.channel === 'whatsapp_inbound' ? 'reply' : row.channel}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-900 font-medium">{row.recipient}</td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-md truncate">{row.message || row.subject || '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge className="bg-gray-100 text-gray-700 text-[11px]">{row.provider || '—'}</Badge>
                  </td>
                  <td className="px-4 py-2.5"><StatusPill status={row.status} /></td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{formatTimeAgo(row.created_at)}</td>
                  <td className="px-4 py-2.5 text-gray-400"><Eye className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              Showing {page * pageSize + 1}–{page * pageSize + rows.length} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="text-gray-600"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <Button
                variant="ghost"
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * pageSize >= total}
                className="text-gray-600"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Drill-down modal */}
      {detail && (
        <Modal isOpen onClose={() => setDetail(null)} title="Communication detail" size="lg">
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2">
                <ChannelIcon channel={detail.channel} />
                <span className="font-medium text-gray-900">{detail.channel.toUpperCase()}</span>
                <StatusPill status={detail.status} />
              </div>
              <div className="text-xs text-gray-500">{new Date(detail.created_at).toLocaleString()}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-gray-500 uppercase">Recipient</div>
                <div className="font-medium text-gray-900">{detail.recipient}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-500 uppercase">Provider</div>
                <div className="font-medium text-gray-900">{detail.provider || '—'}</div>
              </div>
              {detail.template_id && (
                <div>
                  <div className="text-[11px] text-gray-500 uppercase">Template</div>
                  <div className="font-medium text-gray-900 font-mono text-xs">{detail.template_id}</div>
                </div>
              )}
              {detail.lead_id && (
                <div>
                  <div className="text-[11px] text-gray-500 uppercase">Lead</div>
                  <a href={`/crm/leads/${detail.lead_id}`} className="text-primary-600 hover:underline font-mono text-xs">{detail.lead_id.slice(0, 8)}…</a>
                </div>
              )}
            </div>

            {detail.subject && (
              <div>
                <div className="text-[11px] text-gray-500 uppercase">Subject</div>
                <div className="font-medium text-gray-900">{detail.subject}</div>
              </div>
            )}

            {detail.message && (
              <div>
                <div className="text-[11px] text-gray-500 uppercase mb-1">Message</div>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs whitespace-pre-wrap font-sans text-gray-800 max-h-48 overflow-y-auto">{detail.message}</pre>
              </div>
            )}

            {detail.attachments && detail.attachments.length > 0 && (
              <div>
                <div className="text-[11px] text-gray-500 uppercase mb-1">Attachments</div>
                <ul className="text-xs space-y-1">
                  {detail.attachments.map((a, i) => (
                    <li key={i}><a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">{a.name}</a></li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-100">
              <div>
                <div className="text-[11px] text-gray-500 uppercase">Sent</div>
                <div className="text-xs">{detail.sent_at ? new Date(detail.sent_at).toLocaleString() : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-500 uppercase">Delivered</div>
                <div className="text-xs">{detail.delivered_at ? new Date(detail.delivered_at).toLocaleString() : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-500 uppercase">Read</div>
                <div className="text-xs">{detail.read_at ? new Date(detail.read_at).toLocaleString() : '—'}</div>
              </div>
            </div>

            {detail.last_error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                <div className="text-[11px] text-rose-700 uppercase mb-1">Last error</div>
                <div className="text-xs text-rose-800 font-mono whitespace-pre-wrap">{detail.last_error}</div>
              </div>
            )}

            {detail.provider_response && (
              <details className="border border-gray-200 rounded-lg">
                <summary className="cursor-pointer px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">Provider response (raw)</summary>
                <pre className="bg-gray-50 px-3 py-2 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono text-gray-700 max-h-64 overflow-y-auto">{JSON.stringify(detail.provider_response, null, 2)}</pre>
              </details>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
