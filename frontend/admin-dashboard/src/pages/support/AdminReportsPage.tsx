import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Filter, Search, Bug, Lightbulb, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  supportApi,
  type AdminReportList, type ReportStatus,
  REPORT_TYPE_OPTIONS, PRIORITY_OPTIONS, PRODUCT_AREA_OPTIONS,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS,
} from '@/services/support.api';

const STATUSES: ReportStatus[] = [
  'SUBMITTED', 'UNDER_REVIEW', 'NEED_MORE_INFO', 'IN_PROGRESS',
  'PLANNED', 'FIXED', 'RELEASED', 'REJECTED', 'DUPLICATE', 'CLOSED',
];

export function AdminReportsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminReportList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [area, setArea] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await supportApi.adminList({
        status: status || undefined,
        type: type || undefined,
        priority: priority || undefined,
        product_area: area || undefined,
        q: q || undefined,
        limit: 100,
      });
      setData(r);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, type, priority, area]);
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stats = data?.stats;
  const avgHours = useMemo(() => stats?.avg_resolution_hours ?? null, [stats]);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support · All Reports</h1>
          <p className="text-sm text-gray-500">Admin dashboard for tracking, triaging and resolving user issues.</p>
        </div>
        <Button variant="secondary" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Open" value={stats?.open_count ?? '—'} tint="indigo" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Critical open" value={stats?.critical_open ?? '—'} tint="red" />
        <StatCard icon={<Bug className="h-4 w-4" />} label="Total bugs" value={stats?.bugs_total ?? '—'} tint="amber" />
        <StatCard icon={<Lightbulb className="h-4 w-4" />} label="Feature requests" value={stats?.feature_requests_total ?? '—'} tint="purple" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Avg resolve (h)" value={avgHours != null ? avgHours.toFixed(1) : '—'} tint="green" />
      </div>

      <Card className="p-4 mt-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex items-center gap-1 text-xs text-gray-500"><Filter className="h-3 w-3" /> Filters</div>
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <select className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any type</option>
            {REPORT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={selectCls} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Any area</option>
            {PRODUCT_AREA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <Search className="h-4 w-4 text-gray-400" />
            <input className={selectCls + ' w-56'} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ticket id, email, title..." />
          </div>
        </div>
      </Card>

      <Card className="p-0 mt-4 overflow-hidden">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2 m-4">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {!loading && !error && data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2 px-3">Ticket</th>
                  <th className="py-2 px-3">Title</th>
                  <th className="py-2 px-3">Reporter</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Area</th>
                  <th className="py-2 px-3">Priority</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Created</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/admin/reports/${r.ticket_id}`)}>
                    <td className="py-2 px-3 font-mono text-xs text-gray-700">{r.ticket_id}</td>
                    <td className="py-2 px-3 text-gray-900 max-w-[360px] truncate">{r.title}</td>
                    <td className="py-2 px-3 text-xs text-gray-600">
                      <div>{r.name}</div>
                      <div className="text-gray-400">{r.email}</div>
                    </td>
                    <td className="py-2 px-3 text-xs">{r.report_type.replace(/_/g, ' ')}</td>
                    <td className="py-2 px-3 text-xs">{(r.product_area || '').replace(/_/g, ' ')}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority}</span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="py-2 px-3 text-right text-xs text-indigo-600">Open →</td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-10 text-sm text-gray-500">No reports match the filters.</td></tr>
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

function StatCard({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: any; tint: string }) {
  const tints: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    purple: 'bg-purple-50 text-purple-700',
    green: 'bg-green-50 text-green-700',
  };
  return (
    <Card className="p-3">
      <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md ${tints[tint]}`}>{icon}{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</div>
    </Card>
  );
}
