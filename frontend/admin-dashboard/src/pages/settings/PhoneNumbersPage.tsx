import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Plus, Phone, Settings, Puzzle, Users, CreditCard, ScrollText, KeyRound,
  ShoppingCart, Loader2, AlertCircle, CheckCircle2, RefreshCw, Trash2, Search,
  Download, X, Rocket, PhoneOutgoing,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { phoneNumberApi, type PhoneNumberRecord, type AvailableNumber, type KycSession } from '@/services/phoneNumber.api';
import { PurchaseNumberModal } from '@/components/settings/PurchaseNumberModal';
import { InstantKycWizard } from '@/components/settings/InstantKycWizard';
import { AssignDeployModal } from '@/components/settings/AssignDeployModal';
import { TestCallModal } from '@/components/settings/TestCallModal';
import api from '@/services/api';

interface CarrierStatus {
  carrier_active: boolean | null;
  compliance_status: string;
  message?: string;
}

const settingsNav = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'Phone Numbers', path: '/settings/phone-numbers', icon: Phone },
  { label: 'Integrations', path: '/settings/integrations', icon: Puzzle },
  { label: 'API', path: '/settings/api', icon: KeyRound },
  { label: 'Team', path: '/settings/team', icon: Users },
  { label: 'Billing', path: '/settings/billing', icon: CreditCard },
  { label: 'Audit Log', path: '/settings/audit-log', icon: ScrollText },
];

const COUNTRIES = [
  { value: 'US', label: '🇺🇸 United States' },
  { value: 'IN', label: '🇮🇳 India' },
  { value: 'GB', label: '🇬🇧 United Kingdom' },
  { value: 'CA', label: '🇨🇦 Canada' },
  { value: 'AU', label: '🇦🇺 Australia' },
  { value: 'DE', label: '🇩🇪 Germany' },
  { value: 'FR', label: '🇫🇷 France' },
  { value: 'SG', label: '🇸🇬 Singapore' },
];

const providerColor: Record<string, string> = {
  plivo: 'bg-violet-100 text-violet-700',
  twilio: 'bg-red-100 text-red-700',
  exotel: 'bg-emerald-100 text-emerald-700',
  sandbox: 'bg-amber-100 text-amber-700',
};

export function PhoneNumbersPage() {
  // Owned numbers
  const [owned, setOwned] = useState<PhoneNumberRecord[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(true);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  // Browse / buy — country fixed to IN since it's the primary market and the
  // only one with live carrier inventory right now. UI no longer surfaces it.
  const [country] = useState('IN');
  const [available, setAvailable] = useState<AvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null); // soft failure (provider unconfigured / country unsupported)
  const [buying, setBuying] = useState<string | null>(null); // number being purchased
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 2-stage purchase flow:
  //   Stage 1 — PurchaseNumberModal (intro + reserve)
  //   Stage 2 — InstantKycWizard (6-step KYC + buy)
  //   Stage 3 — AssignDeployModal (pick agent + deploy)
  const [purchaseTarget, setPurchaseTarget] = useState<AvailableNumber | null>(null);
  const [kycSession, setKycSession] = useState<KycSession | null>(null);
  const [deployTarget, setDeployTarget] = useState<PhoneNumberRecord | null>(null);
  const [testCallTarget, setTestCallTarget] = useState<PhoneNumberRecord | null>(null);
  const [carrierStatus, setCarrierStatus] = useState<Record<string, CarrierStatus>>({});

  // Import-existing-number modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importProvider, setImportProvider] = useState<'plivo' | 'twilio' | 'exotel'>('exotel');
  const [importNumber, setImportNumber] = useState('');
  const [importSid, setImportSid] = useState('');
  const [importVoice, setImportVoice] = useState(true);
  const [importSms, setImportSms] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const reloadOwned = async () => {
    setOwnedLoading(true);
    setOwnedError(null);
    try {
      const list = await phoneNumberApi.list();
      const arr = Array.isArray(list) ? list : [];
      setOwned(arr);
      // Fan out carrier-status fetches in the background — UI renders immediately,
      // badges populate as each provider responds.
      arr.forEach((n) => {
        api.get(`/phone-numbers/${n.id}/carrier-status`)
          .then((r) => {
            const data = r.data?.data ?? r.data;
            setCarrierStatus((prev) => ({ ...prev, [n.id]: data }));
          })
          .catch(() => { /* leave the badge as 'checking' */ });
      });
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Failed to load numbers');
    } finally {
      setOwnedLoading(false);
    }
  };

  useEffect(() => { reloadOwned(); }, []);
  // Auto-load the available-number catalog so the buy panel is ready immediately.
  useEffect(() => { search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    setSearchInfo(null);
    setBuyMsg(null);
    setHasSearched(true);
    try {
      const r = await phoneNumberApi.listAvailableAll({ country, capabilities: ['voice'] });
      setAvailable(r.data);
      if (r.message) setSearchInfo(r.message);
    } catch (e: any) {
      setSearchError(e?.response?.data?.message || e?.message || 'Search failed');
      setAvailable([]);
    } finally {
      setSearching(false);
    }
  };

  const buy = (n: AvailableNumber) => {
    setBuyMsg(null);
    setSearchError(null);
    setPurchaseTarget(n);
  };

  const onReserved = (session: KycSession) => {
    // Move from intro modal → 6-step wizard
    setPurchaseTarget(null);
    setKycSession(session);
  };

  const onWizardCompleted = (rec: PhoneNumberRecord) => {
    const number = rec.phone_number;
    setBuyMsg(`Purchased ${number}. Now attach it to an agent and deploy to take live calls.`);
    setAvailable((p) => p.filter((x) => x.number !== number && '+' + x.number.replace(/^\+/, '') !== number));
    setKycSession(null);
    // Open the Attach & Deploy modal so the user closes the loop in one flow.
    setDeployTarget(rec);
    reloadOwned();
  };

  const onDeployed = (rec: PhoneNumberRecord) => {
    setBuyMsg(`Deployed ${rec.phone_number} — runtime activated. Number now routes inbound calls to the assigned agent. Click Test call to verify outbound.`);
    setDeployTarget(null);
    reloadOwned();
  };

  const submitImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const caps: ('voice' | 'sms')[] = [];
      if (importVoice) caps.push('voice');
      if (importSms) caps.push('sms');
      if (caps.length === 0) caps.push('voice');
      await phoneNumberApi.importExisting({
        provider: importProvider,
        phone_number: importNumber.trim(),
        provider_sid: importSid.trim() || undefined,
        capabilities: caps,
      });
      setImportOpen(false);
      setImportNumber('');
      setImportSid('');
      setBuyMsg(`Imported number into your account.`);
      reloadOwned();
    } catch (e: any) {
      setImportError(e?.response?.data?.message || e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const release = async (rec: PhoneNumberRecord) => {
    if (!confirm(`Release ${rec.phone_number}? This removes it from your account and the carrier.`)) return;
    try {
      await phoneNumberApi.release(rec.id);
      reloadOwned();
    } catch (e: any) {
      setOwnedError(e?.response?.data?.message || e?.message || 'Release failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="space-y-6">
          {/* ─── Owned numbers ─── */}
          <Card padding={false} className="shadow-card">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Your Phone Numbers</h3>
                <p className="text-sm text-gray-500">Numbers in your account — assign them to agents on the agent's Call Configuration tab.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setImportError(null); setImportOpen(true); }} className="rounded-xl">
                  <Download className="h-3.5 w-3.5" /> Add existing number
                </Button>
                <Button variant="outline" size="sm" onClick={reloadOwned} disabled={ownedLoading} className="rounded-xl">
                  <RefreshCw className={`h-3.5 w-3.5 ${ownedLoading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </div>
            </div>

            {ownedError && (
              <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
                <AlertCircle className="h-4 w-4" /> {ownedError}
              </div>
            )}

            {ownedLoading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>
            ) : owned.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                You don't own any numbers yet. Browse below and click <strong>Buy</strong> to add one.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium">Number</th>
                    <th className="text-left px-6 py-3 font-medium">Provider</th>
                    <th className="text-left px-6 py-3 font-medium">Capabilities</th>
                    <th className="text-left px-6 py-3 font-medium">Assigned Agent</th>
                    <th className="text-left px-6 py-3 font-medium">App status</th>
                    <th className="text-left px-6 py-3 font-medium">Carrier</th>
                    <th className="text-right px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {owned.map((n) => {
                    const cs = carrierStatus[n.id];
                    const deployed = !!n.agent_id && n.is_active;
                    return (
                    <tr key={n.id} className="border-t border-gray-100">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                            <Phone className="h-4 w-4 text-primary-500" />
                          </div>
                          <span className="font-mono font-medium text-gray-900">{n.phone_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md ${providerColor[n.provider] || 'bg-gray-100 text-gray-700'}`}>
                          {n.provider}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {n.capabilities?.voice && <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                          {n.capabilities?.voice && <span className="text-[11px] px-2 py-0.5 rounded bg-purple-100 text-purple-700">Web</span>}
                          {n.capabilities?.sms && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">SMS</span>}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm">
                        {n.agent_id
                          ? <span className="text-gray-700 font-medium">{n.agent_id.slice(0, 8)}…</span>
                          : <span className="text-gray-400">Unassigned</span>}
                      </td>
                      <td className="px-6 py-3">
                        {deployed ? (
                          <Badge variant="success">Live</Badge>
                        ) : (
                          <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">Not deployed</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {!cs ? (
                          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> checking
                          </span>
                        ) : cs.compliance_status === 'active' ? (
                          <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700" title={cs.message}>Active</span>
                        ) : cs.compliance_status === 'sandbox' ? (
                          <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700" title={cs.message}>Sandbox</span>
                        ) : cs.compliance_status === 'pending' ? (
                          <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700" title={cs.message}>KYC pending</span>
                        ) : (
                          <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700" title={cs.message}>{cs.compliance_status}</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {!deployed && (
                            <button
                              onClick={() => setDeployTarget(n)}
                              className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 inline-flex items-center gap-1"
                              title="Attach to agent and activate"
                            >
                              <Rocket className="h-3.5 w-3.5" /> Deploy
                            </button>
                          )}
                          {deployed && (
                            <button
                              onClick={() => setTestCallTarget(n)}
                              className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1"
                              title="Place an outbound test call"
                            >
                              <PhoneOutgoing className="h-3.5 w-3.5" /> Test call
                            </button>
                          )}
                          <button onClick={() => release(n)} className="p-1.5 rounded-md text-gray-400 hover:text-danger-600 hover:bg-danger-50" title="Release number">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            )}
          </Card>

          {/* ─── Browse & buy ─── */}
          <Card>
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-gray-900">Buy a new number</h3>
              </div>
              <Button onClick={search} disabled={searching} variant="outline" size="sm" className="rounded-lg">
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Numbers available across all networks. The carrier is picked automatically based on inventory and routed to your account at purchase.
            </p>

            {buyMsg && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-success-50 border border-success-200 text-sm text-success-700 mb-4">
                <CheckCircle2 className="h-4 w-4" /> {buyMsg}
              </div>
            )}
            {searchError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700 mb-4">
                <AlertCircle className="h-4 w-4" /> {searchError}
              </div>
            )}
            {searchInfo && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 mb-4">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{searchInfo}</span>
              </div>
            )}

            {hasSearched && !searching && available.length === 0 && !searchError && (
              <div className="text-center py-8 text-sm text-gray-500">
                No numbers available from any of your configured carriers right now. Click <strong>Refresh</strong>, or use <strong>Add existing number</strong> above to import a number you already own.
              </div>
            )}

            {available.length > 0 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Number</th>
                      <th className="text-left px-4 py-2 font-medium">Capabilities</th>
                      <th className="text-right px-4 py-2 font-medium">Monthly cost</th>
                      <th className="text-right px-4 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {available.map((n) => (
                      <tr key={n.number} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-gray-900">{n.number}</span>
                            {n.synthetic && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold uppercase tracking-wider">Sandbox</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 flex-wrap">
                            {n.capabilities?.includes('voice') && <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">Voice</span>}
                            {n.capabilities?.includes('voice') && <span className="text-[11px] px-2 py-0.5 rounded bg-purple-100 text-purple-700">Web</span>}
                            {n.capabilities?.includes('sms') && <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">SMS</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {n.monthlyRate != null ? `$${n.monthlyRate.toFixed(3)} / mo` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={buying === n.number}
                            onClick={() => buy(n)}
                          >
                            {buying === n.number ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Buy with KYC
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-gray-400 mt-3">
              Numbers in some countries (US toll-free, UK, India) require carrier KYC verification before they can place calls.
              Plivo will rent the number immediately but it shows as <code className="bg-gray-100 px-1 rounded">compliance: pending</code> until verification clears (1–3 business days).
            </p>
          </Card>
      </div>

      {/* ── Stage 1: Purchase intro modal ───────────────────────────── */}
      <PurchaseNumberModal
        open={purchaseTarget !== null}
        number={purchaseTarget}
        provider={(purchaseTarget?.provider === 'sandbox' ? 'plivo' : purchaseTarget?.provider) || 'plivo'}
        capabilities={['voice']}
        onClose={() => setPurchaseTarget(null)}
        onReserved={onReserved}
      />

      {/* ── Stage 2: 6-step Instant KYC Verification wizard ─────────── */}
      <InstantKycWizard
        open={kycSession !== null}
        session={kycSession}
        onClose={() => setKycSession(null)}
        onCompleted={onWizardCompleted}
      />

      {/* ── Stage 3: Attach to agent + Deploy ───────────────────────── */}
      <AssignDeployModal
        open={deployTarget !== null}
        phone={deployTarget}
        onClose={() => setDeployTarget(null)}
        onDeployed={onDeployed}
      />

      {/* ── Outbound test call ──────────────────────────────────────── */}
      <TestCallModal
        open={testCallTarget !== null}
        phone={testCallTarget}
        onClose={() => setTestCallTarget(null)}
      />

      {/* ── Import existing number modal ─────────────────────────────── */}
      {importOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={() => !importing && setImportOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Add an existing number</h3>
                <p className="text-xs text-gray-500 mt-0.5">Register a number you already own at Plivo, Twilio, or Exotel.</p>
              </div>
              <button onClick={() => !importing && setImportOpen(false)} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-4 w-4 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              {importError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{importError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Carrier</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['plivo', 'twilio', 'exotel'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setImportProvider(p)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${importProvider === p ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}
                    >
                      {p === 'plivo' ? 'Plivo' : p === 'twilio' ? 'Twilio' : 'Exotel'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone number (E.164)</label>
                <input
                  type="tel"
                  value={importNumber}
                  onChange={(e) => setImportNumber(e.target.value)}
                  placeholder="+919493324795"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">Include the country code with a leading "+".</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Provider SID / ID <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={importSid}
                  onChange={(e) => setImportSid(e.target.value)}
                  placeholder="e.g. PNxxxxxxxxxxxxxxxx (Twilio) — leave blank if unsure"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">Needed only if you want this app to release the number on the carrier later.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Capabilities</label>
                <div className="flex gap-3 text-sm">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={importVoice} onChange={(e) => setImportVoice(e.target.checked)} className="accent-primary-600" />
                    <span>Voice</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={importSms} onChange={(e) => setImportSms(e.target.checked)} className="accent-primary-600" />
                    <span>SMS</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/60 rounded-b-2xl">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(false)} disabled={importing} className="rounded-lg">Cancel</Button>
              <Button variant="primary" size="sm" onClick={submitImport} disabled={importing || !importNumber.trim()} className="rounded-lg">
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add to my numbers
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
