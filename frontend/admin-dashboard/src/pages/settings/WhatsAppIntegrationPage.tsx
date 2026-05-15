import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Settings, Phone, Puzzle, Users, CreditCard, KeyRound, ScrollText,
  MessageSquare, Save, Send, Trash2, AlertCircle, CheckCircle2, Loader2, Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import api from '@/services/api';

const settingsNav = [
  { label: 'General',        path: '/settings',                icon: Settings, end: true },
  { label: 'Phone Numbers',  path: '/settings/phone-numbers',  icon: Phone },
  { label: 'Integrations',   path: '/settings/integrations',   icon: Puzzle },
  { label: 'WhatsApp',       path: '/settings/whatsapp',       icon: MessageSquare },
  { label: 'API',            path: '/settings/api',            icon: KeyRound },
  { label: 'Team',           path: '/settings/team',           icon: Users },
  { label: 'Billing',        path: '/settings/billing',        icon: CreditCard },
  { label: 'Audit Log',      path: '/settings/audit-log',      icon: ScrollText },
];

interface WhatsAppConfig {
  tenant_id: string;
  provider: 'twilio' | 'meta' | 'gupshup' | 'wati' | 'interakt' | 'custom' | null;
  mode: 'sandbox' | 'production';
  account_sid_masked: string | null;
  auth_token_masked: string | null;
  api_key_masked: string | null;
  access_token_masked: string | null;
  sender_number: string | null;
  whatsapp_from: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  template_config: Record<string, any>;
  status: 'active' | 'disabled' | 'error' | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  configured: boolean;
}

const PROVIDER_OPTIONS = [
  { value: 'twilio',   label: 'Twilio WhatsApp',         enabled: true,  hint: 'Fully supported (sandbox + production senders)' },
  { value: 'meta',     label: 'Meta WhatsApp Cloud API', enabled: false, hint: 'Adapter coming soon' },
  { value: 'gupshup',  label: 'Gupshup',                 enabled: false, hint: 'Adapter coming soon' },
  { value: 'wati',     label: 'WATI',                    enabled: false, hint: 'Adapter coming soon' },
  { value: 'interakt', label: 'Interakt',                enabled: false, hint: 'Adapter coming soon' },
];

export function WhatsAppIntegrationPage() {
  const [cfg, setCfg] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [provider, setProvider] = useState<'twilio' | 'meta' | 'gupshup' | 'wati' | 'interakt' | 'custom'>('twilio');
  const [mode, setMode] = useState<'sandbox' | 'production'>('sandbox');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [whatsappFrom, setWhatsappFrom] = useState('');
  const [templateSid, setTemplateSid] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<WhatsAppConfig>('/integrations/whatsapp');
      setCfg(data);
      if (data.configured) {
        setProvider(data.provider || 'twilio');
        setMode(data.mode || 'sandbox');
        setWhatsappFrom(data.whatsapp_from || '');
        setTemplateSid(data.template_config?.default_template_sid || '');
      }
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Failed to load config' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);

  const save = async () => {
    setSaving(true);
    try {
      const credentials: Record<string, string> = {};
      // Only include creds the user actually typed. Empty fields → server
      // keeps the existing encrypted values.
      if (accountSid.trim()) credentials.account_sid = accountSid.trim();
      if (authToken.trim()) credentials.auth_token = authToken.trim();
      const { data } = await api.put<WhatsAppConfig>('/integrations/whatsapp', {
        provider, mode,
        credentials,
        whatsapp_from: whatsappFrom.trim() || null,
        template_config: templateSid.trim() ? { default_template_sid: templateSid.trim() } : {},
      });
      setCfg(data);
      setAccountSid('');
      setAuthToken('');
      setFlash({ type: 'success', text: 'Saved. Use Test Connection to verify.' });
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!testTo.trim()) { setFlash({ type: 'error', text: 'Enter a recipient phone number first.' }); return; }
    setTesting(true);
    try {
      const { data } = await api.post('/integrations/whatsapp/test', { to: testTo.trim() });
      if (data.ok) setFlash({ type: 'success', text: 'Provider accepted the test send.' });
      else setFlash({ type: 'error', text: `Provider rejected: ${data.error || 'unknown'}` });
      await load();
    } catch (err: any) {
      setFlash({ type: 'error', text: err?.response?.data?.message || err?.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect WhatsApp integration for this tenant? Encrypted credentials will be deleted.')) return;
    setSaving(true);
    try {
      await api.delete('/integrations/whatsapp');
      setCfg(null);
      setProvider('twilio'); setMode('sandbox');
      setAccountSid(''); setAuthToken(''); setWhatsappFrom(''); setTemplateSid('');
      setFlash({ type: 'success', text: 'Integration disconnected.' });
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
                <MessageSquare className="h-5 w-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-gray-900">WhatsApp Integration</h2>
              </div>
              {statusBadge}
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Connect your own WhatsApp provider. Each tenant uses their own credentials —
              your keys are encrypted at rest and never exposed to other tenants.
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
                {/* Provider */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {PROVIDER_OPTIONS.map((p) => {
                      const active = provider === p.value;
                      const disabled = !p.enabled;
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => !disabled && setProvider(p.value as any)}
                          disabled={disabled}
                          className={`text-left p-3 rounded-xl border transition-colors ${
                            active
                              ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-100'
                              : disabled
                                ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-900">{p.label}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{p.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    {(['sandbox', 'production'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                          mode === m ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {mode === 'sandbox' && (
                    <p className="text-[11px] text-amber-700 mt-1.5 inline-flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Sandbox: recipients must send the Twilio "join &lt;code&gt;" once before they can receive WhatsApp messages.
                    </p>
                  )}
                </div>

                {/* Twilio credentials */}
                {provider === 'twilio' && (
                  <>
                    <Input
                      label="Twilio Account SID"
                      placeholder={cfg?.account_sid_masked || 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                      value={accountSid}
                      onChange={(e) => setAccountSid(e.target.value)}
                    />
                    {cfg?.account_sid_masked && !accountSid && (
                      <p className="text-[11px] text-gray-400 -mt-3">Saved value: <code className="font-mono">{cfg.account_sid_masked}</code> · leave blank to keep</p>
                    )}
                    <Input
                      label="Twilio Auth Token"
                      type="password"
                      placeholder={cfg?.auth_token_masked || '32-char token from Twilio Console'}
                      value={authToken}
                      onChange={(e) => setAuthToken(e.target.value)}
                    />
                    {cfg?.auth_token_masked && !authToken && (
                      <p className="text-[11px] text-gray-400 -mt-3">Saved value: hidden · leave blank to keep</p>
                    )}
                    <Input
                      label="WhatsApp Sender (E.164)"
                      placeholder="+14155238886 (Twilio sandbox) or +91… (your approved Business Sender)"
                      value={whatsappFrom}
                      onChange={(e) => setWhatsappFrom(e.target.value)}
                    />
                    {mode === 'production' && (
                      <Input
                        label="Content Template SID (Meta-approved, optional)"
                        placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={templateSid}
                        onChange={(e) => setTemplateSid(e.target.value)}
                      />
                    )}
                  </>
                )}

                {/* Action row */}
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <Button variant="gradient" onClick={save} disabled={saving} className="rounded-xl">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                  {cfg?.configured && (
                    <Button variant="outline" onClick={disconnect} disabled={saving} className="rounded-xl text-rose-700 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" /> Disconnect
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Test send */}
          {cfg?.configured && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Test Send</h3>
              <p className="text-xs text-gray-500 mb-3">
                Sends a one-line WhatsApp from this tenant's configured sender to the number below.
                The result is recorded in communication_logs.
              </p>
              <div className="flex gap-2">
                <Input
                  label=""
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="+919491326956"
                  className="flex-1"
                />
                <Button variant="outline" onClick={test} disabled={testing} className="rounded-xl">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send Test
                </Button>
              </div>
              {cfg.last_tested_at && (
                <p className="text-[11px] text-gray-400 mt-3">
                  Last tested {new Date(cfg.last_tested_at).toLocaleString()}: <span className="text-gray-600">{cfg.last_test_result}</span>
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
