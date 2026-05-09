import { useEffect, useState } from 'react';
import { AlertCircle, Clock, Globe2, Loader2, Network, Shield, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { phoneNumberApi, type PhoneNumberRecord, type RouteConfig } from '@/services/phoneNumber.api';
import { agentApi } from '@/services/agent.api';

interface Props {
  open: boolean;
  phone: PhoneNumberRecord | null;
  onClose: () => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface AgentLite { id: string; name: string }

const EMPTY: RouteConfig = {
  business_hours: {
    enabled: false,
    timezone: 'Asia/Kolkata',
    days: { '0': null, '1': { open: '09:00', close: '18:00' }, '2': { open: '09:00', close: '18:00' }, '3': { open: '09:00', close: '18:00' }, '4': { open: '09:00', close: '18:00' }, '5': { open: '09:00', close: '18:00' }, '6': null },
    after_hours_message: 'Sorry, we\'re closed right now. Please call back during business hours.',
  },
  failover: { enabled: false, failover_agent_id: null, failover_number_id: null },
  ivr: { enabled: false, greeting: 'Press 1 to talk to sales. Press 2 for support.', menu: [], timeout_seconds: 8 },
  geo: { enabled: false, allowed_country_codes: [], blocked_country_codes: [] },
  spam_dnd: { enabled: false, blocked_numbers: [] },
};

export function RouteConfigModal({ open, phone, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<RouteConfig>(EMPTY);
  const [agents, setAgents] = useState<AgentLite[]>([]);

  useEffect(() => {
    if (!open || !phone) return;
    setError(null);
    setLoading(true);
    Promise.all([
      phoneNumberApi.getRoute(phone.id),
      agentApi.list().catch(() => []),
    ])
      .then(([loaded, agentRows]) => {
        setCfg({
          ...EMPTY,
          ...loaded,
          business_hours: { ...EMPTY.business_hours!, ...(loaded.business_hours || {}) },
          failover: { ...EMPTY.failover!, ...(loaded.failover || {}) },
          ivr: { ...EMPTY.ivr!, ...(loaded.ivr || {}) },
          geo: { ...EMPTY.geo!, ...(loaded.geo || {}) },
          spam_dnd: { ...EMPTY.spam_dnd!, ...(loaded.spam_dnd || {}) },
        });
        setAgents((agentRows || []).map((a: any) => ({ id: a.id, name: a.name })));
      })
      .catch((e: any) => setError(e?.response?.data?.message || e?.message || 'Could not load routing config'))
      .finally(() => setLoading(false));
  }, [open, phone]);

  if (!open || !phone) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await phoneNumberApi.putRoute(phone.id, cfg);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Network className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Routing rules</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                <span className="font-mono">{phone.phone_number}</span> — control when calls are taken, where they go, and who's blocked.
              </p>
            </div>
          </div>
          <button onClick={() => !saving && onClose()} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading current routing config…
            </div>
          ) : (
            <>
              {/* Business hours */}
              <Section
                icon={<Clock className="h-4 w-4 text-primary-600" />}
                title="Business hours"
                subtitle="Reject or fail-over calls received outside these hours."
                enabled={!!cfg.business_hours?.enabled}
                onToggle={(v) => setCfg({ ...cfg, business_hours: { ...cfg.business_hours!, enabled: v } })}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Timezone</label>
                    <input
                      type="text"
                      value={cfg.business_hours?.timezone || 'UTC'}
                      onChange={(e) => setCfg({ ...cfg, business_hours: { ...cfg.business_hours!, timezone: e.target.value } })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                      placeholder="Asia/Kolkata"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">After-hours message</label>
                    <input
                      type="text"
                      value={cfg.business_hours?.after_hours_message || ''}
                      onChange={(e) => setCfg({ ...cfg, business_hours: { ...cfg.business_hours!, after_hours_message: e.target.value } })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                      placeholder="Spoken to caller before hanging up."
                    />
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-2 mt-3">
                  {DAYS.map((label, i) => {
                    const slot = cfg.business_hours?.days?.[String(i)] || null;
                    const open = !!slot;
                    return (
                      <div key={i} className={`rounded-lg border px-2 py-2 text-center text-xs ${open ? 'border-primary-200 bg-primary-50/50' : 'border-gray-200 bg-gray-50'}`}>
                        <div className="font-medium text-gray-700 mb-1">{label}</div>
                        <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer mb-1">
                          <input
                            type="checkbox"
                            checked={open}
                            onChange={(e) => {
                              const newDays = { ...(cfg.business_hours?.days || {}) };
                              newDays[String(i)] = e.target.checked ? { open: '09:00', close: '18:00' } : null;
                              setCfg({ ...cfg, business_hours: { ...cfg.business_hours!, days: newDays } });
                            }}
                          />
                          Open
                        </label>
                        {open && (
                          <>
                            <input
                              type="time"
                              value={slot.open}
                              onChange={(e) => {
                                const newDays = { ...(cfg.business_hours?.days || {}) };
                                newDays[String(i)] = { ...slot, open: e.target.value };
                                setCfg({ ...cfg, business_hours: { ...cfg.business_hours!, days: newDays } });
                              }}
                              className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white mb-0.5"
                            />
                            <input
                              type="time"
                              value={slot.close}
                              onChange={(e) => {
                                const newDays = { ...(cfg.business_hours?.days || {}) };
                                newDays[String(i)] = { ...slot, close: e.target.value };
                                setCfg({ ...cfg, business_hours: { ...cfg.business_hours!, days: newDays } });
                              }}
                              className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Failover */}
              <Section
                icon={<Network className="h-4 w-4 text-primary-600" />}
                title="Failover"
                subtitle="When the primary agent or carrier isn't available, fall over to a backup."
                enabled={!!cfg.failover?.enabled}
                onToggle={(v) => setCfg({ ...cfg, failover: { ...cfg.failover!, enabled: v } })}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Failover agent</label>
                    <select
                      value={cfg.failover?.failover_agent_id || ''}
                      onChange={(e) => setCfg({ ...cfg, failover: { ...cfg.failover!, failover_agent_id: e.target.value || null } })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="">— none —</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">After-hours / paused → route here.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Failover carrier</label>
                    <select
                      value={cfg.failover?.failover_provider || ''}
                      onChange={(e) => setCfg({ ...cfg, failover: { ...cfg.failover!, failover_provider: (e.target.value || null) as any } })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="">— same carrier —</option>
                      <option value="plivo">Plivo</option>
                      <option value="twilio">Twilio</option>
                      <option value="exotel">Exotel</option>
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">On 402/429/5xx outbound → retry via this carrier (a tenant number on it must exist).</p>
                  </div>
                </div>
              </Section>

              {/* Geo */}
              <Section
                icon={<Globe2 className="h-4 w-4 text-primary-600" />}
                title="Country routing"
                subtitle="Allow or block calls based on the caller's country code."
                enabled={!!cfg.geo?.enabled}
                onToggle={(v) => setCfg({ ...cfg, geo: { ...cfg.geo!, enabled: v } })}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Allowed countries (comma-separated, e.g. 91,1)</label>
                    <input
                      type="text"
                      value={(cfg.geo?.allowed_country_codes || []).join(',')}
                      onChange={(e) => setCfg({ ...cfg, geo: { ...cfg.geo!, allowed_country_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                      placeholder="91, 1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Blocked countries</label>
                    <input
                      type="text"
                      value={(cfg.geo?.blocked_country_codes || []).join(',')}
                      onChange={(e) => setCfg({ ...cfg, geo: { ...cfg.geo!, blocked_country_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
                      placeholder="86"
                    />
                  </div>
                </div>
              </Section>

              {/* Spam / DND */}
              <Section
                icon={<Shield className="h-4 w-4 text-primary-600" />}
                title="Spam &amp; DND list"
                subtitle="Specific numbers that should never reach the agent."
                enabled={!!cfg.spam_dnd?.enabled}
                onToggle={(v) => setCfg({ ...cfg, spam_dnd: { ...cfg.spam_dnd!, enabled: v } })}
              >
                <label className="block text-xs font-medium text-gray-600 mb-1">Blocked numbers (one per line, E.164)</label>
                <textarea
                  rows={3}
                  value={(cfg.spam_dnd?.blocked_numbers || []).join('\n')}
                  onChange={(e) => setCfg({ ...cfg, spam_dnd: { ...cfg.spam_dnd!, blocked_numbers: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono"
                  placeholder="+919999999999"
                />
              </Section>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="rounded-lg">Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving || loading} className="rounded-lg">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save routing rules
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}

function Section({ icon, title, subtitle, enabled, onToggle, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <div className="flex items-start gap-2.5">
          {icon}
          <div>
            <div className="text-sm font-semibold text-gray-900">{title}</div>
            <div className="text-xs text-gray-500">{subtitle}</div>
          </div>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="sr-only peer" />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-primary-600 rounded-full transition relative after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition peer-checked:after:translate-x-4" />
        </label>
      </div>
      {enabled && <div className="p-4">{children}</div>}
    </div>
  );
}
