import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Settings, Phone, Puzzle, Users, CreditCard, Save, Zap,
  AlertCircle, CheckCircle2, Loader2, ScrollText, KeyRound, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { tenantApi, type Tenant } from '@/services/tenant.api';

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'Automation', path: '/settings/automation', icon: Zap },
  { label: 'API', path: '/settings/api', icon: KeyRound },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
  { label: 'Audit Log', path: '/settings/audit-log', icon: ScrollText },
];

interface BrochureAutoSend {
  enabled: boolean;
  via_whatsapp: boolean;
  via_email: boolean;
  only_interested: boolean;
  prevent_duplicates: boolean;
}
const DEFAULTS: BrochureAutoSend = {
  enabled: true, via_whatsapp: true, via_email: true,
  only_interested: true, prevent_duplicates: true,
};

export function AutomationSettingsPage() {
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

        <div className="flex-1 space-y-6">
          <BrochureAutoSendCard />
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  checked, onChange, title, description, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border border-gray-200 transition-colors ${
      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-300 cursor-pointer'
    }`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-primary-600"
      />
      <div>
        <div className="text-sm font-medium text-gray-900">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
    </label>
  );
}

function BrochureAutoSendCard() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [cfg, setCfg] = useState<BrochureAutoSend>(DEFAULTS);

  useEffect(() => {
    tenantApi.getMe()
      .then((t) => {
        setTenant(t);
        const b = (t.settings?.brochure_auto_send as Partial<BrochureAutoSend>) || {};
        setCfg({
          enabled: b.enabled ?? DEFAULTS.enabled,
          via_whatsapp: b.via_whatsapp ?? DEFAULTS.via_whatsapp,
          via_email: b.via_email ?? DEFAULTS.via_email,
          only_interested: b.only_interested ?? DEFAULTS.only_interested,
          prevent_duplicates: b.prevent_duplicates ?? DEFAULTS.prevent_duplicates,
        });
      })
      .catch((e) => setMsg({ kind: 'err', text: e?.response?.data?.error || e.message }))
      .finally(() => setLoading(false));
  }, []);

  const set = (patch: Partial<BrochureAutoSend>) => setCfg((c) => ({ ...c, ...patch }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const next = { ...(tenant?.settings || {}), brochure_auto_send: cfg };
      const t = await tenantApi.updateMe({ settings: next });
      setTenant(t);
      setMsg({ kind: 'ok', text: 'Automation settings saved' });
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
            <FileText className="h-5 w-5 text-primary-600" />
            <span>Brochure Auto Send</span>
          </div> as any
        }
        subtitle="Automatically send the brochure to interested leads right after the AI call — no manual step. The manual Send Brochure button always remains available."
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
        <div className="space-y-3">
          <ToggleRow
            checked={cfg.enabled}
            onChange={(v) => set({ enabled: v })}
            title="Enable auto brochure sending"
            description="Master switch. When off, brochures are only sent when you click Send Brochure manually."
          />
          <ToggleRow
            checked={cfg.via_whatsapp}
            onChange={(v) => set({ via_whatsapp: v })}
            disabled={!cfg.enabled}
            title="Send via WhatsApp"
            description="Deliver the brochure over WhatsApp (and SMS as fallback) using your tenant's messaging provider."
          />
          <ToggleRow
            checked={cfg.via_email}
            onChange={(v) => set({ via_email: v })}
            disabled={!cfg.enabled}
            title="Send via Email"
            description="Email the brochure / admission details to leads that shared a valid email address."
          />
          <ToggleRow
            checked={cfg.only_interested}
            onChange={(v) => set({ only_interested: v })}
            disabled={!cfg.enabled}
            title="Send only for interested leads"
            description="Only auto-send when the call shows interest (HOT / Interested / Callback / Counselor meeting / Brochure requested)."
          />
          <ToggleRow
            checked={cfg.prevent_duplicates}
            onChange={(v) => set({ prevent_duplicates: v })}
            disabled={!cfg.enabled}
            title="Prevent duplicate sends"
            description="Never auto-send the same channel twice for a lead. Manual resend is always allowed."
          />
        </div>
      )}
    </Card>
  );
}
