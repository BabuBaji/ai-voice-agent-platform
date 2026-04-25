import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Filter, Search, Download, Users, Flame, Inbox, Activity, TrendingUp, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  contactApi,
  INQUIRY_OPTIONS, STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS,
  type ContactListResponse, type ContactStatus,
} from '@/services/contact.api';

const STATUSES: ContactStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'IN_PROGRESS', 'CLOSED', 'SPAM'];

export function AdminContactRequestsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ContactListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [priority, setPriority] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await contactApi.adminList({
        status: status || undefined,
        inquiry_type: inquiry || undefined,
        priority: priority || undefined,
        q: q || undefined,
        limit: 100,
      });
      setData(r);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, inquiry, priority]);
  useEffect(() => { const t = setTimeout(() => load(), 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const stats = data?.stats;
  const avg = stats?.avg_lead_score != null ? Math.round(stats.avg_lead_score) : null;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contact Requests</h1>
          <p className="text-sm text-gray-500">Inbound leads and inquiries from the Contact Us page.</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={contactApi.adminCsvUrl()}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
        <Stat icon={<Inbox className="h-4 w-4" />} tint="indigo" label="Total" value={stats?.total ?? '—'} />
        <Stat icon={<Users className="h-4 w-4" />} tint="blue" label="New" value={stats?.new_count ?? '—'} />
        <Stat icon={<Activity className="h-4 w-4" />} tint="cyan" label="In flight" value={stats?.in_flight ?? '—'} />
        <Stat icon={<Flame className="h-4 w-4" />} tint="red" label="Hot leads" value={stats?.hot_leads ?? '—'} />
        <Stat icon={<TrendingUp className="h-4 w-4" />} tint="green" label="Avg score" value={avg ?? '—'} />
      </div>

      <Card className="p-4 mt-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex items-center gap-1 text-xs text-gray-500"><Filter className="h-3 w-3" /> Filters</div>
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <select className={selectCls} value={inquiry} onChange={(e) => setInquiry(e.target.value)}>
            <option value="">Any inquiry type</option>
            {INQUIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any urgency</option>
            {['CRITICAL','HIGH','MEDIUM','LOW'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <Search className="h-4 w-4 text-gray-400" />
            <input className={selectCls + ' w-56'} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ref, email, name, company…" />
          </div>
        </div>
      </Card>

      <Card className="p-0 mt-4 overflow-hidden">
        {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {error && <div className="m-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {error}</div>}
        {!loading && !error && data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2 px-3">Reference</th>
                  <th className="py-2 px-3">Contact</th>
                  <th className="py-2 px-3">Company</th>
                  <th className="py-2 px-3">Inquiry</th>
                  <th className="py-2 px-3">Score</th>
                  <th className="py-2 px-3">Urgency</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Received</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/admin/contact-requests/${r.reference_id}`)}>
                    <td className="py-2 px-3 font-mono text-xs text-gray-700">{r.reference_id}</td>
                    <td className="py-2 px-3">
                      <div className="text-gray-900">{r.full_name}</div>
                      <div className="text-gray-400 text-xs">{r.email}</div>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-600">
                      <div>{r.company_name || '—'}</div>
                      <div className="text-gray-400">{r.company_size?.replace(/_/g, ' ').toLowerCase() || ''}</div>
                    </td>
                    <td className="py-2 px-3 text-xs">{r.inquiry_type.replace(/_/g, ' ')}</td>
                    <td className="py-2 px-3 text-xs font-medium tabular-nums">
                      <LeadScoreBar score={r.lead_score ?? 0} />
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-xs text-indigo-600">Open →</td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-10 text-sm text-gray-500">No contact requests match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const selectCls = 'rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Stat({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: any; tint: string }) {
  const tints: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    blue: 'bg-blue-50 text-blue-700',
    cyan: 'bg-cyan-50 text-cyan-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-green-50 text-green-700',
  };
  return (
    <Card className="p-3">
      <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md ${tints[tint]}`}>{icon}{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</div>
    </Card>
  );
}

function LeadScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : pct >= 25 ? 'bg-blue-500' : 'bg-gray-400';
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-1.5 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-700 w-8 text-right">{pct}</span>
    </div>
  );
}
