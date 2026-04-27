import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Play } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

const SEVERITY: Record<string, string> = {
  info:     'bg-sky-100 text-sky-700',
  warn:     'bg-amber-100 text-amber-800',
  critical: 'bg-rose-100 text-rose-700',
};

export function SuperAdminAlertsPage() {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<any[] | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    superAdminApi.alerts(open).then((r) => setData(r.data));
  }, [open]);
  useEffect(() => { load(); }, [load]);

  const ack = async (id: string) => {
    await superAdminApi.ackAlert(id);
    load();
  };
  const runChecks = async () => {
    setRunning(true);
    try {
      const r = await superAdminApi.runAnomalyChecks();
      alert(`Anomaly check complete: ${r.inserted} new alert(s)`);
      load();
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" /> Anomaly alerts
          </h1>
          <p className="text-sm text-slate-500 mt-1">Auto-detected platform anomalies — runs every 10 minutes</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={String(open)} onChange={(e) => setOpen(e.target.value === 'true')} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
            <option value="true">Open only</option>
            <option value="false">Include acknowledged</option>
          </select>
          <button onClick={runChecks} disabled={running} className="text-xs px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Play className="h-3.5 w-3.5" /> Run checks now
          </button>
          <button onClick={load} className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl">
        {!data ? (
          <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
        ) : data.length === 0 ? (
          <p className="text-center py-16 text-sm text-slate-400">
            {open ? 'No open alerts. Click "Run checks now" to scan immediately.' : 'No alerts in history.'}
          </p>
        ) : (
          <ul>
            {data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3 border-b border-slate-100 last:border-0">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full h-fit ${SEVERITY[a.severity] || 'bg-slate-100'}`}>{a.severity}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-900">{a.message}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {new Date(a.created_at).toLocaleString()} · kind: <code className="bg-slate-100 px-1 rounded">{a.kind}</code>
                    {a.tenant_id && <> · <Link to={`/super-admin/tenants/${a.tenant_id}`} className="text-amber-700 hover:underline">{a.tenant_name || a.tenant_id.slice(0, 8)}</Link></>}
                  </p>
                </div>
                {!a.acknowledged ? (
                  <button onClick={() => ack(a.id)} className="text-xs px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Acknowledge
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400">acknowledged</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
