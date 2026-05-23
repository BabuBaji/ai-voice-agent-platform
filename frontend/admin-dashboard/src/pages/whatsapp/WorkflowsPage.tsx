/**
 * WhatsApp lead-lifecycle workflows. Per tenant: 6 default events
 * (lead_created, interested, no_answer, callback_requested,
 * admission_confirmed, payment_pending). Each row shows the template that
 * will fire + side-effect toggles, with inline edit.
 */
import { useEffect, useState } from 'react';
import { Save, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

interface Workflow {
  tenant_id: string;
  workflow_event: string;
  template_name: string | null;
  template_language: string;
  also_assign_counselor: boolean;
  also_notify_admin: boolean;
  active: boolean;
  updated_at: string;
}

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
}

const EVENT_LABELS: Record<string, { label: string; description: string }> = {
  lead_created: { label: 'Lead Created', description: 'Fires once per (lead, day) when ANY new lead is added — manual entry, CSV upload, contact form, voice-agent call, Meta Ads.' },
  interested: { label: 'Interested', description: 'When voice-agent classifies as HOT/INTERESTED, or status moves to QUALIFIED. Typical config: send brochure + assign counselor + notify admin.' },
  no_answer: { label: 'No Answer', description: 'Voice-agent could not reach the lead. Send retry follow-up template.' },
  callback_requested: { label: 'Callback Requested', description: 'Lead asked for a callback. Confirm via WhatsApp + notify the counselor.' },
  admission_confirmed: { label: 'Admission Confirmed', description: 'One-shot per lead. Send welcome/onboarding message.' },
  payment_pending: { label: 'Payment Pending', description: 'Send payment reminder template.' },
};

export function WorkflowsPage() {
  const [rows, setRows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEvent, setSavingEvent] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [w, t] = await Promise.all([
        api.get<{ workflows: Workflow[] }>('/whatsapp/workflows'),
        api.get<{ templates: Template[] }>('/whatsapp/templates'),
      ]);
      setRows(w.data.workflows || []);
      setTemplates(t.data.templates || []);
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (event: string, patch: Partial<Workflow>) => {
    setRows((rs) => rs.map((r) => (r.workflow_event === event ? { ...r, ...patch } : r)));
  };

  const save = async (w: Workflow) => {
    setSavingEvent(w.workflow_event);
    setFlash(null);
    try {
      await api.put(`/whatsapp/workflows/${w.workflow_event}`, {
        template_name: w.template_name,
        also_assign_counselor: w.also_assign_counselor,
        also_notify_admin: w.also_notify_admin,
        active: w.active,
      });
      setFlash({ type: 'success', text: `Saved ${w.workflow_event}` });
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || 'Save failed' });
    } finally {
      setSavingEvent(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">WhatsApp Workflows</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure which WhatsApp template fires for each lead-lifecycle event, and which side-effects
          (counselor assignment, admin notification) run alongside. Events are fired automatically by the
          voice agent post-call processor and the CRM lead hooks.
        </p>
      </header>

      {flash && (
        <div className={`flex items-start gap-2 p-3 rounded text-sm ${flash.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {flash.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
          <span>{flash.text}</span>
        </div>
      )}

      {loading ? (
        <Card><div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((w) => {
            const meta = EVENT_LABELS[w.workflow_event] || { label: w.workflow_event, description: '' };
            return (
              <Card key={w.workflow_event} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{meta.label}</h3>
                      <code className="text-xs text-gray-500 font-mono">{w.workflow_event}</code>
                      {w.active ? <Badge variant="success">active</Badge> : <Badge variant="default">inactive</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{meta.description}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm shrink-0">
                    <input type="checkbox" checked={w.active} onChange={(e) => update(w.workflow_event, { active: e.target.checked })} />
                    Active
                  </label>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
                    <select
                      value={w.template_name || ''}
                      onChange={(e) => update(w.workflow_event, { template_name: e.target.value || null })}
                      className="w-full border rounded px-2 py-1 text-sm"
                    >
                      <option value="">— no send —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name} · {t.language} · {t.status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={w.also_assign_counselor} onChange={(e) => update(w.workflow_event, { also_assign_counselor: e.target.checked })} />
                    Assign counselor (round-robin)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={w.also_notify_admin} onChange={(e) => update(w.workflow_event, { also_notify_admin: e.target.checked })} />
                    Notify admin
                  </label>
                </div>
                <div className="mt-3 text-right">
                  <Button size="sm" onClick={() => save(w)} disabled={savingEvent === w.workflow_event}>
                    {savingEvent === w.workflow_event ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    Save
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
