import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, Paperclip, X, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth.store';
import {
  supportApi,
  REPORT_TYPE_OPTIONS, PRIORITY_OPTIONS, PRODUCT_AREA_OPTIONS,
  type ReportType, type Priority, type ProductArea, type ReportSubmitRequest,
} from '@/services/support.api';

type Props = {
  mode: 'public' | 'authed';
  onSubmitted: (res: { ticket_id: string; message: string }) => void;
};

function detectBrowser(): string {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return `Edge ${(ua.match(/Edg\/([\d.]+)/) || [])[1] || ''}`.trim();
  if (/Chrome\//.test(ua)) return `Chrome ${(ua.match(/Chrome\/([\d.]+)/) || [])[1] || ''}`.trim();
  if (/Firefox\//.test(ua)) return `Firefox ${(ua.match(/Firefox\/([\d.]+)/) || [])[1] || ''}`.trim();
  if (/Safari\//.test(ua)) return `Safari ${(ua.match(/Version\/([\d.]+)/) || [])[1] || ''}`.trim();
  return ua.slice(0, 80);
}
function detectOS(): string {
  const ua = navigator.userAgent || '';
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Mac OS X/.test(ua)) return `macOS ${(ua.match(/Mac OS X ([\d_]+)/) || [])[1]?.replace(/_/g, '.') || ''}`.trim();
  if (/Android/.test(ua)) return `Android ${(ua.match(/Android ([\d.]+)/) || [])[1] || ''}`.trim();
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}

const ALLOWED_ATTACHMENT_PREFIXES = ['image/', 'audio/', 'video/', 'text/', 'application/pdf', 'application/zip'];
const MAX_ATTACH_MB = 10;

export function ReportIssueForm({ mode, onSubmitted }: Props) {
  const user = useAuthStore((s: any) => s.user || null);

  const [form, setForm] = useState<ReportSubmitRequest>({
    name: user?.name || '',
    email: user?.email || '',
    phone: '',
    company_name: '',
    user_role: '',
    report_type: 'BUG',
    priority: 'MEDIUM',
    product_area: null,
    title: '',
    description: '',
    expected_behavior: '',
    actual_behavior: '',
    steps_to_reproduce: '',
    affected_agent_id: '',
    affected_call_id: '',
    affected_campaign_id: '',
    browser: detectBrowser(),
    device: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop',
    os: detectOS(),
    consent_contact: true,
    consent_privacy: false,
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user && !form.name && user.name) {
      setForm((f) => ({ ...f, name: user.name, email: user.email || f.email }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const canSubmit = useMemo(() => {
    return form.name.trim().length > 0
      && /.+@.+\..+/.test(form.email)
      && form.title.trim().length > 0
      && form.description.trim().length >= 20
      && form.consent_privacy === true;
  }, [form]);

  const updateField = <K extends keyof ReportSubmitRequest>(key: K, value: ReportSubmitRequest[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    for (const f of list) {
      const prefix = f.type || 'application/octet-stream';
      const ok = ALLOWED_ATTACHMENT_PREFIXES.some((p) => prefix.startsWith(p));
      if (!ok) {
        setError(`File type not allowed: ${f.name} (${prefix})`);
        return;
      }
      if (f.size > MAX_ATTACH_MB * 1024 * 1024) {
        setError(`File too large (max ${MAX_ATTACH_MB}MB): ${f.name}`);
        return;
      }
    }
    setPendingFiles((prev) => [...prev, ...list]);
    if (fileRef.current) fileRef.current.value = '';
    setError(null);
  };

  const removePending = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true); setError(null);
    try {
      const payload: ReportSubmitRequest = {
        ...form,
        // strip empty uuids
        affected_agent_id: form.affected_agent_id || null,
        affected_call_id: form.affected_call_id || null,
        affected_campaign_id: form.affected_campaign_id || null,
      };
      const submit = mode === 'authed' ? supportApi.submit : supportApi.submitPublic;
      const res = await submit(payload);

      // Upload attachments (fire sequentially; failures surface inline)
      for (const f of pendingFiles) {
        const kind = f.type.startsWith('image/') ? 'screenshot'
          : f.type.startsWith('audio/') ? 'audio'
          : f.type.startsWith('video/') ? 'video'
          : f.type.startsWith('text/') || f.type === 'application/pdf' ? 'log'
          : 'file';
        try {
          await supportApi.uploadAttachment(res.ticket_id, f, kind);
        } catch (_e) {
          // Don't abort — just continue with the other files
        }
      }
      onSubmitted({ ticket_id: res.ticket_id, message: res.message });
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not submit the report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Section 1: Contact */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Contact Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Full Name *">
            <input className={inputCls} value={form.name} onChange={(e) => updateField('name', e.target.value)} required />
          </Field>
          <Field label="Email *">
            <input className={inputCls} type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} required />
          </Field>
          <Field label="Phone (with country code) *">
            <input className={inputCls} value={form.phone || ''} onChange={(e) => updateField('phone', e.target.value)} placeholder="+91-9999999999" required />
          </Field>
          <Field label="Company (optional)">
            <input className={inputCls} value={form.company_name || ''} onChange={(e) => updateField('company_name', e.target.value)} />
          </Field>
          <Field label="Your role (optional)">
            <input className={inputCls} value={form.user_role || ''} onChange={(e) => updateField('user_role', e.target.value)} placeholder="Developer / Founder / Support" />
          </Field>
        </div>
      </Card>

      {/* Section 2 + 3 + 4: Type / Priority / Area */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Classification</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Report Type *">
            <select className={inputCls} value={form.report_type} onChange={(e) => updateField('report_type', e.target.value as ReportType)}>
              {REPORT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={(e) => updateField('priority', e.target.value as Priority)}>
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Product Area">
            <select className={inputCls} value={form.product_area || ''} onChange={(e) => updateField('product_area', (e.target.value || null) as ProductArea | null)}>
              <option value="">— pick one —</option>
              {PRODUCT_AREA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      {/* Section 5: Details */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Issue / Feature Details</h2>
        <div className="space-y-3">
          <Field label="Title *">
            <input className={inputCls} value={form.title} onChange={(e) => updateField('title', e.target.value)} required placeholder="Short summary of the problem or feature" />
          </Field>
          <Field label={`Description * (${form.description.trim().length}/20 min)`}>
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={5}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              required
              placeholder="Describe what happened, steps to reproduce, expected vs actual behavior..."
            />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Expected Behavior">
              <textarea className={inputCls} rows={3} value={form.expected_behavior || ''} onChange={(e) => updateField('expected_behavior', e.target.value)} />
            </Field>
            <Field label="Actual Behavior">
              <textarea className={inputCls} rows={3} value={form.actual_behavior || ''} onChange={(e) => updateField('actual_behavior', e.target.value)} />
            </Field>
          </div>
          <Field label="Steps to Reproduce">
            <textarea className={inputCls} rows={3} value={form.steps_to_reproduce || ''} onChange={(e) => updateField('steps_to_reproduce', e.target.value)} placeholder="1. Open ...&#10;2. Click ...&#10;3. Observe ..." />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Agent ID (optional)">
              <input className={inputCls + ' font-mono text-xs'} value={form.affected_agent_id || ''} onChange={(e) => updateField('affected_agent_id', e.target.value)} placeholder="UUID" />
            </Field>
            <Field label="Call ID (optional)">
              <input className={inputCls + ' font-mono text-xs'} value={form.affected_call_id || ''} onChange={(e) => updateField('affected_call_id', e.target.value)} placeholder="UUID" />
            </Field>
            <Field label="Campaign ID (optional)">
              <input className={inputCls + ' font-mono text-xs'} value={form.affected_campaign_id || ''} onChange={(e) => updateField('affected_campaign_id', e.target.value)} placeholder="UUID" />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Browser (auto-detected)">
              <input className={inputCls} value={form.browser || ''} onChange={(e) => updateField('browser', e.target.value)} />
            </Field>
            <Field label="Device">
              <input className={inputCls} value={form.device || ''} onChange={(e) => updateField('device', e.target.value)} />
            </Field>
            <Field label="OS">
              <input className={inputCls} value={form.os || ''} onChange={(e) => updateField('os', e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      {/* Section 6: Attachments */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Attachments</h2>
        <div className="space-y-2">
          <label className="inline-flex items-center gap-2 text-sm text-indigo-600 cursor-pointer hover:text-indigo-700">
            <Paperclip className="h-4 w-4" /> Add files (screenshots, logs, recordings)
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onSelectFiles} accept="image/*,audio/*,video/*,text/*,application/pdf,application/zip" />
          </label>
          <p className="text-xs text-gray-500">Max {MAX_ATTACH_MB}MB each. Images, audio, video, text, PDF, ZIP allowed.</p>
          {pendingFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pendingFiles.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                  <Paperclip className="h-3 w-3 text-gray-500" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-gray-400">{(f.size / 1024).toFixed(1)} KB</span>
                  <button type="button" onClick={() => removePending(i)} className="text-gray-400 hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Section 7: Consent */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Consent</h2>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.consent_contact} onChange={(e) => updateField('consent_contact', e.target.checked)} className="mt-1 rounded border-gray-300" />
          <span>You may contact me at this email/phone about this issue.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700 mt-2">
          <input type="checkbox" checked={form.consent_privacy} onChange={(e) => updateField('consent_privacy', e.target.checked)} className="mt-1 rounded border-gray-300" required />
          <span>I accept the privacy policy and agree to submit this information. *</span>
        </label>
        {mode === 'public' && (
          <p className="mt-3 text-xs text-gray-500">
            Public submissions are rate-limited. A reCAPTCHA challenge may be shown when suspicious traffic is detected.
          </p>
        )}
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {submitting ? 'Submitting...' : 'Submit Report'}
        </Button>
      </div>
    </form>
  );
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
