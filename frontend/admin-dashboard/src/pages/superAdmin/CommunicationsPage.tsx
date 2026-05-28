import { useEffect, useRef, useState } from 'react';
import { Send, AlertCircle, Loader2, RefreshCw, Pause, Play, Clock, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { superAdminApi } from '@/services/superAdmin.api';

const POLL_MS = 5000;
const STATUS_CLS: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-700', read: 'bg-emerald-100 text-emerald-700',
  sent: 'bg-blue-100 text-blue-700', queued: 'bg-gray-100 text-gray-600',
  failed: 'bg-danger-100 text-danger-700', replied: 'bg-purple-100 text-purple-700',
};

export function CommunicationsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = async () => {
    try { setData(await superAdminApi.communications()); setError(null); }
    catch (e: any) { setError(e?.response?.data?.error || e?.message || 'Failed to load communications'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const resend = async (id: string) => {
    setBusy(id); setFlash(null);
    try { const r = await superAdminApi.resendComm(id); setFlash(r.note || 'Re-send queued.'); await fetchOnce(); }
    catch (e: any) { setFlash(e?.response?.data?.error || 'Resend failed'); }
    finally { setBusy(null); }
  };

  const t = data?.totals;
  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Send className="h-5 w-5 text-amber-600" /> Communication Delivery</h1>
          <p className="text-sm text-gray-500 mt-0.5">WhatsApp / Email / SMS delivery across all tenants (last 7 days).</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(data.generated_at).toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} className="rounded-lg">{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{paused ? 'Resume' : 'Pause'}</Button>
          <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </div>

      {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700"><AlertCircle className="h-4 w-4 mt-0.5" /><span>{error}</span></div>}
      {flash && <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">{flash}</div>}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="Delivery rate" value={data.delivery_pct != null ? `${data.delivery_pct}%` : '—'} accent={data.delivery_pct != null && data.delivery_pct < 80 ? 'danger' : 'emerald'} />
            <Tile label="Total" value={t.total} />
            <Tile label="Delivered" value={t.delivered} accent="emerald" />
            <Tile label="Failed" value={t.failed} accent={t.failed > 0 ? 'danger' : 'gray'} />
            <Tile label="Queued" value={t.queued} accent="amber" />
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">By channel & status</h2>
          <Card>
            <div className="flex flex-wrap gap-2">
              {data.by_channel_status.map((r: any, i: number) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-gray-100">
                  <span className="font-mono uppercase text-gray-600">{r.channel}</span>
                  <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                  <b className="text-gray-800">{r.count}</b>
                </span>
              ))}
            </div>
          </Card>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">By provider</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.by_provider.map((p: any) => (
              <Card key={p.provider}>
                <div className="flex items-center justify-between">
                  <span className="font-mono uppercase text-xs font-semibold text-gray-700">{p.provider || '—'}</span>
                  {p.failure_pct > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-100 text-danger-700 font-semibold">{p.failure_pct}% fail</span>}
                </div>
                <div className="mt-1.5 text-xl font-semibold text-gray-900">{p.total}</div>
                <div className="text-xs text-gray-500">{p.failed} failed</div>
              </Card>
            ))}
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">Recent failures</h2>
          <Card>
            {data.recent_failures.length === 0 ? <p className="text-xs text-gray-400">No failures. 🎉</p> : (
              <div className="space-y-1.5">
                {data.recent_failures.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg border border-gray-100">
                    <div className="min-w-0">
                      <span className="font-mono uppercase text-gray-600">{f.channel}</span>
                      <span className="text-gray-400"> · {f.tenant_name || f.tenant_id?.slice(0, 8)} · {f.recipient}</span>
                      {f.last_error && <div className="text-[11px] text-danger-600 truncate" title={f.last_error}>{f.last_error}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-gray-400">{new Date(f.created_at).toLocaleTimeString()}</span>
                      <Button variant="outline" size="sm" className="rounded-lg" disabled={busy === f.id} onClick={() => resend(f.id)}>
                        {busy === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Resend
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
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
