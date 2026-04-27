import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Send, CheckCircle2, XCircle } from 'lucide-react';
import { superAdminApi } from '@/services/superAdmin.api';

const EVENT_OPTIONS = [
  'tenant.suspended', 'tenant.activated',
  'wallet.credit', 'wallet.debit',
  'anomaly.created', 'broadcast.created', 'tenant.impersonated',
];

export function SuperAdminWebhooksPage() {
  const [data, setData] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: [] as string[] });

  const load = () => superAdminApi.webhooks().then((r) => setData(r.data));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name || !form.url || form.events.length === 0) { alert('Name, URL, and at least one event are required.'); return; }
    try {
      await superAdminApi.createWebhook({ name: form.name, url: form.url, events: form.events, secret: form.secret || undefined });
      setForm({ name: '', url: '', secret: '', events: [] });
      setAdding(false);
      load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Outbound webhooks</h1>
          <p className="text-sm text-slate-500 mt-1">Fire to Slack, Discord, or any HTTPS endpoint when key events happen</p>
        </div>
        <button onClick={() => setAdding(true)} className="text-xs px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add webhook
        </button>
      </div>

      {adding && (
        <div className="bg-white border border-amber-200 rounded-2xl p-5 space-y-3">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name (e.g. 'Slack #ops alerts')" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
          <input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://hooks.slack.com/services/…" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono" />
          <input value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
            placeholder="HMAC secret (optional)" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Subscribe to events:</p>
            <div className="flex flex-wrap gap-2">
              {EVENT_OPTIONS.map((ev) => (
                <label key={ev} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-xs cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={form.events.includes(ev)}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      events: e.target.checked ? [...f.events, ev] : f.events.filter((x) => x !== ev),
                    }))}
                  />
                  <code>{ev}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-xs px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={submit} className="text-xs px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800">Create</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl">
        {!data ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-amber-500" /></div>
         : data.length === 0 ? <p className="text-center py-16 text-sm text-slate-400">No webhooks configured.</p>
         : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">URL</th>
                <th className="text-left px-4 py-3 font-medium">Events</th>
                <th className="text-center px-4 py-3 font-medium">Last fired</th>
                <th className="text-center px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{w.name}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-500 truncate max-w-xs">{w.url}</td>
                  <td className="px-4 py-3 text-[10px] text-slate-600">{(w.events as string[]).map((e) => <code key={e} className="bg-slate-100 px-1 rounded mr-1">{e}</code>)}</td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{w.last_fired_at ? new Date(w.last_fired_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {w.last_status === null ? <span className="text-[10px] text-slate-400">untested</span>
                     : w.last_status >= 200 && w.last_status < 300 ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" />
                     : <span className="inline-flex items-center gap-1 text-[10px] text-rose-600"><XCircle className="h-3 w-3" /> {w.last_status} · {w.failure_count} fails</span>}
                  </td>
                  <td className="px-4 py-3 flex justify-end gap-2">
                    <button onClick={async () => { await superAdminApi.testWebhook(w.id); setTimeout(load, 1000); }}
                      className="text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1" title="Send test event">
                      <Send className="h-3 w-3" /> Test
                    </button>
                    <button onClick={async () => { if (confirm('Delete?')) { await superAdminApi.deleteWebhook(w.id); load(); } }}
                      className="text-[11px] px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
