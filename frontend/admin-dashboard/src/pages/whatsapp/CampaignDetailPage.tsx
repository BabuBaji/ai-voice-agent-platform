/**
 * WhatsApp Campaign detail — progress bars + per-status target list with
 * pagination via tabs.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Play, Pause, X, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

type Status = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'replied';
const STATUSES: Status[] = ['queued', 'sent', 'delivered', 'read', 'failed', 'replied'];

const STATUS_COLOR: Record<Status, string> = {
  queued: 'bg-gray-400',
  sent: 'bg-blue-500',
  delivered: 'bg-cyan-500',
  read: 'bg-green-500',
  failed: 'bg-red-500',
  replied: 'bg-purple-500',
};

interface CampaignDetail {
  id: string;
  name: string;
  template_name: string;
  template_language: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  rate_limit_per_minute: number;
  total_recipients: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  progress: Record<Status, number> & { total: number };
}

interface Target {
  id: string;
  recipient: string;
  status: Status;
  attempt_count: number;
  last_error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  replied_at: string | null;
}

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [camp, setCamp] = useState<CampaignDetail | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [tab, setTab] = useState<Status | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data } = await api.get<CampaignDetail>(`/whatsapp/campaigns/${id}`);
      setCamp(data);
      const q = tab === 'all' ? '' : `?status=${tab}`;
      const { data: t } = await api.get<{ targets: Target[] }>(`/whatsapp/campaigns/${id}/targets${q}`);
      setTargets(t.targets || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id, tab]);

  // Auto-refresh while running so the dashboard feels live.
  useEffect(() => {
    if (!camp || camp.status !== 'RUNNING') return;
    const i = setInterval(load, 4000);
    return () => clearInterval(i);
  }, [camp?.status, tab]);

  const act = async (action: 'start' | 'pause' | 'cancel') => {
    try {
      await api.post(`/whatsapp/campaigns/${id}/${action}`);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || `${action} failed`);
    }
  };

  if (loading && !camp) {
    return <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!camp) {
    return <div className="p-6 text-gray-500">Campaign not found.</div>;
  }

  const p = camp.progress;
  const total = p.total || 1; // avoid div/0
  return (
    <div className="p-6 space-y-6">
      <button onClick={() => nav('/whatsapp/campaigns')} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{camp.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Template: <code className="font-mono">{camp.template_name}</code> · {camp.template_language} ·
            Rate: {camp.rate_limit_per_minute}/min · Total: {camp.total_recipients}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={camp.status === 'COMPLETED' ? 'success' : camp.status === 'RUNNING' ? 'primary' : camp.status === 'CANCELLED' ? 'danger' : 'default'}>{camp.status}</Badge>
          <Button size="sm" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
          {(camp.status === 'DRAFT' || camp.status === 'PAUSED') && <Button size="sm" onClick={() => act('start')}><Play className="w-3 h-3 mr-1" />Start</Button>}
          {camp.status === 'RUNNING' && <Button size="sm" onClick={() => act('pause')}><Pause className="w-3 h-3 mr-1" />Pause</Button>}
          {(camp.status === 'RUNNING' || camp.status === 'PAUSED') && <Button size="sm" onClick={() => act('cancel')}><X className="w-3 h-3 mr-1" />Cancel</Button>}
        </div>
      </header>

      {/* Progress segmented bar */}
      <Card className="p-6 space-y-4">
        <div className="flex h-3 rounded overflow-hidden bg-gray-100">
          {STATUSES.map((s) => (
            p[s] > 0 ? (
              <div key={s} className={STATUS_COLOR[s]} style={{ width: `${(p[s] / total) * 100}%` }} title={`${s}: ${p[s]}`} />
            ) : null
          ))}
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-sm">
          {STATUSES.map((s) => (
            <div key={s}>
              <div className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[s]}`}></span>
                <span className="text-xs text-gray-500 uppercase">{s}</span>
              </div>
              <div className="text-xl font-semibold">{p[s]}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Tabs + targets table */}
      <div>
        <div className="flex gap-1 mb-3 text-xs">
          <button onClick={() => setTab('all')} className={`px-3 py-1 rounded ${tab === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}>all</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setTab(s)} className={`px-3 py-1 rounded ${tab === s ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}>
              {s} ({p[s]})
            </button>
          ))}
        </div>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Attempts</th>
                <th className="px-4 py-3 text-left">Sent</th>
                <th className="px-4 py-3 text-left">Delivered</th>
                <th className="px-4 py-3 text-left">Read</th>
                <th className="px-4 py-3 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No targets in this tab.</td></tr>
              ) : targets.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs">{t.recipient}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[t.status]} mr-2`}></span>
                    {t.status}
                  </td>
                  <td className="px-4 py-3">{t.attempt_count}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.sent_at ? new Date(t.sent_at).toLocaleTimeString() : '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.delivered_at ? new Date(t.delivered_at).toLocaleTimeString() : '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.read_at ? new Date(t.read_at).toLocaleTimeString() : '—'}</td>
                  <td className="px-4 py-3 text-xs text-red-600 max-w-md truncate" title={t.last_error || ''}>{t.last_error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
