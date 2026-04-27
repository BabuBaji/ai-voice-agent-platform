import { useEffect, useState } from 'react';
import { Loader2, Megaphone, Trash2 } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

const SEV: Record<string, string> = { info: 'bg-sky-100 text-sky-700', warning: 'bg-amber-100 text-amber-800', critical: 'bg-rose-100 text-rose-700' };

export function SuperAdminBroadcastsPage() {
  const [data, setData] = useState<any[] | null>(null);
  const [form, setForm] = useState({ message: '', severity: 'info' as 'info' | 'warning' | 'critical', expires_at: '' });

  const load = () => superAdminApi.broadcasts().then((r) => setData(r.data));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.message.trim()) return;
    await superAdminApi.createBroadcast({
      message: form.message,
      severity: form.severity,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
    });
    setForm({ message: '', severity: 'info', expires_at: '' });
    load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-amber-500" /> Tenant broadcasts
        </h1>
        <p className="text-sm text-slate-500 mt-1">Banner shown at the top of every tenant's dashboard until expiry or revoked</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          placeholder="Maintenance window Saturday 2–4am IST. Service may be intermittent."
          rows={2} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
        <div className="flex flex-wrap gap-3 items-center">
          <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as any }))}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <input type="datetime-local" value={form.expires_at} onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white" title="Optional expiry" />
          <button onClick={submit} className="text-xs px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600">Publish broadcast</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl">
        <h3 className="text-sm font-semibold text-slate-900 px-5 py-4 border-b border-slate-100">All broadcasts</h3>
        {!data ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
         : data.length === 0 ? <p className="text-center py-12 text-sm text-slate-400">No broadcasts yet.</p>
         : (
          <ul>
            {data.map((b) => (
              <li key={b.id} className="flex items-start gap-3 px-5 py-3 border-b border-slate-100 last:border-0">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full h-fit ${SEV[b.severity]}`}>{b.severity}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm text-slate-900 ${!b.active ? 'line-through opacity-50' : ''}`}>{b.message}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {new Date(b.starts_at).toLocaleString()}
                    {b.expires_at && <> → expires {new Date(b.expires_at).toLocaleString()}</>}
                    {!b.active && ' · revoked'}
                  </p>
                </div>
                {b.active && (
                  <button onClick={async () => { if (confirm('Revoke?')) { await superAdminApi.deleteBroadcast(b.id); load(); } }}
                    className="text-[11px] px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 inline-flex items-center gap-1">
                    <Trash2 className="h-3 w-3" /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
