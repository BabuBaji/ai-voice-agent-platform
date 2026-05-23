/**
 * Failed WhatsApp send retry queue. Shows failed rows with their backoff
 * schedule and lets the operator force-retry or skip.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, RotateCw, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

interface QueueRow {
  id: string;
  recipient: string;
  template_id: string | null;
  status: string;
  last_error: string | null;
  retry_attempts: number;
  next_retry_at: string | null;
  failed_at: string | null;
  created_at: string;
}

export function RetryQueuePage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [includeExhausted, setIncludeExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ items: QueueRow[] }>(`/whatsapp/retry-queue?include_exhausted=${includeExhausted ? 1 : 0}&limit=500`);
      setRows(data.items || []);
    } catch (err: any) {
      setFlash(err?.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [includeExhausted]);

  const retry = async (id: string) => {
    setBusyId(id); setFlash(null);
    try {
      await api.post(`/whatsapp/retry-queue/${id}/retry`);
      setFlash('Queued for immediate retry — refresh in ~5s to see the result.');
      await load();
    } catch (err: any) {
      setFlash(err?.response?.data?.message || 'Retry failed');
    } finally {
      setBusyId(null);
    }
  };
  const skip = async (id: string) => {
    if (!confirm('Mark this message as permanently failed? It will stop retrying.')) return;
    setBusyId(id);
    try {
      await api.post(`/whatsapp/retry-queue/${id}/skip`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp Retry Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Failed sends pending retry. The sweeper automatically retries 3 times at 5/15/30-minute intervals.
            Permanent errors (auth/template/allow-list) are excluded — fix the root cause in WhatsApp Settings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={includeExhausted} onChange={(e) => setIncludeExhausted(e.target.checked)} />
            Include exhausted
          </label>
          <Button onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </header>

      {flash && (
        <div className="flex items-start gap-2 p-3 rounded text-sm bg-blue-50 text-blue-800">
          <AlertCircle className="w-4 h-4 mt-0.5" /><span>{flash}</span>
        </div>
      )}

      {loading ? (
        <Card><div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></Card>
      ) : rows.length === 0 ? (
        <Card><div className="p-8 text-center text-gray-500">No failed messages.</div></Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-left">Template</th>
                <th className="px-4 py-3 text-left">Attempts</th>
                <th className="px-4 py-3 text-left">Next retry</th>
                <th className="px-4 py-3 text-left">Failed at</th>
                <th className="px-4 py-3 text-left">Error</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs">{r.recipient}</td>
                  <td className="px-4 py-3 text-xs">{r.template_id || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.retry_attempts >= 3 ? <Badge variant="danger">exhausted</Badge> : `${r.retry_attempts} / 3`}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.next_retry_at ? new Date(r.next_retry_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.failed_at ? new Date(r.failed_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-xs text-red-600 max-w-md truncate" title={r.last_error || ''}>{r.last_error || '—'}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => retry(r.id)}
                      disabled={busyId === r.id || r.retry_attempts >= 3}
                      className="text-blue-600 hover:text-blue-700 disabled:text-gray-300"
                      title="Force retry now"
                    >
                      <RotateCw className={`w-4 h-4 inline ${busyId === r.id ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => skip(r.id)} disabled={busyId === r.id} className="text-gray-500 hover:text-red-700" title="Skip permanently">
                      <XCircle className="w-4 h-4 inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
