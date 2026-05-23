/**
 * Create a new WhatsApp bulk campaign:
 *   1. Pick template (only APPROVED status enabled by default — Meta rejects
 *      sends from non-approved templates anyway).
 *   2. Name + rate limit per minute.
 *   3. Paste recipients (one per line) OR upload a CSV with columns:
 *      recipient,lead_id?,<variable keys...>
 *   4. Submit → creates DRAFT campaign, posts targets, optionally starts.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import api from '@/services/api';

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  variable_count: number;
  variable_mapping: Record<string, string>;
}

export function CampaignNewPage() {
  const nav = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [rate, setRate] = useState(60);
  const [recipientsText, setRecipientsText] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ templates: Template[] }>('/whatsapp/templates');
        setTemplates(data.templates || []);
      } catch (err: any) {
        setFlash({ type: 'error', text: 'Failed to load templates' });
      }
    })();
  }, []);

  const selected = templates.find((t) => t.id === templateId);

  /** Parse recipients textarea. Each non-empty line is either:
   *   - just a phone:                    "+91XXXXXXXXXX"
   *   - phone with context as JSON:      "+91XXXXXXXXXX | {\"lead\":{\"name\":\"X\"}}"
   *   - phone with comma-separated vars: "+91XXXXXXXXXX, Alice, https://..."
   * For comma format, columns map positionally to {{1}}, {{2}}, ... via
   * variable_context = { "1": "Alice", "2": "https://..." }
   * The worker resolves these directly because variable_mapping points at
   * those keys (we set them to '1','2',... when the user uses comma format). */
  const parseRecipients = (): Array<{ recipient: string; variable_context?: any }> => {
    const out: Array<{ recipient: string; variable_context?: any }> = [];
    for (const raw of recipientsText.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.includes('|')) {
        const [phonePart, jsonPart] = line.split('|', 2);
        const phone = phonePart.trim();
        let ctx: any = {};
        try { ctx = JSON.parse(jsonPart); } catch { /* ignore malformed */ }
        out.push({ recipient: phone, variable_context: ctx });
      } else if (line.includes(',')) {
        const parts = line.split(',').map((s) => s.trim());
        const phone = parts[0];
        const ctx: Record<string, string> = {};
        for (let i = 1; i < parts.length; i++) ctx[String(i)] = parts[i];
        out.push({ recipient: phone, variable_context: ctx });
      } else {
        out.push({ recipient: line });
      }
    }
    return out;
  };

  const submit = async () => {
    setSubmitting(true);
    setFlash(null);
    try {
      if (!templateId || !name) throw new Error('Pick a template and give the campaign a name');
      const targets = parseRecipients();
      if (targets.length === 0) throw new Error('No recipients found');
      const { data: camp } = await api.post('/whatsapp/campaigns', {
        name,
        template_id: templateId,
        rate_limit_per_minute: rate,
      });
      await api.post(`/whatsapp/campaigns/${camp.id}/targets`, { targets });
      if (autoStart) await api.post(`/whatsapp/campaigns/${camp.id}/start`);
      setFlash({ type: 'success', text: `Campaign created with ${targets.length} target(s)${autoStart ? ' and started' : ''}.` });
      setTimeout(() => nav(`/whatsapp/campaigns/${camp.id}`), 800);
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Create failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <button onClick={() => nav('/whatsapp/campaigns')} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Back to campaigns
      </button>
      <header>
        <h1 className="text-2xl font-semibold">New WhatsApp Campaign</h1>
        <p className="text-sm text-gray-500 mt-1">Create a draft, attach recipients, optionally auto-start.</p>
      </header>

      {flash && (
        <div className={`flex items-start gap-2 p-3 rounded text-sm ${flash.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {flash.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
          <span>{flash.text}</span>
        </div>
      )}

      <Card className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Template</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id} disabled={t.status === 'REJECTED' || t.status === 'DISABLED'}>
                {t.name} · {t.language} · {t.status}
                {t.variable_count > 0 ? ` · ${t.variable_count} vars` : ''}
              </option>
            ))}
          </select>
          {selected && selected.variable_count > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Template uses <strong>{selected.variable_count}</strong> variables. Map them in the recipients section below
              or via <code className="font-mono">WA Templates</code>.
            </p>
          )}
          {selected && selected.status !== 'APPROVED' && (
            <p className="mt-2 text-xs text-yellow-700">
              ⚠ Template status is <Badge variant="warning">{selected.status}</Badge> — Meta will reject sends until it's APPROVED.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Campaign name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. May Admissions Blast" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Rate limit (messages per minute)</label>
          <Input type="number" min={1} max={600} value={rate} onChange={(e) => setRate(Number(e.target.value) || 60)} />
          <p className="mt-1 text-xs text-gray-500">
            Meta enforces tier-based per-second caps (250/s on test tier, 1000/s after verification). Keep this conservative.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Recipients (one per line)</label>
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder={'+919999999999\n+918888888888, Alice, https://example.com/brochure.pdf\n+917777777777 | {"lead":{"name":"Bob"},"brochure_url":"https://..."}'}
            rows={8}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-gray-500">
            Formats: <code>+phone</code> alone · <code>+phone, var1, var2</code> (positional) · <code>+phone | {`{"k":"v"}`}</code> (JSON).
            Variable keys must match your template's <code>variable_mapping</code> (e.g. <code>"1"</code>, <code>"lead.name"</code>).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input id="autostart" type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          <label htmlFor="autostart" className="text-sm">Start immediately after creating</label>
        </div>

        <div className="pt-2">
          <Button onClick={submit} disabled={submitting || !templateId || !name || !recipientsText.trim()}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {autoStart ? 'Create + Start' : 'Create as DRAFT'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
