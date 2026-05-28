import { useEffect, useState } from 'react';
import { BarChart3, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { superAdminApi } from '@/services/superAdmin.api';

export function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = async () => {
    setLoading(true);
    try { setData(await superAdminApi.analytics()); setError(null); }
    catch (e: any) { setError(e?.response?.data?.error || e?.message || 'Failed to load analytics'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchOnce(); }, []);

  const pct = (v: any) => (v == null ? '—' : `${v}%`);
  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-amber-600" /> Global Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Platform-wide lead, call, follow-up and campaign performance (last 30 days).</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700"><AlertCircle className="h-4 w-4 mt-0.5" /><span>{error}</span></div>}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Total leads" value={data.leads.total} />
            <Tile label="Leads today" value={data.leads.today} accent="amber" />
            <Tile label="Lead conversion" value={pct(data.conversion_pct)} accent="emerald" />
            <Tile label="No-answer rate" value={pct(data.calls.no_answer_pct)} accent={data.calls.no_answer_pct > 40 ? 'danger' : 'gray'} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <Tile label="AI latency (avg)" value={data.ai_latency_ms != null ? `${data.ai_latency_ms} ms` : '—'} />
            <Tile label="Avg call duration" value={data.calls.avg_duration_seconds != null ? `${data.calls.avg_duration_seconds}s` : '—'} />
            <Tile label="Retry success" value={pct(data.retry_success_pct)} />
            <Tile label="Follow-up success" value={pct(data.followup_success_pct)} accent="emerald" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
            <Card>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Lead funnel (post-call status)</h2>
              {Object.keys(data.lead_funnel || {}).length === 0 ? <p className="text-xs text-gray-400">No analyzed leads in window.</p> : (
                <div className="space-y-1.5">
                  {Object.entries(data.lead_funnel).map(([k, v]: any) => (
                    <div key={k} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg border border-gray-100">
                      <span className="font-medium text-gray-700">{k.replace(/_/g, ' ').toLowerCase()}</span>
                      <b className="text-gray-900">{v}</b>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Calls & campaigns</h2>
              <Row label="Total calls" value={data.calls.total} />
              <Row label="Completed" value={data.calls.completed} />
              <Row label="No-answer" value={data.calls.no_answer} />
              <Row label="Campaign delivery" value={pct(data.campaign_delivery_pct)} />
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Tile({ label, value, accent = 'gray' }: { label: string; value: any; accent?: 'gray' | 'emerald' | 'danger' | 'amber' }) {
  const num = accent === 'emerald' ? 'text-emerald-700' : accent === 'danger' ? 'text-danger-700' : accent === 'amber' ? 'text-amber-700' : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] uppercase text-gray-500 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${num}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg border border-gray-100">
      <span className="text-gray-600">{label}</span>
      <b className="text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</b>
    </div>
  );
}
