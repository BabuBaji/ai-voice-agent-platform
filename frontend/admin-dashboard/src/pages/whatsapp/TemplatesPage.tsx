/**
 * WhatsApp Templates — list, sync from Meta, manage variable mapping,
 * test send. The list is per-tenant; the backend scopes by x-tenant-id
 * (injected by the api client).
 */
import { useEffect, useState } from 'react';
import { RefreshCw, Send, Trash2, AlertCircle, CheckCircle2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  meta_template_id: string | null;
  header_format: string | null;
  header_text: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: any[] | null;
  variable_count: number;
  variable_mapping: Record<string, string>;
  rejection_reason: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  PAUSED: 'info',
  DISABLED: 'default',
};

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ templates: Template[]; count: number }>('/whatsapp/templates');
      setTemplates(data.templates || []);
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || 'Failed to load templates' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    setFlash(null);
    try {
      const { data } = await api.post('/whatsapp/templates/sync');
      if (data.errors?.length) {
        setFlash({ type: data.synced > 0 ? 'success' : 'error', text: `Synced ${data.synced}. Errors: ${data.errors[0]}` });
      } else {
        setFlash({ type: 'success', text: `Synced ${data.synced} templates from Meta (${data.using})` });
      }
      await load();
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this template row? (Local only — does not remove from Meta.)')) return;
    try {
      await api.delete(`/whatsapp/templates/${id}`);
      await load();
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || 'Delete failed' });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage Meta-approved templates and map their <code>{`{{N}}`}</code> slots to CRM fields. First-contact messages and out-of-window sends must use an approved template.
          </p>
        </div>
        <Button onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Sync from Meta
        </Button>
      </header>

      {flash && (
        <div className={`flex items-start gap-2 p-3 rounded text-sm ${flash.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {flash.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <span>{flash.text}</span>
        </div>
      )}

      {loading ? (
        <Card><div className="p-8 text-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></Card>
      ) : templates.length === 0 ? (
        <Card>
          <div className="p-8 text-center text-gray-500 space-y-2">
            <p>No templates yet.</p>
            <p className="text-sm">Click <strong>Sync from Meta</strong> to pull your WABA's approved templates, or submit a template in Meta Business Manager → WhatsApp → Message Templates.</p>
          </div>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left w-8"></th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Language</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Variables</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <RowGroup key={t.id} t={t} expanded={expanded === t.id} onToggle={() => setExpanded(expanded === t.id ? null : t.id)} onChanged={load} onDelete={() => remove(t.id)} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function RowGroup({ t, expanded, onToggle, onChanged, onDelete }: {
  t: Template; expanded: boolean; onToggle: () => void; onChanged: () => void; onDelete: () => void;
}) {
  const variant = STATUS_VARIANT[t.status] || 'default';
  return (
    <>
      <tr className="border-t hover:bg-gray-50">
        <td className="px-4 py-3">
          <button onClick={onToggle} className="text-gray-400 hover:text-gray-700">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>
        <td className="px-4 py-3 font-mono text-xs">{t.name}</td>
        <td className="px-4 py-3 text-gray-600">{t.language}</td>
        <td className="px-4 py-3 text-gray-600">{t.category || '—'}</td>
        <td className="px-4 py-3"><Badge variant={variant}>{t.status}</Badge></td>
        <td className="px-4 py-3 text-gray-600">{t.variable_count}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.updated_at).toLocaleString()}</td>
        <td className="px-4 py-3 text-right">
          <button onClick={onDelete} className="text-red-500 hover:text-red-700" title="Delete (local)">
            <Trash2 className="w-4 h-4 inline" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-gray-50">
          <td colSpan={8} className="px-4 py-4">
            <ExpandedDetail t={t} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({ t, onChanged }: { t: Template; onChanged: () => void }) {
  const [mapping, setMapping] = useState<Record<string, string>>(t.variable_mapping || {});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testCtx, setTestCtx] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const slots: number[] = [];
  for (let i = 1; i <= t.variable_count; i++) slots.push(i);

  const saveMapping = async () => {
    setSaving(true);
    try {
      await api.patch(`/whatsapp/templates/${t.id}`, { variable_mapping: mapping });
      onChanged();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    setTesting(true);
    setTestResult(null);
    let ctx: any = {};
    try { ctx = testCtx ? JSON.parse(testCtx) : {}; } catch { ctx = {}; }
    try {
      const { data } = await api.post(`/whatsapp/templates/${t.id}/test`, { recipient: testTo, context: ctx });
      if (data.ok) {
        setTestResult(`Sent (log_id=${data.log_id}). Params: ${JSON.stringify(data.resolved_params)}`);
      } else {
        const miss = data.missing_variables?.length ? ` Missing: ${data.missing_variables.join(',')}.` : '';
        setTestResult(`Failed: ${data.error || 'unknown'}.${miss}`);
      }
    } catch (err: any) {
      setTestResult(err?.response?.data?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
      <div>
        <h3 className="font-medium mb-2">Body</h3>
        <pre className="bg-white border rounded p-3 text-xs whitespace-pre-wrap font-mono">{t.body_text || '(empty)'}</pre>
        {t.footer_text && <p className="mt-2 text-xs text-gray-500"><em>Footer:</em> {t.footer_text}</p>}
        {t.rejection_reason && <p className="mt-2 text-xs text-red-600">Rejection: {t.rejection_reason}</p>}
        {t.last_synced_at && <p className="mt-2 text-xs text-gray-500">Last synced: {new Date(t.last_synced_at).toLocaleString()}</p>}
      </div>
      <div className="space-y-4">
        <div>
          <h3 className="font-medium mb-2">Variable Mapping</h3>
          {slots.length === 0 ? (
            <p className="text-xs text-gray-500">No variables.</p>
          ) : (
            <div className="space-y-2">
              {slots.map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <code className="text-xs w-12">{`{{${n}}}`}</code>
                  <Input
                    value={mapping[String(n)] || ''}
                    onChange={(e) => setMapping({ ...mapping, [String(n)]: e.target.value })}
                    placeholder={n === 1 ? 'lead.name' : 'extras.brochure_url'}
                    className="flex-1 text-xs"
                  />
                </div>
              ))}
              <Button size="sm" onClick={saveMapping} disabled={saving}>
                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}Save mapping
              </Button>
            </div>
          )}
        </div>
        <div>
          <h3 className="font-medium mb-2">Test Send</h3>
          <div className="space-y-2">
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+91XXXXXXXXXX" className="text-xs" />
            <Input value={testCtx} onChange={(e) => setTestCtx(e.target.value)} placeholder='{"lead":{"name":"Alice"},"brochure_url":"https://..."}' className="text-xs font-mono" />
            <Button size="sm" onClick={testSend} disabled={testing || !testTo}>
              {testing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}Send test
            </Button>
            {testResult && <p className="text-xs text-gray-700 break-words">{testResult}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
