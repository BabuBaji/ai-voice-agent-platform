/**
 * WhatsApp Bulk Campaigns — list with progress bars + status, action buttons
 * (start/pause/cancel/delete). Each row links to its detail page.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Pause, X, Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

interface Campaign {
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
}

const STATUS_VARIANT: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  DRAFT: 'default',
  RUNNING: 'primary',
  PAUSED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

export function CampaignsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ campaigns: Campaign[] }>('/whatsapp/campaigns');
      setRows(data.campaigns || []);
    } catch (err: any) {
      setFlash(err?.response?.data?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const act = async (id: string, action: 'start' | 'pause' | 'cancel') => {
    try {
      await api.post(`/whatsapp/campaigns/${id}/${action}`);
      await load();
    } catch (err: any) {
      setFlash(err?.response?.data?.message || `${action} failed`);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this campaign and all its targets? This cannot be undone.')) return;
    try {
      await api.delete(`/whatsapp/campaigns/${id}`);
      await load();
    } catch (err: any) {
      setFlash(err?.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp Campaigns</h1>
          <p className="text-sm text-gray-500 mt-1">
            Send one approved template to many recipients. The worker drains queued targets at each campaign's per-minute rate limit; status flows in via Meta delivery webhooks.
          </p>
        </div>
        <Button onClick={() => nav('/whatsapp/campaigns/new')}>
          <Plus className="w-4 h-4 mr-2" /> New campaign
        </Button>
      </header>

      {flash && (
        <div className="flex items-start gap-2 p-3 rounded text-sm bg-red-50 text-red-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{flash}</span>
        </div>
      )}

      {loading ? (
        <Card><div className="p-8 text-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></Card>
      ) : rows.length === 0 ? (
        <Card>
          <div className="p-8 text-center text-gray-500 space-y-2">
            <p>No campaigns yet.</p>
            <Button onClick={() => nav('/whatsapp/campaigns/new')} size="sm">
              <Plus className="w-3 h-3 mr-1" /> Create your first
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Template</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Recipients</th>
                <th className="px-4 py-3 text-left">Rate / min</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/whatsapp/campaigns/${c.id}`} className="text-blue-600 hover:underline">{c.name}</Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {c.template_name} · {c.template_language}
                  </td>
                  <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[c.status] || 'default'}>{c.status}</Badge></td>
                  <td className="px-4 py-3">{c.total_recipients}</td>
                  <td className="px-4 py-3">{c.rate_limit_per_minute}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {(c.status === 'DRAFT' || c.status === 'PAUSED') && (
                      <button onClick={() => act(c.id, 'start')} title="Start" className="text-green-600 hover:text-green-700 p-1">
                        <Play className="w-4 h-4 inline" />
                      </button>
                    )}
                    {c.status === 'RUNNING' && (
                      <>
                        <button onClick={() => act(c.id, 'pause')} title="Pause" className="text-yellow-600 hover:text-yellow-700 p-1">
                          <Pause className="w-4 h-4 inline" />
                        </button>
                        <button onClick={() => act(c.id, 'cancel')} title="Cancel" className="text-red-600 hover:text-red-700 p-1">
                          <X className="w-4 h-4 inline" />
                        </button>
                      </>
                    )}
                    <button onClick={() => remove(c.id)} title="Delete" className="text-gray-500 hover:text-red-700 p-1">
                      <Trash2 className="w-4 h-4 inline" />
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
