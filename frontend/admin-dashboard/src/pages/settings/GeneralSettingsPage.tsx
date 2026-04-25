import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Settings, Phone, Puzzle, Users, CreditCard, Save, Shield, AlertCircle, CheckCircle2, Loader2, ScrollText, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { tenantApi, type Tenant } from '@/services/tenant.api';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'API', path: '/settings/api', icon: KeyRound },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
  { label: 'Audit Log', path: '/settings/audit-log', icon: ScrollText },
];

export function GeneralSettingsPage() {
  const location = useLocation();
  const isGeneralPage = location.pathname === '/settings';

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

        {isGeneralPage ? (
          <div className="flex-1 space-y-6">
            <OrganizationCard />
            <PrivacyComplianceCard />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Organization name (real PUT to /tenants/me) ---------- */

function OrganizationCard() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    tenantApi.getMe()
      .then((t) => { setTenant(t); setName(t.name); })
      .catch((e) => setMsg({ kind: 'err', text: e?.response?.data?.error || e.message }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const t = await tenantApi.updateMe({ name: name.trim() });
      setTenant(t);
      setMsg({ kind: 'ok', text: 'Saved' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error || e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Organization"
        subtitle="Basic configuration for your tenant"
        action={
          <Button variant="gradient" onClick={save} loading={saving} disabled={loading || !name.trim() || name === tenant?.name} size="sm" className="rounded-xl">
            <Save className="h-4 w-4" /> Save
          </Button>
        }
      />
      {msg && (
        <div
          className={`flex items-center gap-2 mb-3 p-2 rounded-lg text-xs ${
            msg.kind === 'ok' ? 'bg-success-50 text-success-700 border border-success-200'
                              : 'bg-danger-50 text-danger-700 border border-danger-200'
          }`}
        >
          {msg.kind === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {msg.text}
        </div>
      )}
      <div className="space-y-4 max-w-lg">
        <Input
          label="Organization Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your company name"
          disabled={loading}
        />
        {tenant && (
          <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
            <div>Slug: <span className="font-mono text-gray-700">{tenant.slug}</span></div>
            <div>Plan: <span className="font-mono text-gray-700">{tenant.plan}</span></div>
            <div>Created: <span className="text-gray-700">{new Date(tenant.created_at).toLocaleDateString()}</span></div>
            <div>Tenant ID: <span className="font-mono text-[10px] text-gray-700">{tenant.id}</span></div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- Privacy & Compliance (GDPR retention + PII obfuscation) ---------- */

function PrivacyComplianceCard() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [retentionDays, setRetentionDays] = useState(365);
  const [piiObfuscation, setPiiObfuscation] = useState(false);

  useEffect(() => {
    tenantApi.getMe()
      .then((t) => {
        setTenant(t);
        setRetentionDays(parseInt(String(t.settings?.data_retention_days ?? '365'), 10) || 365);
        setPiiObfuscation(!!t.settings?.pii_obfuscation);
      })
      .catch((e) => setMsg({ kind: 'err', text: e?.response?.data?.error || e.message }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const next = { ...(tenant?.settings || {}), data_retention_days: retentionDays, pii_obfuscation: piiObfuscation };
      const t = await tenantApi.updateMe({ settings: next });
      setTenant(t);
      setMsg({ kind: 'ok', text: 'Privacy settings saved' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.error || e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary-600" />
            <span>Privacy & Compliance</span>
          </div> as any
        }
        subtitle="GDPR-style data retention and personally identifiable information handling"
        action={
          <Button variant="gradient" onClick={save} loading={saving} disabled={loading} size="sm" className="rounded-xl">
            <Save className="h-4 w-4" /> Save
          </Button>
        }
      />

      {msg && (
        <div
          className={`flex items-center gap-2 mb-3 p-2 rounded-lg text-xs ${
            msg.kind === 'ok' ? 'bg-success-50 text-success-700 border border-success-200'
                              : 'bg-danger-50 text-danger-700 border border-danger-200'
          }`}
        >
          {msg.kind === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Data retention: <span className="font-bold text-gray-900">{retentionDays === 0 ? 'Indefinite (off)' : `${retentionDays} days`}</span>
            </label>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">
              Conversations, transcripts, and call recordings older than this are automatically deleted. The sweeper runs every 6 hours.
              Set to <code className="text-[10px] bg-gray-100 px-1 rounded">0</code> to disable auto-deletion.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1825}
                step={30}
                value={retentionDays}
                onChange={(e) => setRetentionDays(parseInt(e.target.value))}
                className="flex-1 accent-primary-600"
              />
              <input
                type="number"
                min={0}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(parseInt(e.target.value) || 0)}
                className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-1.5"
              />
            </div>
            <div className="flex justify-between text-[11px] text-gray-400 mt-1 px-1">
              <span>Off</span><span>30d</span><span>1y</span><span>3y</span><span>5y</span>
            </div>
          </div>

          <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 hover:border-primary-300 cursor-pointer">
            <input
              type="checkbox"
              checked={piiObfuscation}
              onChange={(e) => setPiiObfuscation(e.target.checked)}
              className="mt-0.5 accent-primary-600"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">Mask PII in transcripts</div>
              <div className="text-xs text-gray-500 mt-0.5">
                When enabled, email addresses, phone numbers, and credit-card numbers are replaced with{' '}
                <code className="text-[10px] bg-gray-100 px-1 rounded">[redacted-email]</code>{' '}
                <code className="text-[10px] bg-gray-100 px-1 rounded">[redacted-phone]</code>{' '}
                <code className="text-[10px] bg-gray-100 px-1 rounded">[redacted-card]</code>{' '}
                before being stored. Recordings on disk are not modified.
              </div>
            </div>
          </label>

          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Shield className="h-3.5 w-3.5 text-primary-500" />
              <span className="font-medium text-gray-700">Integration credentials encryption-at-rest</span>
              <span className="ml-auto text-[10px] text-gray-500">AES-256-GCM</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              When the server is started with <code className="bg-gray-100 px-1 rounded">INTEGRATION_ENCRYPTION_KEY</code> set,
              all third-party API keys (Slack/HubSpot/Salesforce/Cal.com/etc.) are encrypted before being written to the database.
              Existing rows continue to work as plaintext until next save.
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Shield className="h-3.5 w-3.5 text-primary-500" />
              <span className="font-medium text-gray-700">Right to data portability (GDPR Art. 15)</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Each call's full record (conversation + transcript + analysis) can be downloaded as JSON or CSV from the call detail page.
              Endpoint: <code className="bg-gray-100 px-1 rounded">GET /api/v1/conversations/:id/export?format=json|csv</code>
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
