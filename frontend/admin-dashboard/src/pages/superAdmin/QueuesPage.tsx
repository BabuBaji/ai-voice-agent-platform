import { useEffect, useRef, useState } from 'react';
import { Layers, AlertCircle, Loader2, RefreshCw, Pause, Play, Clock, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { superAdminApi } from '@/services/superAdmin.api';

const POLL_MS = 5000;
const RETRYABLE: Record<string, 'crm_lead_retry' | 'lead_recall' | 'communication'> = {
  crm_lead_retry: 'crm_lead_retry',
  lead_recall: 'lead_recall',
  communication_retry: 'communication',
};

function fmtTime(s?: string | null) { return s ? new Date(s).toLocaleString() : '—'; }

export function QueuesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = async () => {
    try { setData(await superAdminApi.queues()); setError(null); }
    catch (e: any) { setError(e?.response?.data?.error || e?.message || 'Failed to load queues'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const retry = async (queueKey: string, id?: string) => {
    const q = RETRYABLE[queueKey];
    if (!q) return;
    setBusy(id || queueKey);
    setFlash(null);
    try {
      const r = await superAdminApi.retryQueue(q, id);
      setFlash(`Requeued ${r.affected ?? ''} job(s) in ${queueKey}. The sweeper will process them shortly.`);
      await fetchOnce();
    } catch (e: any) {
      setFlash(e?.response?.data?.error || 'Retry failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Layers className="h-5 w-5 text-amber-600" /> Queue Health
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Global retry queues & background jobs across all tenants. Auto-refreshes every {POLL_MS / 1000}s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && (
            <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(data.generated_at).toLocaleTimeString()}</span>
          )}
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} className="rounded-lg">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchOnce} className="rounded-lg"><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </div>

      {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700"><AlertCircle className="h-4 w-4 mt-0.5" /><span>{error}</span></div>}
      {flash && <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">{flash}</div>}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.queues.map((q: any) => (
              <Card key={q.key}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{q.label}</div>
                    <div className="text-[11px] text-gray-400 font-mono">{q.key}</div>
                  </div>
                  {RETRYABLE[q.key] && q.failed > 0 && (
                    <Button variant="outline" size="sm" className="rounded-lg" disabled={busy === q.key} onClick={() => retry(q.key)}>
                      {busy === q.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Retry failed
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Stat label="Total" value={q.total} />
                  <Stat label="Pending" value={q.pending} accent={q.pending > 0 ? 'amber' : 'gray'} />
                  <Stat label="Failed" value={q.failed} accent={q.failed > 0 ? 'danger' : 'gray'} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                  <span>Due now: <b className="text-gray-700">{q.due_now ?? 0}</b></span>
                  <span>Last activity: {fmtTime(q.last_activity_at)}</span>
                </div>
                {q.oldest_pending_at && (
                  <div className="mt-1 text-[11px] text-gray-400">Oldest pending: {fmtTime(q.oldest_pending_at)}</div>
                )}
              </Card>
            ))}
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">Recent failures (CRM lead retry)</h2>
          <Card>
            {data.recent_failures?.length === 0 ? (
              <p className="text-xs text-gray-400">No failed jobs. 🎉</p>
            ) : (
              <div className="space-y-1.5">
                {data.recent_failures.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg border border-gray-100">
                    <div className="min-w-0">
                      <span className="font-mono text-gray-700">{f.tenant_name || f.tenant_id?.slice(0, 8)}</span>
                      <span className="text-gray-400"> · {f.detail} · attempts {f.attempts}</span>
                      {f.last_error && <div className="text-[11px] text-danger-600 truncate" title={f.last_error}>{f.last_error}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-gray-400">{fmtTime(f.at)}</span>
                      <Button variant="outline" size="sm" className="rounded-lg" disabled={busy === f.id} onClick={() => retry('crm_lead_retry', f.id)}>
                        {busy === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Retry
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

function Stat({ label, value, accent = 'gray' }: { label: string; value: number; accent?: 'gray' | 'amber' | 'danger' }) {
  const num = accent === 'amber' ? 'text-amber-700' : accent === 'danger' ? 'text-danger-700' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2 text-center">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${num}`}>{(value ?? 0).toLocaleString()}</div>
    </div>
  );
}
