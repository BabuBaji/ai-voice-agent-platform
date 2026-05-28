import { useEffect, useRef, useState } from 'react';
import { BellRing, AlertCircle, Loader2, RefreshCw, Pause, Play, Clock, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { superAdminApi } from '@/services/superAdmin.api';

const POLL_MS = 5000;

export function RemindersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = async () => {
    try { setData(await superAdminApi.reminders()); setError(null); }
    catch (e: any) { setError(e?.response?.data?.error || e?.message || 'Failed to load reminders'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    fetchOnce();
    if (paused) return;
    timerRef.current = setInterval(fetchOnce, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const requeue = async (id: string) => {
    setBusy(id); setFlash(null);
    try { await superAdminApi.requeueReminder(id, 'task'); setFlash('Reminder requeued to pending.'); await fetchOnce(); }
    catch (e: any) { setFlash(e?.response?.data?.error || 'Requeue failed'); }
    finally { setBusy(null); }
  };

  const ft = data?.follow_up_tasks;
  const rq = data?.recall_queue;
  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><BellRing className="h-5 w-5 text-amber-600" /> Reminder & Follow-up Engine</h1>
          <p className="text-sm text-gray-500 mt-0.5">Global follow-up tasks and the lead recall queue across all tenants.</p>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Due now" value={ft.due_now} accent="amber" />
            <Tile label="Overdue" value={ft.overdue} accent={ft.overdue > 0 ? 'danger' : 'gray'} />
            <Tile label="Pending tasks" value={ft.by_status.pending || 0} />
            <Tile label="Done tasks" value={ft.by_status.done || 0} accent="emerald" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
            <Card>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Follow-up tasks</h2>
              <Kv title="By status" obj={ft.by_status} />
              <Kv title="By priority" obj={ft.by_priority} />
            </Card>
            <Card>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Recall queue</h2>
              <Kv title="By state" obj={rq.by_state} />
              <div className="mt-2">
                <div className="text-[11px] uppercase text-gray-500 font-medium mb-1">By retry count</div>
                <div className="flex flex-wrap gap-1.5">
                  {rq.by_retry_count.map((r: any) => (
                    <span key={r.retry_count} className="text-xs px-2 py-0.5 rounded-lg border border-gray-100">#{r.retry_count}: <b>{r.count}</b></span>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">Upcoming / overdue tasks</h2>
          <Card>
            {data.upcoming.length === 0 ? <p className="text-xs text-gray-400">No pending tasks.</p> : (
              <div className="space-y-1.5">
                {data.upcoming.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg border border-gray-100">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{u.task_type}</span>
                      <span className="text-gray-500"> · {u.tenant_name || u.tenant_id?.slice(0, 8)} · {u.priority} · {u.status}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-gray-400">{u.scheduled_at ? new Date(u.scheduled_at).toLocaleString() : '—'}</span>
                      <Button variant="outline" size="sm" className="rounded-lg" disabled={busy === u.id} onClick={() => requeue(u.id)}>
                        {busy === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Requeue
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
      <div className={`text-2xl font-bold mt-1 ${num}`}>{typeof value === 'number' ? value.toLocaleString() : (value ?? 0)}</div>
    </div>
  );
}
function Kv({ title, obj }: { title: string; obj: Record<string, number> }) {
  const entries = Object.entries(obj || {});
  return (
    <div className="mb-2">
      <div className="text-[11px] uppercase text-gray-500 font-medium mb-1">{title}</div>
      {entries.length === 0 ? <span className="text-xs text-gray-400">none</span> : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, v]) => <span key={k} className="text-xs px-2 py-0.5 rounded-lg border border-gray-100">{k}: <b>{v}</b></span>)}
        </div>
      )}
    </div>
  );
}
