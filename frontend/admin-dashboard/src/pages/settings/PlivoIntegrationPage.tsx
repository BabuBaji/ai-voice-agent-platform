import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Settings, Phone, Puzzle, Users, CreditCard, KeyRound, ScrollText,
  MessageSquare, Send, Save, Trash2, AlertCircle, CheckCircle2, Loader2, Shield, Radio, Mail,
  Plus, FileText, History, X, Pencil, Check, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import api from '@/services/api';

const settingsNav = [
  { label: 'General',        path: '/settings',                icon: Settings, end: true },
  { label: 'Phone Numbers',  path: '/settings/phone-numbers',  icon: Phone },
  { label: 'Integrations',   path: '/settings/integrations',   icon: Puzzle },
  { label: 'Automation',     path: '/settings/automation',     icon: Zap },
  { label: 'WhatsApp',       path: '/settings/whatsapp',       icon: MessageSquare },
  { label: 'Plivo',          path: '/settings/plivo',          icon: Radio },
  { label: 'Plivo Features', path: '/settings/plivo-features', icon: Radio },
  { label: 'API',            path: '/settings/api',            icon: KeyRound },
  { label: 'Team',           path: '/settings/team',           icon: Users },
  { label: 'Billing',        path: '/settings/billing',        icon: CreditCard },
  { label: 'Audit Log',      path: '/settings/audit-log',      icon: ScrollText },
];

interface PlivoTemplate {
  id: string;
  content?: string;
  dlt_id?: string;
}

interface PlivoConfig {
  tenant_id: string;
  auth_id_masked: string | null;
  auth_token_masked: string | null;
  sms_sender_id: string | null;
  whatsapp_sender: string | null;
  dlt_entity_id: string | null;
  dlt_template_config: {
    default_template_id?: string;
    templates?: PlivoTemplate[];
    whatsapp_namespace?: string;
  };
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  status: 'active' | 'disabled' | 'error' | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  configured: boolean;
}

export function PlivoIntegrationPage() {
  const [cfg, setCfg] = useState<PlivoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSms, setTestingSms] = useState(false);
  const [testingWa, setTestingWa] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [authId, setAuthId] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [smsSenderId, setSmsSenderId] = useState('');
  const [whatsappSender, setWhatsappSender] = useState('');
  const [dltEntityId, setDltEntityId] = useState('');
  const [defaultTemplateId, setDefaultTemplateId] = useState('');
  const [whatsappNamespace, setWhatsappNamespace] = useState('');
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [testTo, setTestTo] = useState('');
  // Templates editor — the dlt_template_config.templates[] array.
  const [templates, setTemplates] = useState<PlivoTemplate[]>([]);
  const [editingTpl, setEditingTpl] = useState<PlivoTemplate | null>(null);
  const [editingIdx, setEditingIdx] = useState<number>(-1);
  // Audit timeline
  interface AuditRow {
    id: string;
    actor_user_id: string | null;
    actor_email: string | null;
    action: string;
    field_changes: Record<string, any>;
    ip: string | null;
    created_at: string;
  }
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<PlivoConfig>('/integrations/plivo');
      setCfg(data);
      if (data.configured) {
        setSmsSenderId(data.sms_sender_id || '');
        setWhatsappSender(data.whatsapp_sender || '');
        setDltEntityId(data.dlt_entity_id || '');
        setDefaultTemplateId(data.dlt_template_config?.default_template_id || '');
        setWhatsappNamespace(data.dlt_template_config?.whatsapp_namespace || '');
        setSmsEnabled(data.sms_enabled);
        setWhatsappEnabled(data.whatsapp_enabled);
        setTemplates(Array.isArray(data.dlt_template_config?.templates) ? data.dlt_template_config.templates : []);
      }
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Failed to load Plivo config' });
    } finally {
      setLoading(false);
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const { data } = await api.get<{ data: AuditRow[] }>('/integrations/plivo/audit', { params: { limit: 50 } });
      setAudit(data.data || []);
    } catch {
      // audit is best-effort — don't block the page if it 500s
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => { load(); loadAudit(); }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);

  const save = async () => {
    if (!authId.trim() && !cfg?.configured) {
      setFlash({ type: 'error', text: 'Auth ID is required.' });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, any> = {
        auth_id: authId.trim() || cfg?.auth_id_masked?.replace(/[^A-Z0-9]/g, '') || '',
        sms_sender_id: smsSenderId.trim() || null,
        whatsapp_sender: whatsappSender.trim() || null,
        dlt_entity_id: dltEntityId.trim() || null,
        dlt_template_config: {
          default_template_id: defaultTemplateId.trim() || undefined,
          whatsapp_namespace: whatsappNamespace.trim() || undefined,
          templates: templates.length ? templates : undefined,
        },
        sms_enabled: smsEnabled,
        whatsapp_enabled: whatsappEnabled,
      };
      // Only send auth_token when the user actually typed a fresh value —
      // empty string means "keep existing encrypted token".
      if (authToken.trim()) body.auth_token = authToken.trim();

      const { data } = await api.put<PlivoConfig>('/integrations/plivo', body);
      setCfg(data);
      setAuthId('');
      setAuthToken('');
      setFlash({ type: 'success', text: 'Saved. Use Test SMS / Test WhatsApp to verify delivery.' });
      void loadAudit();
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  // Templates editor handlers — local state mutations, persisted on next save.
  const startAddTemplate = () => {
    setEditingTpl({ id: '', content: '', dlt_id: '' });
    setEditingIdx(-1);
  };
  const startEditTemplate = (idx: number) => {
    setEditingTpl({ ...templates[idx] });
    setEditingIdx(idx);
  };
  const cancelEditTemplate = () => { setEditingTpl(null); setEditingIdx(-1); };
  const saveEditTemplate = () => {
    if (!editingTpl) return;
    if (!editingTpl.id.trim()) { setFlash({ type: 'error', text: 'Template ID is required.' }); return; }
    const next = [...templates];
    if (editingIdx >= 0) next[editingIdx] = { ...editingTpl, id: editingTpl.id.trim() };
    else next.push({ ...editingTpl, id: editingTpl.id.trim() });
    setTemplates(next);
    cancelEditTemplate();
  };
  const removeTemplate = (idx: number) => {
    if (!confirm(`Remove template "${templates[idx].id}"?`)) return;
    setTemplates(templates.filter((_, i) => i !== idx));
  };

  const test = async (channel: 'sms' | 'whatsapp') => {
    if (!testTo.trim()) { setFlash({ type: 'error', text: 'Enter a recipient phone number first.' }); return; }
    const setter = channel === 'sms' ? setTestingSms : setTestingWa;
    setter(true);
    try {
      const { data } = await api.post(`/integrations/plivo/test/${channel}`, { to: testTo.trim() });
      if (data.ok) setFlash({ type: 'success', text: `Plivo accepted the test ${channel.toUpperCase()}.` });
      else setFlash({ type: 'error', text: `Plivo rejected: ${data.error || 'unknown'}` });
      await load();
      void loadAudit();
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Test failed' });
    } finally {
      setter(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Plivo integration for this tenant? Encrypted credentials will be deleted.')) return;
    setSaving(true);
    try {
      await api.delete('/integrations/plivo');
      setCfg(null);
      setAuthId(''); setAuthToken('');
      setSmsSenderId(''); setWhatsappSender('');
      setDltEntityId(''); setDefaultTemplateId(''); setWhatsappNamespace('');
      setSmsEnabled(true); setWhatsappEnabled(true);
      setTemplates([]);
      setFlash({ type: 'success', text: 'Plivo integration disconnected.' });
      void loadAudit();
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Disconnect failed' });
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = cfg?.configured ? (
    cfg.status === 'active'
      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><CheckCircle2 className="h-3 w-3" /> Active</span>
      : cfg.status === 'error'
      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-200"><AlertCircle className="h-3 w-3" /> Error</span>
      : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700"><Shield className="h-3 w-3" /> Disabled</span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">Not configured</span>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and platform settings</p>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 flex-shrink-0">
          <ul className="space-y-1">
            {settingsNav.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={(item as any).end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex-1 space-y-5">
          <Card className="p-5">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-gray-900">Plivo Integration</h2>
              </div>
              {statusBadge}
            </div>
            <p className="text-sm text-gray-500 mb-4">
              One Plivo account covers SMS, WhatsApp, and OTP. Credentials are encrypted at rest
              with AES-256-GCM and never sent back to the browser. DLT fields are required for
              SMS delivery to Indian numbers (TRAI mandate).
            </p>

            {flash && (
              <div className={`flex items-start gap-2 p-3 rounded-lg text-sm mb-4 ${
                flash.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}>
                {flash.type === 'success' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                <span>{flash.text}</span>
              </div>
            )}

            {loading ? (
              <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-gray-400" /></div>
            ) : (
              <div className="space-y-5">
                {/* Credentials */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">Credentials</h3>
                  <Input
                    label="Plivo Auth ID"
                    placeholder={cfg?.auth_id_masked || 'MAxxxxxxxxxxxxxxxxxxxx'}
                    value={authId}
                    onChange={(e) => setAuthId(e.target.value)}
                  />
                  <Input
                    label="Plivo Auth Token"
                    type="password"
                    placeholder={cfg?.auth_token_masked || 'Enter the auth token from your Plivo console'}
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    helperText={cfg?.configured ? 'Leave blank to keep the existing encrypted token.' : 'Required on first save. Encrypted at rest.'}
                  />
                </div>

                {/* SMS */}
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">SMS</h3>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={smsEnabled}
                        onChange={(e) => setSmsEnabled(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Enabled
                    </label>
                  </div>
                  <Input
                    label="SMS Sender ID"
                    placeholder="+919876543210  or  VOICEAI  (DLT-registered header)"
                    value={smsSenderId}
                    onChange={(e) => setSmsSenderId(e.target.value)}
                    helperText="E.164 phone OR DLT-approved 6-character alphanumeric header."
                  />
                </div>

                {/* WhatsApp */}
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">WhatsApp</h3>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={whatsappEnabled}
                        onChange={(e) => setWhatsappEnabled(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Enabled
                    </label>
                  </div>
                  <Input
                    label="WhatsApp Business Sender"
                    placeholder="+919876543210"
                    value={whatsappSender}
                    onChange={(e) => setWhatsappSender(e.target.value)}
                    helperText="The WhatsApp-enabled number registered with Plivo + Meta."
                  />
                  <Input
                    label="WhatsApp Template Namespace (optional)"
                    placeholder="en_US"
                    value={whatsappNamespace}
                    onChange={(e) => setWhatsappNamespace(e.target.value)}
                    helperText="Default language tag for template messages."
                  />
                </div>

                {/* India DLT */}
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700">India DLT compliance (SMS to +91 numbers)</h3>
                  <p className="text-[11px] text-gray-500 -mt-1.5">
                    TRAI requires every Indian SMS to carry a registered Principal Entity ID
                    and an approved Template ID. Without these, carriers will silently drop
                    your messages.
                  </p>
                  <Input
                    label="DLT Principal Entity ID"
                    placeholder="1101234567890123456"
                    value={dltEntityId}
                    onChange={(e) => setDltEntityId(e.target.value)}
                  />
                  <Input
                    label="Default DLT Template ID"
                    placeholder="1107161234567890"
                    value={defaultTemplateId}
                    onChange={(e) => setDefaultTemplateId(e.target.value)}
                    helperText="Used when a caller doesn't pass an explicit template_id."
                  />
                </div>

                {/* Templates editor */}
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-gray-500" /> Approved Templates
                    </h3>
                    <Button variant="ghost" onClick={startAddTemplate} disabled={!!editingTpl} className="text-primary-600 hover:bg-primary-50 text-xs">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add template
                    </Button>
                  </div>
                  <p className="text-[11px] text-gray-500 -mt-2">
                    A reference of every DLT / WhatsApp template you can pass as <code className="bg-gray-100 px-1 rounded text-[10px]">template_id</code> when sending.
                    <strong> id</strong> is the friendly label used in code; <strong>dlt_id</strong> is the registered ID Plivo sends to the carrier.
                  </p>

                  {templates.length === 0 && !editingTpl ? (
                    <div className="text-center py-6 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
                      No templates yet. Add one to use it in campaigns or the agent's <code className="bg-gray-100 px-1 rounded">send_sms</code> tool.
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                      {templates.map((t, idx) => (
                        <li key={`${t.id}-${idx}`} className="px-3 py-2.5 flex items-start gap-3 bg-white hover:bg-gray-50">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 font-mono">{t.id}</div>
                            {t.content && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{t.content}</div>}
                            {t.dlt_id && <div className="text-[11px] text-gray-400 mt-0.5">DLT: <span className="font-mono">{t.dlt_id}</span></div>}
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEditTemplate(idx)} title="Edit" className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => removeTemplate(idx)} title="Remove" className="p-1.5 rounded-md text-gray-400 hover:text-rose-600 hover:bg-rose-50">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {editingTpl && (
                    <div className="border border-primary-200 rounded-lg p-3 bg-primary-50/40 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-primary-700">{editingIdx >= 0 ? 'Edit template' : 'New template'}</span>
                        <button onClick={cancelEditTemplate} className="text-gray-400 hover:text-gray-700">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <Input
                        label="Template ID (label)"
                        placeholder="brochure_intro_v1"
                        value={editingTpl.id}
                        onChange={(e) => setEditingTpl({ ...editingTpl, id: e.target.value })}
                      />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Template content (preview)</label>
                        <textarea
                          rows={3}
                          placeholder="Hi {{1}}, your brochure for {{2}} is ready: {{3}}"
                          value={editingTpl.content || ''}
                          onChange={(e) => setEditingTpl({ ...editingTpl, content: e.target.value })}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary-100"
                        />
                      </div>
                      <Input
                        label="DLT / Meta registered ID"
                        placeholder="1107161234567890123"
                        value={editingTpl.dlt_id || ''}
                        onChange={(e) => setEditingTpl({ ...editingTpl, dlt_id: e.target.value })}
                        helperText="The ID the carrier knows about. Required for India SMS; optional for WhatsApp where Plivo can resolve by template name."
                      />
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" onClick={cancelEditTemplate} className="text-gray-600 text-xs">Cancel</Button>
                        <Button onClick={saveEditTemplate} className="text-xs">
                          <Check className="h-3.5 w-3.5 mr-1" /> {editingIdx >= 0 ? 'Update' : 'Add'} template
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Test connection */}
                <div className="pt-2 border-t border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Test connection</h3>
                  <div className="flex flex-wrap gap-2 items-end">
                    <Input
                      label="Recipient (E.164)"
                      placeholder="+919876543210"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                      className="flex-1 min-w-[200px]"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => test('sms')}
                      disabled={!cfg?.configured || testingSms || testingWa || !smsEnabled}
                      title={!smsEnabled ? 'SMS is disabled' : ''}
                    >
                      {testingSms ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                      Test SMS
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => test('whatsapp')}
                      disabled={!cfg?.configured || testingSms || testingWa || !whatsappEnabled}
                      title={!whatsappEnabled ? 'WhatsApp is disabled' : ''}
                    >
                      {testingWa ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-1.5" />}
                      Test WhatsApp
                    </Button>
                  </div>
                  {cfg?.last_tested_at && (
                    <p className="text-[11px] text-gray-500 mt-2">
                      Last tested {new Date(cfg.last_tested_at).toLocaleString()}: {cfg.last_test_result || '—'}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                  {cfg?.configured && (
                    <Button variant="ghost" onClick={disconnect} disabled={saving} className="text-rose-600 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Disconnect
                    </Button>
                  )}
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Audit timeline */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <History className="h-4 w-4 text-gray-500" /> Recent changes
              </h3>
              {auditLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
            <p className="text-[12px] text-gray-500 mb-3">
              Every save, disconnect, and test attempt against this integration.
              Credential rotations are recorded but never display the plaintext token.
            </p>
            {audit.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
                No changes recorded yet.
              </div>
            ) : (
              <ol className="relative border-l border-gray-200 ml-2 space-y-3">
                {audit.map((row) => {
                  const actionColor = row.action === 'disconnected' ? 'text-rose-700 bg-rose-50 ring-rose-200'
                                    : row.action === 'created'      ? 'text-emerald-700 bg-emerald-50 ring-emerald-200'
                                    : row.action === 'tested'       ? 'text-violet-700 bg-violet-50 ring-violet-200'
                                    : 'text-blue-700 bg-blue-50 ring-blue-200';
                  const changeKeys = row.field_changes ? Object.keys(row.field_changes) : [];
                  return (
                    <li key={row.id} className="ml-4">
                      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-white border-2 border-gray-300" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ring-1 ${actionColor}`}>
                          {row.action}
                        </span>
                        <span className="text-xs text-gray-700">{row.actor_email || row.actor_user_id || 'system'}</span>
                        <span className="text-[11px] text-gray-400">· {new Date(row.created_at).toLocaleString()}</span>
                      </div>
                      {changeKeys.length > 0 && (
                        <div className="mt-1 text-[11px] text-gray-500 font-mono">
                          {changeKeys.map((k) => {
                            const v = row.field_changes[k];
                            if (v && v.rotated) return <span key={k} className="inline-block mr-2"><strong className="text-gray-700">{k}</strong>: rotated</span>;
                            if (v && typeof v === 'object' && 'to' in v) return <span key={k} className="inline-block mr-2"><strong className="text-gray-700">{k}</strong>: {JSON.stringify(v.from)} → {JSON.stringify(v.to)}</span>;
                            return <span key={k} className="inline-block mr-2"><strong className="text-gray-700">{k}</strong>: {JSON.stringify(v)}</span>;
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          {/* Help card */}
          <Card className="p-5 bg-gray-50 border border-gray-100">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-gray-500 mt-0.5" />
              <div className="text-sm text-gray-600 space-y-1.5">
                <p className="font-medium text-gray-700">Where do I find these values?</p>
                <ul className="list-disc list-inside space-y-1 text-[13px]">
                  <li>Auth ID + Auth Token: <a href="https://console.plivo.com/" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">console.plivo.com</a> → Account → Plivo Auth</li>
                  <li>SMS Sender: Phone Numbers → buy or use your Plivo-owned number, OR register a DLT alphanumeric header</li>
                  <li>WhatsApp Sender: Messaging → WhatsApp → register your business sender with Meta via Plivo</li>
                  <li>DLT Entity / Template IDs: <a href="https://www.fast2sms.com/dlt/" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">trai.gov.in DLT portal</a> after onboarding your principal entity</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
